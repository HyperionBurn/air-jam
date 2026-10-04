import { describe, expect, it } from "vitest";
import { newPose, PoseDriver, PoseSpring, SNAP_ARM0, STYLES, type Pose } from "../src/game/view3d/anim";
import type { FighterId } from "../src/game/sim";
import { runBotMatch } from "./bot-harness";

const IDS: FighterId[] = ["nova", "volt", "bulwark", "wisp"];

const numbers = (p: Pose): [string, number][] => {
  const out: [string, number][] = [
    ["hipY", p.hipY], ["hipZ", p.hipZ], ["pitch", p.pitch], ["roll", p.roll], ["pelvisYaw", p.pelvisYaw], ["pelvisRoll", p.pelvisRoll], ["spine", p.spine],
    ["chestYaw", p.chestYaw], ["chestRoll", p.chestRoll], ["headPitch", p.headPitch], ["headYaw", p.headYaw], ["headRoll", p.headRoll],
    ["squashX", p.squashX], ["squashY", p.squashY], ["strike", p.strike], ["alpha", p.alpha], ["stretch", p.stretch], ["swing", p.swing],
  ];
  p.arm.forEach((a, i) => out.push([`arm${i}.sh`, a.sh], [`arm${i}.ab`, a.ab], [`arm${i}.el`, a.el], [`arm${i}.wr`, a.wr], [`arm${i}.ext`, a.ext]));
  p.leg.forEach((l, i) => out.push([`leg${i}.hip`, l.hip], [`leg${i}.ab`, l.ab], [`leg${i}.knee`, l.knee], [`leg${i}.ankle`, l.ankle]));
  out.push(["anger", p.expr.anger], ["open", p.expr.open], ["wide", p.expr.wide]);
  return out;
};

describe("pose driver", () => {
  it("defines a distinct style sheet for every fighter", () => {
    const rates = new Set(IDS.map((id) => STYLES[id].runRate));
    expect(rates.size).toBe(4);
    expect(STYLES.wisp.floats).toBe(true);
    expect(STYLES.bulwark.windup).toBeGreaterThan(STYLES.volt.windup);
  });

  it("produces finite, bounded poses for every state reached in a bot match", () => {
    const probe = runBotMatch({ fighters: IDS, difficulty: "hard", seed: 11, maxFrames: 1 }).world;
    const drivers = probe.fighters.map((f) => new PoseDriver({ shoulderX: 4, shoulderY: -f.def.height * 0.7, armLen: f.def.height * 0.32, hipHeight: f.def.height * 0.46 }, f.def.id));
    const states = new Set<string>();
    const violations: string[] = [];
    runBotMatch({
      fighters: IDS,
      difficulty: "hard",
      seed: 11,
      maxFrames: 60 * 90,
      onTick: (w) => {
        w.fighters.forEach((f, i) => {
          if (!f.alive) return;
          states.add(f.state);
          const pose = drivers[i].update(f, w.frame, 1);
          for (const [name, n] of numbers(pose)) {
            if (!Number.isFinite(n) || Math.abs(n) >= 40) violations.push(`${f.def.id} ${f.state}/${f.moveId} sf=${f.sf} ${name}=${n}`);
          }
          if (pose.squashX <= 0 || pose.squashY <= 0) violations.push(`${f.def.id} ${f.state} non-positive scale`);
        });
      },
    });
    expect(violations.slice(0, 5)).toEqual([]);
    // The match must have exercised a healthy spread of animation states.
    expect(states.size).toBeGreaterThanOrEqual(8);
  }, 30000);
});

describe("pose spring", () => {
  it("converges to a steady target with some overshoot but no divergence", () => {
    const spring = new PoseSpring();
    const start = newPose();
    spring.step(start, 1, 1);
    let peak = 0;
    let last = 0;
    for (let i = 0; i < 240; i += 1) {
      const t = newPose();
      t.arm[0].sh = 2;
      const out = spring.step(t, 1, 1);
      peak = Math.max(peak, out.arm[0].sh);
      last = out.arm[0].sh;
    }
    expect(last).toBeCloseTo(2, 2);
    expect(peak).toBeLessThan(3);
  });

  it("snapped channels land exactly on the target (striking limb stays on the hitbox)", () => {
    const spring = new PoseSpring();
    spring.step(newPose(), 1, 1);
    const t = newPose();
    t.arm[0].sh = 1.234;
    t.snap = SNAP_ARM0;
    const out = spring.step(t, 1, 1);
    expect(out.arm[0].sh).toBe(1.234);
  });

  it("stays stable across large frame steps", () => {
    const spring = new PoseSpring();
    spring.step(newPose(), 1, 1);
    for (let i = 0; i < 40; i += 1) {
      const t = newPose();
      t.arm[1].el = i % 2 ? 2 : 0;
      const out = spring.step(t, 3, 1);
      expect(Number.isFinite(out.arm[1].el)).toBe(true);
      expect(Math.abs(out.arm[1].el)).toBeLessThan(8);
    }
  });
});
