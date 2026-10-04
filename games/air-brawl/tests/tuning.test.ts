import { describe, expect, it } from "vitest";
import { FIGHTER_IDS, FIGHTERS } from "../src/game/data/fighters";
import { applyHit, BTN, stepWorld, type FighterId, type World } from "../src/game/sim";
import { hold, input, makeWorld, press, run } from "./helpers";

/**
 * Measurement harness. These tests double as tuning reports (printed with
 * AIRBRAWL_REPORT=1) and as guard rails on the numbers that define game feel.
 */
const report = process.env.AIRBRAWL_REPORT === "1";
const log = (...args: unknown[]) => {
  if (report) console.log(...args);
};

const jumpHeight = (id: FighterId, shortHop: boolean, double: boolean): number => {
  const world = makeWorld([id]);
  run(world, 10);
  const f = world.fighters[0];
  const startY = f.y;
  let minY = startY;
  const ticks = 120;
  for (let i = 0; i < ticks; i += 1) {
    let frame = input();
    if (i === 0) frame = press(BTN.JUMP);
    else if (i < (shortHop ? 1 : 24)) frame = hold(BTN.JUMP);
    if (double && i === 22) frame = press(BTN.JUMP);
    else if (double && i > 22 && i < 46) frame = hold(BTN.JUMP);
    stepWorld(world, [frame]);
    minY = Math.min(minY, f.y);
  }
  return startY - minY;
};

describe("movement feel numbers", () => {
  it("jump heights are sane and ordered (short < full < double)", () => {
    for (const id of FIGHTER_IDS) {
      const short = jumpHeight(id, true, false);
      const full = jumpHeight(id, false, false);
      const dbl = jumpHeight(id, false, true);
      log(id, { short: Math.round(short), full: Math.round(full), double: Math.round(dbl) });
      expect(short).toBeGreaterThan(40);
      expect(full).toBeGreaterThan(short + 40);
      expect(dbl).toBeGreaterThan(full);
      // A full hop must be able to reach the side platforms (185 up).
      expect(full).toBeGreaterThan(186);
    }
  });

  it("run speed ordering matches archetypes", () => {
    const speeds: Record<string, number> = {};
    for (const id of FIGHTER_IDS) {
      const world = makeWorld([id]);
      run(world, 60, () => [input({ mx: 1 })]);
      speeds[id] = Math.abs(world.fighters[0].vx);
    }
    log(speeds);
    expect(speeds.volt).toBeGreaterThan(speeds.nova);
    expect(speeds.nova).toBeGreaterThan(speeds.wisp);
    expect(speeds.wisp).toBeGreaterThan(speeds.bulwark);
  });
});

/** Smallest damage percent at which a hit KOs a stationary victim, via launch simulation. */
const killPercent = (
  attacker: FighterId,
  victim: FighterId,
  moveId: string,
  hitboxIndex = 0,
  opts: { x?: number; air?: boolean } = {},
): number => {
  for (let percent = 0; percent <= 400; percent += 5) {
    const world = makeWorld([attacker, victim]);
    const a = world.fighters[0];
    const v = world.fighters[1];
    a.x = opts.x ?? 0;
    a.y = 0;
    v.x = a.x + 60;
    v.y = 0;
    v.percent = percent;
    v.invuln = 0;
    const move = a.def.moves[moveId];
    const box = move.hitboxes[hitboxIndex];
    applyHit(
      world,
      v,
      {
        damage: box.damage,
        angle: box.angle,
        baseKb: box.baseKb,
        growth: box.growth,
        hitlag: box.hitlag,
        stun: box.stun,
        fx: box.fx ?? "impact",
        sfx: box.sfx ?? "mid",
      },
      { attacker: 0, moveId, dirSign: 1, x: v.x, y: v.y - 40 },
    );
    // Launch KO = leaves the blast zone while still in hitstun (cannot recover).
    let ko = false;
    for (let i = 0; i < 260 && !ko; i += 1) {
      stepWorld(world, []);
      if (world.events.some((e) => e.type === "ko")) {
        ko = true;
        break;
      }
      if (i > 2 && world.fighters[1].state !== "hitstun") break;
    }
    if (ko) return percent;
  }
  return 999;
};

describe("knockback calibration", () => {
  it("strong moves KO in a believable percent range; jabs do not", () => {
    const table: Record<string, Record<string, number>> = {};
    for (const id of FIGHTER_IDS) {
      table[id] = {};
      for (const m of ["jab3", "ftilt", "fsmash", "usmash", "bair", "fair", "uair", "dair"]) {
        table[id][m] = killPercent(id, "nova", m, 0);
      }
    }
    log(JSON.stringify(table, null, 1));
    expect(table.nova.fsmash).toBeGreaterThan(70);
    expect(table.nova.fsmash).toBeLessThan(160);
    expect(table.bulwark.fsmash).toBeLessThan(table.nova.fsmash);
    expect(table.volt.fsmash).toBeGreaterThanOrEqual(table.nova.fsmash);
    expect(table.nova.jab3).toBeGreaterThan(table.nova.fsmash);
  });

  it("heavier fighters survive longer than lighter ones against the same hit", () => {
    const light = killPercent("nova", "volt", "fsmash");
    const heavy = killPercent("nova", "bulwark", "fsmash");
    log({ light, heavy });
    expect(heavy).toBeGreaterThan(light);
  });
});

describe("determinism", () => {
  it("identical inputs produce identical worlds", () => {
    const script = (frame: number) => {
      const bits =
        (frame % 17 === 0 ? BTN.ATTACK : 0) | (frame % 29 === 0 ? BTN.JUMP : 0) | (frame % 41 === 0 ? BTN.SPECIAL : 0);
      return [
        input({ mx: Math.sin(frame / 20), held: bits, taps: bits }),
        input({ mx: -Math.cos(frame / 25), held: bits >> 1, taps: bits >> 1 }),
      ];
    };
    const a = makeWorld(["nova", "wisp"], { seed: 5 });
    const b = makeWorld(["nova", "wisp"], { seed: 5 });
    run(a, 900, script);
    run(b, 900, script);
    expect(a.frame).toBe(b.frame);
    expect(a.fighters.map((f) => [f.x, f.y, f.percent, f.stocks])).toEqual(
      b.fighters.map((f) => [f.x, f.y, f.percent, f.stocks]),
    );
  });
});

export type { World };
void FIGHTERS;
