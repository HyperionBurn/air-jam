import { BTN } from "../sim/types";

/**
 * Gamepad support core: pure logic, no DOM. A browser `Gamepad` is reduced to a `PadSnapshot`;
 * `GamepadMapper` turns snapshots into game input (stick, buttons, right-stick smash) plus menu
 * navigation edges; `PadDriver` applies a reading to anything shaped like an input encoder, so the
 * host (local pads) and the phone/laptop controller page share exactly the same behaviour.
 *
 * Layout (the W3C "standard" mapping that Xbox, DualShock/DualSense and Switch Pro pads all report):
 *
 *   Left stick / D-pad   move
 *   A / ✕                attack          (tilt the stick while pressing = tilts)
 *   B / ○                special         (stick direction picks the special)
 *   X, Y / □, △          jump            (hold = full hop)
 *   LT, RT / L2, R2      shield          (+ stick = roll / spot dodge / air dodge)
 *   LB, RB / L1, R1      grab            (= attack + shield, like the on-screen pad)
 *   Right stick          smash attack    (flick a direction; hold to charge)
 *   Start / Options      confirm in menus, "start now" for the leader
 */

export type PadKind = "xbox" | "playstation" | "switch" | "generic";

export const padKindOf = (id: string): PadKind => {
  const s = id.toLowerCase();
  if (/dualsense|dualshock|playstation|054c|sony/.test(s)) return "playstation";
  if (/xbox|xinput|045e|microsoft/.test(s)) return "xbox";
  if (/switch|pro controller|057e|nintendo|joy-?con/.test(s)) return "switch";
  return "generic";
};

export interface PadLabels {
  name: string;
  attack: string;
  special: string;
  jump: string;
  shield: string;
  grab: string;
  smash: string;
  start: string;
  confirm: string;
  back: string;
}

export const PAD_LABELS: Record<PadKind, PadLabels> = {
  xbox: { name: "Xbox", attack: "A", special: "B", jump: "X / Y", shield: "LT / RT", grab: "LB / RB", smash: "Right stick", start: "Menu", confirm: "A", back: "B" },
  playstation: { name: "PlayStation", attack: "✕", special: "○", jump: "□ / △", shield: "L2 / R2", grab: "L1 / R1", smash: "Right stick", start: "Options", confirm: "✕", back: "○" },
  switch: { name: "Switch Pro", attack: "B", special: "A", jump: "Y / X", shield: "ZL / ZR", grab: "L / R", smash: "Right stick", start: "+", confirm: "B", back: "A" },
  generic: { name: "Gamepad", attack: "A", special: "B", jump: "X / Y", shield: "Triggers", grab: "Bumpers", smash: "Right stick", start: "Start", confirm: "A", back: "B" },
};

export interface PadButtonState {
  pressed: boolean;
  value: number;
}

/** The slice of a browser Gamepad this module needs. */
export interface PadSnapshot {
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly PadButtonState[];
}

export const CSTICK = { NONE: 0, RIGHT: 1, LEFT: 2, UP: 3, DOWN: 4 } as const;

export interface PadReading {
  /** Left stick / D-pad, -1..1, y positive DOWN (sim convention). */
  mx: number;
  my: number;
  /** Held `BTN` bits (face buttons, triggers, grab combo, plus ATTACK while the right stick is deflected). */
  held: number;
  /** Right-stick direction currently deflected (CSTICK.*). */
  cstick: number;
  /** Direction of a smash flick that began on this poll (0 = none). */
  cFlick: number;
  layout: "standard" | "fallback";
}

export interface MenuEdges {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  /** X / □ and Y / △ (secondary actions). */
  x: boolean;
  y: boolean;
  lb: boolean;
  rb: boolean;
  start: boolean;
  select: boolean;
  /** Any button at all went down this poll (used for "press any button to join"). */
  any: boolean;
}

export const STICK_DEAD = 0.14;
export const CSTICK_ON = 0.72;
export const CSTICK_OFF = 0.4;
const TRIGGER_ON = 0.3;
const MENU_STICK = 0.55;
const MENU_FIRST_REPEAT_MS = 380;
const MENU_REPEAT_MS = 130;

const radial = (x: number, y: number, dead: number): [number, number] => {
  const mag = Math.hypot(x, y);
  if (mag < dead) return [0, 0];
  const k = Math.min(1, (mag - dead) / (1 - dead)) / mag;
  return [x * k, y * k];
};

const down = (b: PadButtonState | undefined): boolean => !!b && (b.pressed || b.value > TRIGGER_ON);

const emptyEdges = (): MenuEdges => ({ up: false, down: false, left: false, right: false, confirm: false, back: false, x: false, y: false, lb: false, rb: false, start: false, select: false, any: false });

/** Stateful per-pad mapper (hysteresis, edge detection, menu auto-repeat). */
export class GamepadMapper {
  private cDir: number = CSTICK.NONE;
  private prev: boolean[] = [];
  private readonly rep = { up: { on: false, at: 0 }, down: { on: false, at: 0 }, left: { on: false, at: 0 }, right: { on: false, at: 0 } };

  reset(): void {
    this.cDir = CSTICK.NONE;
    this.prev = [];
    for (const r of Object.values(this.rep)) {
      r.on = false;
      r.at = 0;
    }
  }

  /** Continuous game input for this poll. */
  read(s: PadSnapshot): PadReading {
    const standard = s.mapping === "standard";
    const b = s.buttons;
    let [mx, my] = radial(s.axes[0] ?? 0, s.axes[1] ?? 0, STICK_DEAD);
    if (mx === 0 && my === 0 && standard) {
      const dx = (down(b[15]) ? 1 : 0) - (down(b[14]) ? 1 : 0);
      const dy = (down(b[13]) ? 1 : 0) - (down(b[12]) ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        mx = dx / len;
        my = dy / len;
      }
    }

    let held = 0;
    if (down(b[0])) held |= BTN.ATTACK;
    if (down(b[1])) held |= BTN.SPECIAL;
    if (down(b[2]) || down(b[3])) held |= BTN.JUMP;
    if (standard) {
      if (down(b[6]) || down(b[7])) held |= BTN.SHIELD;
      if (down(b[4]) || down(b[5])) held |= BTN.ATTACK | BTN.SHIELD;
    } else {
      // Unknown layouts: shoulders are the most common shield/grab candidates.
      if (down(b[6]) || down(b[7])) held |= BTN.SHIELD;
      if (down(b[4]) || down(b[5])) held |= BTN.ATTACK | BTN.SHIELD;
    }

    // Right stick → smash direction with hysteresis; a change of direction while held re-flicks.
    const rx = s.axes[2] ?? 0;
    const ry = s.axes[3] ?? 0;
    const rmag = Math.hypot(rx, ry);
    let cFlick = 0;
    const dirOf = (): number => (Math.abs(rx) >= Math.abs(ry) ? (rx > 0 ? CSTICK.RIGHT : CSTICK.LEFT) : ry > 0 ? CSTICK.DOWN : CSTICK.UP);
    if (this.cDir === CSTICK.NONE) {
      if (rmag >= CSTICK_ON) {
        this.cDir = dirOf();
        cFlick = this.cDir;
      }
    } else if (rmag < CSTICK_OFF) {
      this.cDir = CSTICK.NONE;
    } else if (rmag >= CSTICK_ON) {
      const d = dirOf();
      if (d !== this.cDir) {
        this.cDir = d;
        cFlick = d;
      }
    }
    if (this.cDir !== CSTICK.NONE) held |= BTN.ATTACK;

    return { mx, my, held, cstick: this.cDir, cFlick, layout: standard ? "standard" : "fallback" };
  }

  /** Menu navigation edges (D-pad / left stick with auto-repeat, face buttons on press). */
  menu(s: PadSnapshot, now: number): MenuEdges {
    const e = emptyEdges();
    const b = s.buttons;
    const ax = s.axes[0] ?? 0;
    const ay = s.axes[1] ?? 0;
    const want = {
      up: down(b[12]) || ay < -MENU_STICK,
      down: down(b[13]) || ay > MENU_STICK,
      left: down(b[14]) || ax < -MENU_STICK,
      right: down(b[15]) || ax > MENU_STICK,
    };
    for (const k of ["up", "down", "left", "right"] as const) {
      const r = this.rep[k];
      if (want[k]) {
        if (!r.on) {
          r.on = true;
          r.at = now + MENU_FIRST_REPEAT_MS;
          e[k] = true;
        } else if (now >= r.at) {
          r.at = now + MENU_REPEAT_MS;
          e[k] = true;
        }
      } else {
        r.on = false;
      }
    }
    const edge = (i: number): boolean => down(b[i]) && !this.prev[i];
    e.confirm = edge(0);
    e.back = edge(1);
    e.x = edge(2);
    e.y = edge(3);
    e.lb = edge(4);
    e.rb = edge(5);
    e.select = edge(8);
    e.start = edge(9);
    for (let i = 0; i < Math.max(b.length, this.prev.length); i += 1) {
      if (edge(i)) e.any = true;
    }
    this.prev = b.map((x) => down(x));
    return e;
  }
}

/** What a `PadDriver` needs from an input encoder (`InputEncoder` and `InputPipe` both fit). */
export interface PadSink {
  setStick(x: number, y: number): void;
  press(bit: number): void;
  release(bit: number): void;
  /** Right-stick flick: an attack press carrying a smash direction, in one packet. */
  smash(dir: number): void;
}

const BITS = [BTN.JUMP, BTN.ATTACK, BTN.SPECIAL, BTN.SHIELD];

/** Applies readings to a sink, translating level state into press/release edges. */
export class PadDriver {
  private cur = 0;
  private stickActive = false;

  constructor(private readonly sink: PadSink) {}

  /**
   * @param ownStick when false the stick is only driven while the pad actually has a deflection
   *   (so a pad sitting idle never fights an on-screen touch stick on the same controller page).
   */
  apply(r: PadReading, ownStick = true): void {
    const moving = r.mx !== 0 || r.my !== 0;
    if (ownStick || moving || this.stickActive) this.sink.setStick(r.mx, r.my);
    this.stickActive = moving;
    if (r.cFlick) {
      this.sink.smash(r.cFlick);
      this.cur |= BTN.ATTACK;
    }
    for (const bit of BITS) {
      const want = (r.held & bit) !== 0;
      const have = (this.cur & bit) !== 0;
      if (want && !have) this.sink.press(bit);
      else if (!want && have) this.sink.release(bit);
    }
    this.cur = r.held;
  }

  /** Neutralise everything this pad is holding (disconnect, blur, phase change). */
  release(): void {
    if (this.stickActive) this.sink.setStick(0, 0);
    this.stickActive = false;
    for (const bit of BITS) if (this.cur & bit) this.sink.release(bit);
    this.cur = 0;
  }
}

/** Snapshot a browser Gamepad (kept here so DOM typing stays out of the pure logic). */
export const snapshotOf = (g: Gamepad): PadSnapshot => ({ id: g.id, mapping: g.mapping, axes: g.axes, buttons: g.buttons });

/** Short, friendly device name for UI ("Xbox pad", "PlayStation pad"). */
export const padDisplayName = (id: string): string => `${PAD_LABELS[padKindOf(id)].name} pad`;
