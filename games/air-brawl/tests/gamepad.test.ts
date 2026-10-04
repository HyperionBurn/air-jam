import type { AirJamActionContext } from "@air-jam/sdk";
import { describe, expect, it } from "vitest";
import {
  CSTICK,
  GamepadMapper,
  PadDriver,
  padKindOf,
  type PadButtonState,
  type PadSnapshot,
} from "../src/game/net/gamepad";
import { InputDecoder, InputEncoder } from "../src/game/net/input-codec";
import { handlePadMenu, type PadMenuActions } from "../src/game/session/pad-menu";
import {
  createInitialState,
  reduceSetFighter,
  reduceSetReady,
  reduceSyncRoster,
  reduceVoteStage,
} from "../src/game/session/reducers";
import type { AirBrawlState, RosterSync } from "../src/game/session/types";
import { BTN } from "../src/game/sim";
import { hold, input, makeWorld, press, run } from "./helpers";
import { stepWorld } from "../src/game/sim";

/* ------------------------------------------------------------------ helpers */

const NEUTRAL_BUTTONS = (): PadButtonState[] => Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
const snap = (o: { axes?: number[]; down?: number[]; mapping?: string; id?: string } = {}): PadSnapshot & { buttons: PadButtonState[] } => {
  const buttons = NEUTRAL_BUTTONS();
  for (const i of o.down ?? []) buttons[i] = { pressed: true, value: 1 };
  return { id: o.id ?? "Xbox 360 Controller (XInput STANDARD GAMEPAD)", mapping: o.mapping ?? "standard", axes: o.axes ?? [0, 0, 0, 0], buttons };
};

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/* ------------------------------------------------------------------- device */

describe("device detection", () => {
  it("recognises Xbox, PlayStation and Switch pads from their browser ids", () => {
    expect(padKindOf("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe("xbox");
    expect(padKindOf("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)")).toBe("xbox");
    expect(padKindOf("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")).toBe("playstation");
    expect(padKindOf("054c-09cc-DualShock 4")).toBe("playstation");
    expect(padKindOf("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")).toBe("switch");
    expect(padKindOf("Some Arcade Stick")).toBe("generic");
  });
});

/* ------------------------------------------------------------------- mapper */

describe("GamepadMapper", () => {
  it("applies a radial deadzone so stick drift never moves a fighter", () => {
    const m = new GamepadMapper();
    const r = m.read(snap({ axes: [0.08, -0.1, 0, 0] }));
    expect(r.mx).toBe(0);
    expect(r.my).toBe(0);
    const full = m.read(snap({ axes: [1, 0, 0, 0] }));
    expect(full.mx).toBeCloseTo(1, 5);
    const half = m.read(snap({ axes: [0.5, 0, 0, 0] }));
    expect(half.mx).toBeGreaterThan(0.3);
    expect(half.mx).toBeLessThan(0.5);
  });

  it("keeps stick direction and y-down convention", () => {
    const r = new GamepadMapper().read(snap({ axes: [0, 1, 0, 0] }));
    expect(r.my).toBeCloseTo(1, 5);
  });

  it("falls back to the D-pad when the stick is idle, normalising diagonals", () => {
    const m = new GamepadMapper();
    expect(m.read(snap({ down: [B.RIGHT] })).mx).toBe(1);
    const d = m.read(snap({ down: [B.UP, B.LEFT] }));
    expect(d.mx).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(d.my).toBeCloseTo(-Math.SQRT1_2, 5);
    // The analog stick wins when both are used.
    expect(m.read(snap({ axes: [0.9, 0, 0, 0], down: [B.LEFT] })).mx).toBeGreaterThan(0.5);
  });

  it("maps face buttons, triggers and bumpers like the on-screen pad", () => {
    const m = new GamepadMapper();
    expect(m.read(snap({ down: [B.A] })).held).toBe(BTN.ATTACK);
    expect(m.read(snap({ down: [B.B] })).held).toBe(BTN.SPECIAL);
    expect(m.read(snap({ down: [B.X] })).held).toBe(BTN.JUMP);
    expect(m.read(snap({ down: [B.Y] })).held).toBe(BTN.JUMP);
    expect(m.read(snap({ down: [B.LT] })).held).toBe(BTN.SHIELD);
    expect(m.read(snap({ down: [B.RT] })).held).toBe(BTN.SHIELD);
    expect(m.read(snap({ down: [B.LB] })).held).toBe(BTN.ATTACK | BTN.SHIELD);
    expect(m.read(snap({ down: [B.RB, B.X] })).held).toBe(BTN.ATTACK | BTN.SHIELD | BTN.JUMP);
  });

  it("treats a half-pulled analog trigger as shield", () => {
    const s = snap();
    s.buttons[B.LT] = { pressed: false, value: 0.6 };
    expect(new GamepadMapper().read(s).held).toBe(BTN.SHIELD);
    s.buttons[B.LT] = { pressed: false, value: 0.1 };
    expect(new GamepadMapper().read(s).held).toBe(0);
  });

  it("right stick: flicks a smash once, holds attack while deflected, hysteresis on release", () => {
    const m = new GamepadMapper();
    const rest = m.read(snap());
    expect(rest.cstick).toBe(CSTICK.NONE);
    const flick = m.read(snap({ axes: [0, 0, 1, 0] }));
    expect(flick.cFlick).toBe(CSTICK.RIGHT);
    expect(flick.cstick).toBe(CSTICK.RIGHT);
    expect(flick.held & BTN.ATTACK).toBe(BTN.ATTACK);
    // Still deflected: no second flick, attack stays held (charging).
    const held = m.read(snap({ axes: [0, 0, 0.95, 0] }));
    expect(held.cFlick).toBe(0);
    expect(held.held & BTN.ATTACK).toBe(BTN.ATTACK);
    // Easing back but not past the release threshold keeps it engaged.
    expect(m.read(snap({ axes: [0, 0, 0.5, 0] })).cstick).toBe(CSTICK.RIGHT);
    // Released.
    const off = m.read(snap({ axes: [0, 0, 0.1, 0] }));
    expect(off.cstick).toBe(CSTICK.NONE);
    expect(off.held & BTN.ATTACK).toBe(0);
  });

  it("right stick: picks the dominant axis and re-flicks when the direction changes", () => {
    const m = new GamepadMapper();
    expect(m.read(snap({ axes: [0, 0, 0.2, -1] })).cFlick).toBe(CSTICK.UP);
    expect(m.read(snap({ axes: [0, 0, 0, 1] })).cFlick).toBe(CSTICK.DOWN);
    expect(m.read(snap({ axes: [0, 0, -1, 0.1] })).cFlick).toBe(CSTICK.LEFT);
  });

  it("falls back gracefully on non-standard layouts (no shield/dpad guesses, still playable)", () => {
    const r = new GamepadMapper().read(snap({ mapping: "", axes: [1, 0, 0, 0], down: [B.A, B.X, B.RIGHT] }));
    expect(r.layout).toBe("fallback");
    expect(r.mx).toBe(1);
    expect(r.held & BTN.ATTACK).toBeTruthy();
    expect(r.held & BTN.JUMP).toBeTruthy();
  });
});

describe("menu edges", () => {
  it("fires confirm/back once per press and reports any-button for joining", () => {
    const m = new GamepadMapper();
    expect(m.menu(snap(), 0).any).toBe(false);
    const e = m.menu(snap({ down: [B.A] }), 16);
    expect(e.confirm).toBe(true);
    expect(e.any).toBe(true);
    expect(m.menu(snap({ down: [B.A] }), 32).confirm).toBe(false);
    expect(m.menu(snap(), 48).any).toBe(false);
    expect(m.menu(snap({ down: [B.B] }), 64).back).toBe(true);
    expect(m.menu(snap({ down: [B.START] }), 80).start).toBe(true);
  });

  it("auto-repeats direction presses after a delay, from stick or D-pad", () => {
    const m = new GamepadMapper();
    expect(m.menu(snap({ down: [B.DOWN] }), 0).down).toBe(true);
    expect(m.menu(snap({ down: [B.DOWN] }), 100).down).toBe(false);
    expect(m.menu(snap({ down: [B.DOWN] }), 420).down).toBe(true);
    expect(m.menu(snap({ down: [B.DOWN] }), 470).down).toBe(false);
    expect(m.menu(snap({ down: [B.DOWN] }), 560).down).toBe(true);
    m.menu(snap(), 600);
    expect(m.menu(snap({ axes: [0, -0.9, 0, 0] }), 620).up).toBe(true);
  });

  it("reports a pad that is already held when it first appears as a press (join on first button)", () => {
    expect(new GamepadMapper().menu(snap({ down: [B.START] }), 0).any).toBe(true);
  });
});

/* ------------------------------------------------------------- driver/wire */

describe("PadDriver + wire format", () => {
  const rig = () => {
    const enc = new InputEncoder();
    const dec = new InputDecoder();
    const drv = new PadDriver(enc);
    const m = new GamepadMapper();
    let t = 100;
    const frame = (s: PadSnapshot, own = true) => {
      drv.apply(m.read(s), own);
      t += 16;
      return dec.read(enc.snapshot(t), t);
    };
    return { enc, dec, drv, m, frame };
  };

  it("turns level state into stick + press edges the host decodes as taps", () => {
    const { frame } = rig();
    frame(snap());
    const f = frame(snap({ axes: [0.9, 0, 0, 0], down: [B.A] }));
    expect(f.mx).toBeGreaterThan(0.7);
    expect(f.held).toBe(BTN.ATTACK);
    expect(f.taps).toBe(BTN.ATTACK);
    const g = frame(snap({ axes: [0.9, 0, 0, 0], down: [B.A] }));
    expect(g.taps).toBe(0);
    const h = frame(snap());
    expect(h.held).toBe(0);
    expect(h.mx).toBe(0);
  });

  it("grab (bumper) presses attack and shield together", () => {
    const { frame } = rig();
    frame(snap());
    const f = frame(snap({ down: [B.LB] }));
    expect(f.held).toBe(BTN.ATTACK | BTN.SHIELD);
    expect(f.taps).toBe(BTN.ATTACK | BTN.SHIELD);
  });

  it("a right-stick flick arrives with its direction in the same decoded frame as the attack tap", () => {
    const { frame } = rig();
    frame(snap());
    const f = frame(snap({ axes: [0, 0, -1, 0] }));
    expect(f.flick).toBe(CSTICK.LEFT);
    expect(f.taps & BTN.ATTACK).toBe(BTN.ATTACK);
    expect(f.held & BTN.ATTACK).toBe(BTN.ATTACK);
    // Next frames: no repeated flick, attack held for charging, then released with the stick.
    expect(frame(snap({ axes: [0, 0, -1, 0] })).flick).toBe(0);
    const off = frame(snap());
    expect(off.held & BTN.ATTACK).toBe(0);
  });

  it("never loses a flick even if the host reads only every few packets", () => {
    const enc = new InputEncoder();
    const dec = new InputDecoder();
    dec.read(enc.snapshot(0), 0);
    enc.smash(CSTICK.UP);
    enc.release(BTN.ATTACK);
    enc.snapshot(5); // packet the host never reads
    enc.snapshot(10);
    const f = dec.read(enc.snapshot(16), 16);
    expect(f.flick).toBe(CSTICK.UP);
    expect(f.taps & BTN.ATTACK).toBe(BTN.ATTACK);
  });

  it("an idle pad on a controller page never fights the touch stick, but a moving one still drives it", () => {
    const calls: [number, number][] = [];
    const sink = { setStick: (x: number, y: number) => calls.push([x, y]), press: () => undefined, release: () => undefined, smash: () => undefined };
    const drv = new PadDriver(sink);
    const m = new GamepadMapper();
    drv.apply(m.read(snap()), false);
    expect(calls).toHaveLength(0);
    drv.apply(m.read(snap({ axes: [1, 0, 0, 0] })), false);
    expect(calls.at(-1)?.[0]).toBeCloseTo(1, 5);
    drv.apply(m.read(snap()), false);
    expect(calls.at(-1)).toEqual([0, 0]);
    const n = calls.length;
    drv.apply(m.read(snap()), false);
    expect(calls).toHaveLength(n);
  });

  it("release() neutralises everything the pad held", () => {
    const { enc, drv, m } = rig();
    drv.apply(m.read(snap({ axes: [1, 0, 0, 0], down: [B.A, B.LT] })), true);
    expect(enc.isNeutral).toBe(false);
    drv.release();
    expect(enc.isNeutral).toBe(true);
  });
});

/* ---------------------------------------------------------------- simulation */

describe("right-stick smash in the sim", () => {
  const smashOf = (flick: number): string | null => {
    const world = makeWorld(["nova"]);
    run(world, 12);
    stepWorld(world, [input({ held: BTN.ATTACK, taps: BTN.ATTACK, flick })]);
    run(world, 2, () => [hold(BTN.ATTACK)]);
    return world.fighters[0].moveId;
  };

  it("a flick right/up/down launches the matching smash immediately", () => {
    expect(smashOf(CSTICK.RIGHT)).toBe("fsmash");
    expect(smashOf(CSTICK.LEFT)).toBe("fsmash");
    expect(smashOf(CSTICK.UP)).toBe("usmash");
    expect(smashOf(CSTICK.DOWN)).toBe("dsmash");
  });

  it("is a smash even while already running in that direction (a plain stick press would not be)", () => {
    const world = makeWorld(["nova"]);
    run(world, 30, () => [input({ mx: 1 })]);
    stepWorld(world, [input({ mx: 1, held: BTN.ATTACK, taps: BTN.ATTACK, flick: CSTICK.RIGHT })]);
    run(world, 2, () => [input({ mx: 1, held: BTN.ATTACK })]);
    expect(world.fighters[0].moveId).toBe("fsmash");

    const control = makeWorld(["nova"]);
    run(control, 30, () => [input({ mx: 1 })]);
    stepWorld(control, [press(BTN.ATTACK, { mx: 1 })]);
    run(control, 2, () => [input({ mx: 1, held: BTN.ATTACK })]);
    expect(control.fighters[0].moveId).not.toBe("fsmash");
  });
});

/* ------------------------------------------------------- local pad players */

const base = (): AirBrawlState => ({ ...createInitialState(), actions: {} as AirBrawlState["actions"] });
const host = { role: "host", actorId: "host" } as unknown as AirJamActionContext;
const phone = (id: string) => ({ role: "controller", actorId: id }) as unknown as AirJamActionContext;

const withPads = (): AirBrawlState => {
  const controllers: RosterSync[] = [
    { id: "phone-1", name: "Phone", connected: true },
    { id: "pad:0", name: "Xbox 1", connected: true, local: true },
    { id: "pad:1", name: "PlayStation 1", connected: true, local: true },
  ];
  return reduceSyncRoster(base(), host, { controllers });
};

describe("local pad players", () => {
  it("join the roster as human, non-bot players flagged local", () => {
    const s = withPads();
    expect(s.players["pad:0"].local).toBe(true);
    expect(s.players["pad:0"].isBot).toBe(false);
    expect(s.players["phone-1"].local).toBeFalsy();
  });

  it("the host may act for a local pad (and only for local pads)", () => {
    let s = withPads();
    s = reduceSetReady(s, host, { ready: true, playerId: "pad:0" });
    expect(s.players["pad:0"].ready).toBe(true);
    expect(s.players["phone-1"].ready).toBe(false);
    const f = s.players["pad:1"].fighterId;
    s = reduceSetFighter(s, host, { fighterId: f === "nova" ? "volt" : "nova", playerId: "pad:1" });
    expect(s.players["pad:1"].fighterId).not.toBe(f);
    // Host cannot impersonate a phone via playerId.
    const before = s.players["phone-1"].ready;
    s = reduceSetReady(s, host, { ready: true, playerId: "phone-1" });
    expect(s.players["phone-1"].ready).toBe(before);
  });

  it("a phone cannot use playerId to act for a pad", () => {
    let s = withPads();
    s = reduceSetReady(s, phone("phone-1"), { ready: true, playerId: "pad:0" });
    expect(s.players["pad:0"].ready).toBe(false);
    expect(s.players["phone-1"].ready).toBe(true);
  });

  it("pad players can vote for a stage", () => {
    let s = withPads();
    s = reduceVoteStage(s, host, { stage: "foundry", playerId: "pad:0" });
    expect(s.players["pad:0"].stageVote).toBe("foundry");
  });

  it("an unplugged pad disappears from the lobby roster", () => {
    let s = withPads();
    s = reduceSyncRoster(s, host, { controllers: [{ id: "phone-1", name: "Phone", connected: true }] });
    expect(s.players["pad:0"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ pad menu */

describe("pad menu rules", () => {
  const edges = (o: Partial<Record<string, boolean>> = {}) => ({
    up: false, down: false, left: false, right: false, confirm: false, back: false, x: false, y: false, lb: false, rb: false, start: false, select: false, any: false,
    ...o,
  });
  const log: string[] = [];
  const act: PadMenuActions = {
    setFighter: (id, f) => log.push(`fighter:${id}:${f}`),
    setReady: (id, r) => log.push(`ready:${id}:${r}`),
    setTeam: (id, t) => log.push(`team:${id}:${t}`),
    voteStage: (id, s) => log.push(`stage:${id}:${s}`),
    updateSettings: (p) => log.push(`settings:${JSON.stringify(p)}`),
    startMatch: (f) => log.push(`start:${f}`),
    rematch: () => log.push("rematch"),
    returnToLobby: () => log.push("lobby"),
  };
  const fresh = () => {
    log.length = 0;
    return withPads(); // pad:0 is slot 1, phone-1 is the leader (slot 0)
  };

  it("A toggles ready, B un-readies, left/right change fighter only while not ready", () => {
    let s = fresh();
    handlePadMenu("pad:0", edges({ confirm: true }), s, act);
    expect(log).toContain("ready:pad:0:true");
    s = reduceSetReady(s, host, { ready: true, playerId: "pad:0" });
    log.length = 0;
    handlePadMenu("pad:0", edges({ right: true }), s, act);
    expect(log.some((l) => l.startsWith("fighter"))).toBe(false);
    handlePadMenu("pad:0", edges({ back: true }), s, act);
    expect(log).toContain("ready:pad:0:false");
  });

  it("left/right cycle through all fighters and wrap", () => {
    const s = fresh();
    const start = s.players["pad:0"].fighterId;
    handlePadMenu("pad:0", edges({ right: true }), s, act);
    expect(log[0]).toMatch(/^fighter:pad:0:/);
    expect(log[0]).not.toContain(start);
    log.length = 0;
    handlePadMenu("pad:0", edges({ left: true }), s, act);
    expect(log[0]).toMatch(/^fighter:pad:0:/);
  });

  it("up/down cycles the stage vote through 'any' and every stage", () => {
    const s = fresh();
    handlePadMenu("pad:0", edges({ down: true }), s, act);
    expect(log[0]).toMatch(/^stage:pad:0:/);
    expect(log[0]).not.toContain("null");
  });

  it("only the room leader gets CPU / preset / start controls", () => {
    let s = fresh();
    handlePadMenu("pad:0", edges({ lb: true, rb: true, y: true, select: true, start: true }), s, act);
    expect(log.some((l) => l.startsWith("settings"))).toBe(false);
    expect(log).not.toContain("start:true");
    // Start from a non-leader pad is just ready-up.
    expect(log).toContain("ready:pad:0:true");

    // Make the pad the leader: the phone leaves.
    s = reduceSyncRoster(s, host, { controllers: [{ id: "pad:0", name: "Xbox 1", connected: true, local: true }, { id: "pad:1", name: "PS 1", connected: true, local: true }] });
    log.length = 0;
    handlePadMenu("pad:0", edges({ rb: true }), s, act);
    expect(log).toContain('settings:{"botCount":1}');
    handlePadMenu("pad:0", edges({ y: true }), s, act);
    expect(log).toContain('settings:{"preset":"fastParty"}');
  });

  it("leader Start force-starts once a match is possible; results screen Start = rematch", () => {
    let s = reduceSyncRoster(base(), host, {
      controllers: [{ id: "pad:0", name: "Xbox 1", connected: true, local: true }, { id: "pad:1", name: "PS 1", connected: true, local: true }],
    });
    log.length = 0;
    handlePadMenu("pad:0", edges({ start: true }), s, act);
    expect(log).toContain("start:true");
    log.length = 0;
    s = { ...s, matchPhase: "ended" };
    handlePadMenu("pad:1", edges({ start: true }), s, act);
    expect(log).toContain("rematch");
    handlePadMenu("pad:0", edges({ back: true }), s, act);
    expect(log).toContain("lobby");
  });

  it("ignores pads that are not local players", () => {
    const s = fresh();
    handlePadMenu("phone-1", edges({ confirm: true }), s, act);
    handlePadMenu("pad:99", edges({ confirm: true }), s, act);
    expect(log).toHaveLength(0);
  });
});
