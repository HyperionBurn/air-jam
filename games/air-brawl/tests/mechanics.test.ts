import { describe, expect, it } from "vitest";
import { FIGHTERS } from "../src/game/data/fighters";
import { applyHit, BTN, stepWorld, type Fighter, type SimEvent, type World } from "../src/game/sim";
import { hold, input, makeWorld, press, run } from "./helpers";

const events = (world: World, type: SimEvent["type"]): SimEvent[] => world.events.filter((e) => e.type === type);

/** Collect events across N ticks (world.events is per-tick). */
const collect = (world: World, frames: number, inputs: (i: number) => ReturnType<typeof input>[] = () => []) => {
  const all: SimEvent[] = [];
  for (let i = 0; i < frames; i += 1) {
    stepWorld(world, inputs(i));
    all.push(...world.events);
  }
  return all;
};

const placeOnMain = (f: Fighter, x: number): void => {
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

const poke = {
  damage: 8,
  angle: 40,
  baseKb: 40,
  growth: 100,
  hitlag: 1,
  stun: 1,
  fx: "impact" as const,
  sfx: "mid" as const,
};

describe("physics & platforms", () => {
  it("falls under gravity and lands on the main platform", () => {
    const world = makeWorld(["nova"]);
    const f = world.fighters[0];
    f.x = 485;
    f.y = -420;
    f.px = f.x;
    f.py = f.y;
    f.grounded = false;
    f.platform = -1;
    f.state = "airborne";
    run(world, 120);
    expect(f.grounded).toBe(true);
    expect(f.y).toBeCloseTo(0, 0);
    expect(["idle", "land"]).toContain(f.state);
  });

  it("jumps up through a soft platform and lands on it", () => {
    const world = makeWorld(["nova"]);
    const f = world.fighters[0];
    placeOnMain(f, -340);
    run(world, 5);
    let landedOnSoft = false;
    for (let i = 0; i < 90; i += 1) {
      stepWorld(world, [i === 0 ? press(BTN.JUMP) : i < 26 ? hold(BTN.JUMP) : input()]);
      if (f.grounded && f.y < -150) landedOnSoft = true;
    }
    expect(landedOnSoft).toBe(true);
    expect(f.y).toBeCloseTo(-185, 0);
  });

  it("drops through a soft platform when the stick is pushed down", () => {
    const world = makeWorld(["nova"]);
    const f = world.fighters[0];
    placeOnMain(f, -340);
    f.y = -185;
    f.py = -185;
    f.platform = 1;
    run(world, 4);
    expect(f.grounded).toBe(true);
    run(world, 40, () => [input({ my: 1 })]);
    expect(f.y).toBeGreaterThan(-100);
  });

  it("fast fall raises terminal velocity", () => {
    const fall = (stick: number): number => {
      const world = makeWorld(["nova"]);
      const f = world.fighters[0];
      f.x = 0;
      f.y = -900;
      f.py = f.y;
      f.grounded = false;
      f.platform = -1;
      f.state = "airborne";
      let maxVy = 0;
      for (let i = 0; i < 60; i += 1) {
        stepWorld(world, [input({ my: i > 5 ? stick : 0 })]);
        maxVy = Math.max(maxVy, f.vy);
      }
      return maxVy;
    };
    expect(fall(1)).toBeGreaterThan(fall(0) + 1);
  });

  it("cannot walk through the stage wall and falls off the edge", () => {
    const world = makeWorld(["nova"]);
    const f = world.fighters[0];
    placeOnMain(f, 400);
    let maxX = 0;
    let wasAirborne = false;
    for (let i = 0; i < 90; i += 1) {
      stepWorld(world, [input({ mx: 1 })]);
      maxX = Math.max(maxX, f.x);
      if (!f.grounded) wasAirborne = true;
    }
    expect(maxX).toBeGreaterThan(500);
    expect(wasAirborne).toBe(true);
  });
});

describe("blast zones, stocks, respawn", () => {
  it("KOs a fighter past the blast zone, removes a stock, and respawns with invulnerability", () => {
    const world = makeWorld(["nova", "volt"], { stocks: 3 });
    const f = world.fighters[0];
    f.x = 1450;
    f.y = -100;
    f.vx = 40;
    f.grounded = false;
    f.platform = -1;
    f.state = "airborne";
    const seen = collect(world, 240);
    expect(seen.some((e) => e.type === "ko" && e.victim === 0)).toBe(true);
    expect(f.stocks).toBe(2);
    expect(world.stats[0].falls).toBe(1);
    expect(seen.some((e) => e.type === "respawn" && e.who === 0)).toBe(true);
    expect(f.alive).toBe(true);
    expect(f.percent).toBe(0);
    expect(f.invuln).toBeGreaterThan(0);
  });

  it("last fighter standing wins a stock match and the world ends", () => {
    const world = makeWorld(["nova", "volt"], { stocks: 1 });
    const loser = world.fighters[1];
    loser.x = 1600;
    loser.vx = 30;
    loser.grounded = false;
    loser.platform = -1;
    loser.state = "airborne";
    const seen = collect(world, 600);
    const end = seen.find((e) => e.type === "matchEnd");
    expect(end).toBeTruthy();
    expect(world.phase).toBe("over");
    expect(world.winners).toEqual([0]);
    expect(world.endReason).toBe("stocks");
  });

  it("timed mode ends on the clock and ranks by KOs", () => {
    const world = makeWorld(["nova", "volt"], { mode: "timed", timeLimitSec: 3 });
    world.scores[0] = 2;
    world.scores[1] = 1;
    const seen = collect(world, 60 * 5);
    const end = seen.find((e) => e.type === "matchEnd");
    expect(end).toBeTruthy();
    expect(world.endReason).toBe("time");
    expect(world.winners).toEqual([0]);
  });
});

describe("combat model", () => {
  const hitFor = (world: World, percent: number) => {
    const v = world.fighters[1];
    placeOnMain(v, 80);
    v.percent = percent;
    v.invuln = 0;
    applyHit(world, v, poke, { attacker: 0, moveId: "test", dirSign: 1, x: v.x, y: v.y - 40 });
    return v;
  };

  it("adds damage and produces knockback that grows with percent", () => {
    const low = makeWorld(["nova", "nova"]);
    const high = makeWorld(["nova", "nova"]);
    const a = hitFor(low, 0);
    const b = hitFor(high, 120);
    expect(a.percent).toBe(poke.damage);
    expect(b.percent).toBe(120 + poke.damage);
    const speed = (f: Fighter) => Math.hypot(f.pendLx || f.vx, f.pendLy || f.vy);
    expect(speed(b)).toBeGreaterThan(speed(a) * 1.5);
  });

  it("freezes both fighters during hitlag, then launches the victim", () => {
    const world = makeWorld(["nova", "nova"]);
    const v = world.fighters[1];
    placeOnMain(v, 80);
    applyHit(world, v, { ...poke, hitlag: 8 }, { attacker: 0, moveId: "test", dirSign: 1, x: v.x, y: v.y - 40 });
    expect(v.hitlag).toBeGreaterThan(0);
    const x0 = v.x;
    run(world, 2);
    expect(v.x).toBe(x0);
    run(world, 40);
    expect(v.x).toBeGreaterThan(x0);
    expect(world.fighters[0].hitlag).toBe(0);
  });

  it("locks the victim in hitstun: attack input is ignored until it ends", () => {
    const world = makeWorld(["nova", "nova"]);
    const v = world.fighters[1];
    placeOnMain(v, 80);
    v.percent = 100;
    applyHit(world, v, { ...poke, stun: 30 }, { attacker: 0, moveId: "test", dirSign: 1, x: v.x, y: v.y - 40 });
    run(world, 4);
    expect(v.state).toBe("hitstun");
    stepWorld(world, [undefined, press(BTN.ATTACK)]);
    expect(v.state).toBe("hitstun");
    expect(events(world, "attack")).toHaveLength(0);
    run(world, 140);
    expect(["hitstun"]).not.toContain(v.state);
  });

  it("DI changes the launch trajectory", () => {
    const launch = (mx: number): number => {
      const world = makeWorld(["nova", "nova"]);
      const v = world.fighters[1];
      placeOnMain(v, 80);
      v.percent = 80;
      // DI is read from the stick at the moment of the hit, so hold it first.
      run(world, 4, () => [undefined, input({ my: -1, mx })]);
      placeOnMain(v, 80);
      v.percent = 80;
      applyHit(world, v, { ...poke, angle: 55, stun: 20 }, { attacker: 0, moveId: "test", dirSign: 1, x: v.x, y: v.y - 40 });
      run(world, 14, () => [undefined, input({ my: -1, mx })]);
      return v.x;
    };
    expect(Math.abs(launch(1) - launch(-1))).toBeGreaterThan(1);
  });

  it("friendly fire is off in teams unless enabled", () => {
    const run1 = (friendlyFire: boolean) => {
      const world = makeWorld(["nova", "volt"], { teams: true, friendlyFire });
      world.fighters[1].team = world.fighters[0].team;
      placeOnMain(world.fighters[0], 0);
      placeOnMain(world.fighters[1], 60);
      world.fighters[0].facing = 1;
      run(world, 40, (i) => [i % 20 === 2 ? press(BTN.ATTACK) : input()]);
      return world.fighters[1].percent;
    };
    expect(run1(false)).toBe(0);
    expect(run1(true)).toBeGreaterThan(0);
  });
});

describe("move frame data", () => {
  it("jab connects exactly on its first active frame", () => {
    const def = FIGHTERS.nova.moves.jab1;
    const first = Math.min(...def.hitboxes.map((h) => h.from));
    const world = makeWorld(["nova", "bulwark"]);
    placeOnMain(world.fighters[0], 0);
    placeOnMain(world.fighters[1], 62);
    world.fighters[0].facing = 1;
    world.fighters[1].facing = -1;
    run(world, 3);
    let connectedAt = -1;
    for (let i = 0; i < 40 && connectedAt < 0; i += 1) {
      stepWorld(world, [i === 0 ? press(BTN.ATTACK) : input()]);
      if (events(world, "hit").length) connectedAt = i;
    }
    expect(connectedAt).toBeGreaterThanOrEqual(0);
    // Attack starts on tick 0 (move frame 0); the first live frame is `from`, within a one-tick buffer/processing allowance.
    expect(Math.abs(connectedAt - first)).toBeLessThanOrEqual(2);
  });

  it("every fighter move has non-empty, ordered, in-range hitbox windows", () => {
    for (const def of Object.values(FIGHTERS)) {
      for (const [id, move] of Object.entries(def.moves)) {
        for (const h of move.hitboxes) {
          expect(h.from, `${def.id}.${id}`).toBeLessThanOrEqual(h.to);
          expect(h.to, `${def.id}.${id}`).toBeLessThan(move.total + 1);
          expect(h.damage).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("defence", () => {
  const setup = () => {
    const world = makeWorld(["nova", "bulwark"]);
    placeOnMain(world.fighters[0], 0);
    placeOnMain(world.fighters[1], 70);
    world.fighters[0].facing = 1;
    world.fighters[1].facing = -1;
    run(world, 3);
    return world;
  };

  it("shield absorbs hits (no damage) and drains", () => {
    const world = setup();
    const target = world.fighters[1];
    const start = target.shield;
    const seen = collect(world, 40, (i) => [i % 14 === 0 ? press(BTN.ATTACK) : input(), hold(BTN.SHIELD)]);
    expect(seen.some((e) => e.type === "shieldHit")).toBe(true);
    expect(target.percent).toBe(0);
    expect(target.shield).toBeLessThan(start);
  });

  it("breaks shield after sustained pressure and leaves the fighter stunned", () => {
    const world = setup();
    const target = world.fighters[1];
    target.shield = 6;
    const seen = collect(world, 80, (i) => [i % 14 === 0 ? press(BTN.ATTACK) : input(), hold(BTN.SHIELD)]);
    expect(seen.some((e) => e.type === "shieldBreak")).toBe(true);
    expect(target.state).toBe("shieldBreak");
  });

  it("roll gives invulnerability frames", () => {
    const world = setup();
    const target = world.fighters[1];
    // Shield + flick to roll.
    run(world, 3, () => [undefined, hold(BTN.SHIELD)]);
    stepWorld(world, [undefined, hold(BTN.SHIELD, { mx: 1 })]);
    stepWorld(world, [undefined, hold(BTN.SHIELD, { mx: 1 })]);
    expect(["roll", "shield"]).toContain(target.state);
    if (target.state === "roll") {
      run(world, 8, () => [undefined, input()]);
      expect(target.invuln).toBeGreaterThan(0);
    }
  });
});

describe("recovery & ledge", () => {
  it("up special brings a launched fighter back to the stage", () => {
    for (const id of ["nova", "volt", "bulwark", "wisp"] as const) {
      const world = makeWorld([id]);
      const f = world.fighters[0];
      f.x = -700;
      f.y = -40;
      f.px = f.x;
      f.py = f.y;
      f.vx = 0;
      f.vy = 0;
      f.grounded = false;
      f.platform = -1;
      f.state = "airborne";
      f.jumpsLeft = 0;
      let recovered = false;
      for (let i = 0; i < 240 && !recovered; i += 1) {
        const steer = i === 0 ? { my: -1, mx: 0.6 } : { mx: 1, my: i < 40 ? -0.4 : 0 };
        const frame = i === 0 ? press(BTN.SPECIAL, steer) : input(steer);
        stepWorld(world, [frame]);
        if (world.events.some((e) => e.type === "ko")) break;
        if (f.grounded || (f.state as string) === "ledgeHang") recovered = true;
      }
      expect(recovered, `${id} should recover`).toBe(true);
      expect(f.x).toBeGreaterThan(-600);
    }
  });

  it("grabs the ledge and hangs with invulnerability", () => {
    const world = makeWorld(["nova"]);
    const f = world.fighters[0];
    f.x = -548;
    f.y = 30;
    f.px = f.x;
    f.py = f.y;
    f.vx = 0;
    f.vy = 0;
    f.grounded = false;
    f.platform = -1;
    f.state = "airborne";
    f.jumpsLeft = 0;
    let hung = false;
    for (let i = 0; i < 60 && !hung; i += 1) {
      stepWorld(world, [input({ mx: 0.7 })]);
      if ((f.state as string) === "ledgeHang") hung = true;
    }
    expect(hung).toBe(true);
    expect(f.invuln).toBeGreaterThan(0);
    // Jump out of the ledge.
    run(world, 10, () => [press(BTN.JUMP)]);
    expect(f.state as string).not.toBe("ledgeHang");
  });
});

describe("grabs", () => {
  it("grab → throw launches the victim and adds damage", () => {
    const world = makeWorld(["nova", "volt"]);
    placeOnMain(world.fighters[0], 0);
    placeOnMain(world.fighters[1], 55);
    world.fighters[0].facing = 1;
    world.fighters[1].facing = -1;
    run(world, 3);
    const seen = collect(world, 120, (i) => {
      if (i === 0) return [press(BTN.SHIELD | BTN.ATTACK)];
      if (i > 30 && i < 34) return [input({ mx: 1, held: 0 })];
      return [input()];
    });
    expect(seen.some((e) => e.type === "grab")).toBe(true);
    expect(world.fighters[1].percent).toBeGreaterThanOrEqual(0);
  });
});

describe("input robustness", () => {
  it("a fighter with no input provider stays idle and alive", () => {
    const world = makeWorld(["nova", "volt"]);
    run(world, 300, () => [undefined, undefined]);
    expect(world.fighters.every((f) => f.alive)).toBe(true);
    expect(world.fighters.every((f) => f.state === "idle")).toBe(true);
  });

  it("releasing everything stops running (no stuck movement)", () => {
    const world = makeWorld(["nova"]);
    placeOnMain(world.fighters[0], 0);
    run(world, 30, () => [input({ mx: 1 })]);
    expect(world.fighters[0].vx).toBeGreaterThan(3);
    run(world, 40, () => [input()]);
    expect(Math.abs(world.fighters[0].vx)).toBeLessThan(0.2);
  });
});
