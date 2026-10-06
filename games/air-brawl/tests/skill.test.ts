import { describe, expect, it } from "vitest";
import { PERFECT_SHIELD_FRAMES, PROJECTILE_RECAST, SHIELD_RELEASE_LOCK, STALE_MIN } from "../src/game/sim/constants";
import { applyHit, staleMultiplier } from "../src/game/sim/combat";
import { BTN, stepWorld, type Fighter, type SimEvent, type World } from "../src/game/sim";
import { hold, input, makeWorld, press, run } from "./helpers";

const place = (f: Fighter, x: number): void => {
  f.x = x;
  f.y = 0;
  f.px = x;
  f.py = 0;
  f.vx = 0;
  f.vy = 0;
  f.grounded = true;
  f.platform = 0;
  f.invuln = 0;
  f.state = "idle";
};

const poke = { damage: 8, angle: 40, baseKb: 40, growth: 100, hitlag: 1, stun: 1, fx: "impact" as const, sfx: "mid" as const };
const hitFrom = (world: World, move: string, target: Fighter): void => {
  const attacker = world.fighters[0];
  attacker.moveUse += 1;
  applyHit(world, target, poke, { attacker: 0, moveId: move, dirSign: 1, x: target.x, y: target.y - 40, attackerLag: false });
};
const seen = (world: World, type: SimEvent["type"]): SimEvent[] => world.events.filter((e) => e.type === type);

describe("move staling", () => {
  it("repeating the same move weakens it, other moves stay fresh, and it never goes below the floor", () => {
    const world = makeWorld(["nova", "volt"]);
    const [attacker, victim] = world.fighters;
    place(attacker, 400);
    place(victim, 460);
    expect(staleMultiplier(attacker, "jab1")).toBe(1);
    const damages: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      victim.invuln = 0;
      victim.state = "idle";
      victim.hitlag = 0;
      const before = victim.percent;
      hitFrom(world, "jab1", victim);
      damages.push(victim.percent - before);
    }
    expect(damages[1]).toBeLessThan(damages[0]);
    expect(damages[5]).toBeLessThan(damages[1]);
    expect(damages[11]).toBeGreaterThanOrEqual(poke.damage * STALE_MIN - 1e-6);
    expect(staleMultiplier(attacker, "ftilt")).toBe(1);
  });

  it("mixing moves keeps them fresh: the queue forgets old copies", () => {
    const world = makeWorld(["nova", "volt"]);
    const [attacker, victim] = world.fighters;
    place(attacker, 400);
    place(victim, 460);
    for (let i = 0; i < 3; i += 1) {
      victim.invuln = 0;
      victim.state = "idle";
      hitFrom(world, "jab1", victim);
    }
    const stale = staleMultiplier(attacker, "jab1");
    expect(stale).toBeLessThan(1);
    for (const move of ["ftilt", "dtilt", "utilt", "fair", "bair", "uair", "dair", "nair", "fsmash"]) {
      victim.invuln = 0;
      victim.state = "idle";
      hitFrom(world, move, victim);
    }
    expect(staleMultiplier(attacker, "jab1")).toBe(1);
  });

  it("a multi-hit move counts once per use", () => {
    const world = makeWorld(["nova", "volt"]);
    const [attacker, victim] = world.fighters;
    place(attacker, 400);
    place(victim, 460);
    attacker.moveUse += 1;
    for (let i = 0; i < 4; i += 1) {
      victim.invuln = 0;
      victim.state = "idle";
      applyHit(world, victim, poke, { attacker: 0, moveId: "drill", dirSign: 1, x: 460, y: -40, attackerLag: false });
    }
    expect(attacker.staleQueue.filter((m) => m === "drill")).toHaveLength(1);
  });

  it("a KO resets the queue", () => {
    const world = makeWorld(["nova", "volt"]);
    const attacker = world.fighters[0];
    attacker.staleQueue.push("jab1", "jab1");
    attacker.x = -9000; // far past the blast zone
    attacker.px = attacker.x;
    attacker.grounded = false;
    attacker.platform = -1;
    attacker.state = "airborne";
    run(world, 260);
    expect(attacker.stocks).toBeLessThan(3);
    expect(attacker.staleQueue).toHaveLength(0);
  });

  it("reports how stale the hit was, for feedback", () => {
    const world = makeWorld(["nova", "volt"]);
    const [attacker, victim] = world.fighters;
    place(attacker, 400);
    place(victim, 460);
    victim.invuln = 0;
    hitFrom(world, "jab1", victim);
    expect((seen(world, "hit")[0] as { stale?: number }).stale).toBe(0);
    for (let i = 0; i < 10; i += 1) {
      victim.invuln = 0;
      victim.state = "idle";
      hitFrom(world, "jab1", victim);
    }
    const last = [...world.events].reverse().find((e) => e.type === "hit") as { stale?: number };
    expect(last.stale ?? 0).toBeGreaterThan(0.5);
  });
});

describe("parry and shield mashing", () => {
  const raise = (world: World): { attacker: Fighter; victim: Fighter } => {
    const [attacker, victim] = world.fighters;
    place(attacker, 400);
    place(victim, 460);
    victim.facing = -1;
    return { attacker, victim };
  };

  it("a shield raised right into a hit parries it: no damage, no shield loss, no stun, attacker punished", () => {
    const world = makeWorld(["nova", "volt"]);
    const { victim } = raise(world);
    stepWorld(world, [undefined, press(BTN.SHIELD)]);
    expect(victim.state).toBe("shield");
    expect(victim.sf).toBeLessThanOrEqual(PERFECT_SHIELD_FRAMES);
    const shieldBefore = victim.shield;
    const percentBefore = victim.percent;
    victim.hitlag = 0;
    hitFrom(world, "ftilt", victim);
    expect(seen(world, "parry")).toHaveLength(1);
    expect(victim.percent).toBe(percentBefore);
    expect(victim.shield).toBeGreaterThanOrEqual(shieldBefore);
    expect(victim.state).toBe("shield");
  });

  it("a late shield is an ordinary block", () => {
    const world = makeWorld(["nova", "volt"]);
    const { victim } = raise(world);
    stepWorld(world, [undefined, press(BTN.SHIELD)]);
    for (let i = 0; i < PERFECT_SHIELD_FRAMES + 4; i += 1) stepWorld(world, [undefined, hold(BTN.SHIELD)]);
    victim.hitlag = 0;
    hitFrom(world, "ftilt", victim);
    expect(seen(world, "parry")).toHaveLength(0);
    expect(seen(world, "shieldHit")).toHaveLength(1);
  });

  it("mashing shield cannot keep a parry window open: re-raising is locked after lowering", () => {
    const world = makeWorld(["nova", "volt"]);
    const { victim } = raise(world);
    stepWorld(world, [undefined, press(BTN.SHIELD)]);
    stepWorld(world, [undefined, input()]);
    stepWorld(world, [undefined, input()]);
    expect(victim.state).not.toBe("shield");
    expect(victim.shieldLock).toBeGreaterThan(0);
    stepWorld(world, [undefined, press(BTN.SHIELD)]);
    expect(victim.state).not.toBe("shield");
    expect(seen(world, "denied").some((e) => (e as { why: string }).why === "shield")).toBe(true);
    for (let i = 0; i < SHIELD_RELEASE_LOCK + 2; i += 1) stepWorld(world, [undefined, hold(BTN.SHIELD)]);
    expect(victim.state).toBe("shield");
  });
});

describe("dodge fatigue", () => {
  const rollOnce = (world: World, f: Fighter): number => {
    let invuln = 0;
    // shield, then flick sideways: a roll
    for (let i = 0; i < 4; i += 1) stepWorld(world, [hold(BTN.SHIELD)]);
    stepWorld(world, [hold(BTN.SHIELD, { mx: 1 })]);
    stepWorld(world, [hold(BTN.SHIELD, { mx: 1 })]);
    for (let i = 0; i < 40 && f.state !== "roll"; i += 1) stepWorld(world, [hold(BTN.SHIELD, { mx: i % 2 ? 1 : 0.2 })]);
    for (let i = 0; i < 40 && f.state === "roll"; i += 1) {
      stepWorld(world, [input()]);
      invuln = Math.max(invuln, f.invuln);
    }
    return invuln;
  };

  it("chained dodges grant less invulnerability than the first", () => {
    const world = makeWorld(["nova"]);
    const f = world.fighters[0];
    place(f, 480);
    f.shield = f.def.shieldMax;
    const first = rollOnce(world, f);
    run(world, 20);
    f.shieldLock = 0;
    const second = rollOnce(world, f);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
  });

  it("the penalty wears off after a pause", () => {
    const world = makeWorld(["nova"]);
    const f = world.fighters[0];
    f.dodgeFatigue = 3;
    f.dodgeTimer = 5;
    run(world, 10);
    expect(f.dodgeFatigue).toBe(0);
  });
});

describe("projectile recast", () => {
  it("a projectile special cannot be restarted until its recast time has passed", () => {
    const world = makeWorld(["nova", "volt"]);
    const f = world.fighters[0];
    place(f, 300);
    place(world.fighters[1], 900);
    stepWorld(world, [press(BTN.SPECIAL)]);
    expect(f.state === "special" || f.state === "airSpecial").toBe(true);
    const id = f.moveId as string;
    expect(f.moveCd[id]).toBeGreaterThan(PROJECTILE_RECAST);
    // mash through the whole move; the cooldown outlasts the move, so the next press is refused
    let denied = 0;
    for (let i = 0; i < 90; i += 1) {
      stepWorld(world, [i % 2 === 0 ? press(BTN.SPECIAL) : input()]);
      denied += seen(world, "denied").length;
    }
    expect(denied).toBeGreaterThan(0);
  });
});
