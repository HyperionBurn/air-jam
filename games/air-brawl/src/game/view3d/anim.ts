import { currentMove } from "../sim/ops";
import type { AnimId, Fighter, FighterId, HitboxDef, MoveDef } from "../sim/types";

/**
 * Sim state → articulated pose.
 *
 * Conventions (side-view plane, model forward = +z):
 *   arm.sh   0 = pointing forward, PI/2 = hanging down, -PI/2 = straight up
 *   leg.hip  0 = hanging down, + = swinging forward
 *   arm.el / leg.knee  flexion, 0 = straight
 * Targets are authored per state; a spring layer then adds anticipation lag, overshoot and
 * follow-through. Channels flagged in `snap` bypass the springs (the striking limb is placed
 * exactly on the live hitbox, so what you see is what collides).
 */

export interface ArmPose {
  sh: number;
  ab: number;
  el: number;
  wr: number;
  ext: number;
}
export interface LegPose {
  hip: number;
  ab: number;
  knee: number;
  ankle: number;
}
export interface Expression {
  anger: number;
  open: number;
  wide: number;
}

export interface Pose {
  hipY: number;
  hipZ: number;
  pitch: number;
  roll: number;
  pelvisYaw: number;
  pelvisRoll: number;
  spine: number;
  chestYaw: number;
  chestRoll: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  arm: [ArmPose, ArmPose];
  leg: [LegPose, LegPose];
  squashX: number;
  squashY: number;
  /** Signed lunge: >0 committed forward, <0 coiled back. */
  strike: number;
  alpha: number;
  expr: Expression;
  /** Stretch along the flight direction while launched (0..1). */
  stretch: number;
  /** 0..1 how loud a swing is (drives smears / afterimages). */
  swing: number;
  /** Bitmask of channel groups that bypass the spring layer. */
  snap: number;
  /** Which arm leads the current strike (0 = near arm). */
  strikeArm: 0 | 1;
  /** True while the body has fully left the ground plane (floaty fighters hover). */
  hover: boolean;
}

export const SNAP_ARM0 = 1;
export const SNAP_ARM1 = 2;
export const SNAP_LEG0 = 4;
export const SNAP_LEG1 = 8;
export const SNAP_ROOT = 16;
export const SNAP_ALL = 31;

const newArm = (sh = 1.0, el = 0.9): ArmPose => ({ sh, ab: 0.1, el, wr: 0, ext: 1 });
const newLeg = (hip = 0, knee = 0.1): LegPose => ({ hip, ab: 0.04, knee, ankle: 0 });

export const newPose = (): Pose => ({
  hipY: 0,
  hipZ: 0,
  pitch: 0,
  roll: 0,
  pelvisYaw: 0,
  pelvisRoll: 0,
  spine: 0,
  chestYaw: 0,
  chestRoll: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  arm: [newArm(0.8, 1.1), newArm(1.0, 1.0)],
  leg: [newLeg(0.12, 0.2), newLeg(-0.1, 0.18)],
  squashX: 1,
  squashY: 1,
  strike: 0,
  alpha: 1,
  expr: { anger: 0, open: 0, wide: 0 },
  stretch: 0,
  swing: 0,
  snap: 0,
  strikeArm: 0,
  hover: false,
});

/* ------------------------------------------------------------- style sheet */

/** What makes each fighter move like itself. All values are authored multipliers/targets. */
export interface StyleProfile {
  id: FighterId;
  floats: boolean;
  /** Idle: stance width (hip angle), bounce amplitude (u), rate, guard elbow flexion. */
  idleStance: number;
  idleBounce: number;
  idleRate: number;
  idleSway: number;
  guardEl: number;
  guardSh: number;
  /** Locomotion. */
  runLean: number;
  runRate: number;
  runBounce: number;
  runSwing: number;
  runKnee: number;
  walkRate: number;
  /** Attacks: windup depth, torso twist, forward lunge, snap-back overshoot. */
  windup: number;
  twist: number;
  lunge: number;
  recoil: number;
  /** Air & landing. */
  jumpDip: number;
  landDip: number;
  flip: boolean;
  /** Reaction. */
  hurt: number;
  /** How eagerly the head turns to look at the opponent. */
  look: number;
}

export const STYLES: Record<FighterId, StyleProfile> = {
  // Disciplined all-rounder: boxer's guard, crisp economy of motion.
  nova: {
    id: "nova", floats: false,
    idleStance: 0.2, idleBounce: 1.6, idleRate: 0.13, idleSway: 0.035, guardEl: 1.5, guardSh: 0.55,
    runLean: 0.3, runRate: 0.052, runBounce: 3.4, runSwing: 0.85, runKnee: 1.15, walkRate: 0.05,
    windup: 1.0, twist: 0.55, lunge: 1.0, recoil: 1.0,
    jumpDip: 1.0, landDip: 1.0, flip: false, hurt: 1.0, look: 0.8,
  },
  // Speedster: twitchy toe-bounce, extreme forward lean, wide whipping arcs, acrobatic air game.
  volt: {
    id: "volt", floats: false,
    idleStance: 0.3, idleBounce: 3.1, idleRate: 0.24, idleSway: 0.06, guardEl: 1.3, guardSh: 0.35,
    runLean: 0.5, runRate: 0.07, runBounce: 4.6, runSwing: 1.15, runKnee: 1.45, walkRate: 0.07,
    windup: 0.65, twist: 0.85, lunge: 1.25, recoil: 1.35,
    jumpDip: 0.85, landDip: 0.8, flip: true, hurt: 1.15, look: 1.0,
  },
  // Heavy: slow weight transfer, deep coils, stomping gait, huge follow-through.
  bulwark: {
    id: "bulwark", floats: false,
    idleStance: 0.34, idleBounce: 1.0, idleRate: 0.07, idleSway: 0.05, guardEl: 1.2, guardSh: 0.8,
    runLean: 0.22, runRate: 0.04, runBounce: 5.2, runSwing: 0.6, runKnee: 0.9, walkRate: 0.035,
    windup: 1.55, twist: 0.8, lunge: 0.8, recoil: 0.6,
    jumpDip: 1.5, landDip: 1.7, flip: false, hurt: 0.6, look: 0.5,
  },
  // Floaty trickster: no legs, flowing arms, everything eased and lagged.
  wisp: {
    id: "wisp", floats: true,
    idleStance: 0.1, idleBounce: 5.5, idleRate: 0.075, idleSway: 0.09, guardEl: 0.9, guardSh: 0.9,
    runLean: 0.34, runRate: 0.05, runBounce: 2.0, runSwing: 0.5, runKnee: 0.4, walkRate: 0.045,
    windup: 1.2, twist: 0.4, lunge: 0.7, recoil: 1.1,
    jumpDip: 0.5, landDip: 0.4, flip: false, hurt: 1.3, look: 1.0,
  },
};

export interface PoseSpec {
  shoulderX: number;
  shoulderY: number;
  armLen: number;
  hipHeight: number;
}

/* ---------------------------------------------------------------- helpers */

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
const easeIn = (t: number): number => Math.pow(clamp01(t), 2.4);
const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const easeOutBack = (t: number): number => {
  const x = clamp01(t) - 1;
  return 1 + 2.7 * x * x * x + 1.7 * x * x;
};

const ARM_ANIMS = new Set<AnimId>(["jab", "jab2", "jab3", "tilt", "uptilt", "smash", "upsmash", "dash", "fair", "uair", "lunge", "rise", "toss", "pummel", "throw", "grab", "ledge"]);
const LEG_ANIMS = new Set<AnimId>(["downtilt", "downsmash", "bair", "dair"]);
const HEAVY_ANIMS = new Set<AnimId>(["smash", "upsmash", "downsmash", "slam", "dair"]);

/* -------------------------------------------------------- spring follower */

interface Chan {
  get: (p: Pose) => number;
  set: (p: Pose, v: number) => void;
  k: number;
  z: number;
  group: number;
}

const root = (key: keyof Pose, k: number, z: number): Chan => ({
  get: (p) => p[key] as number,
  set: (p, v) => {
    (p[key] as number) = v;
  },
  k,
  z,
  group: SNAP_ROOT,
});

const armChan = (i: 0 | 1, key: keyof ArmPose, k: number, z: number): Chan => ({
  get: (p) => p.arm[i][key],
  set: (p, v) => {
    p.arm[i][key] = v;
  },
  k,
  z,
  group: i === 0 ? SNAP_ARM0 : SNAP_ARM1,
});

const legChan = (i: 0 | 1, key: keyof LegPose, k: number, z: number): Chan => ({
  get: (p) => p.leg[i][key],
  set: (p, v) => {
    p.leg[i][key] = v;
  },
  k,
  z,
  group: i === 0 ? SNAP_LEG0 : SNAP_LEG1,
});

const CHANNELS: Chan[] = [
  root("hipY", 0.5, 0.8),
  root("hipZ", 0.45, 0.8),
  root("pitch", 0.34, 0.75),
  root("pelvisYaw", 0.36, 0.7),
  root("pelvisRoll", 0.3, 0.7),
  root("spine", 0.3, 0.6),
  root("chestYaw", 0.34, 0.6),
  root("chestRoll", 0.28, 0.65),
  root("headPitch", 0.26, 0.5),
  root("headYaw", 0.24, 0.55),
  root("headRoll", 0.22, 0.45),
  root("squashX", 0.5, 0.55),
  root("squashY", 0.5, 0.55),
];
for (const i of [0, 1] as const) {
  CHANNELS.push(armChan(i, "sh", 0.4, 0.62), armChan(i, "ab", 0.3, 0.7), armChan(i, "el", 0.38, 0.6), armChan(i, "wr", 0.22, 0.4), armChan(i, "ext", 0.5, 0.75));
  CHANNELS.push(legChan(i, "hip", 0.46, 0.75), legChan(i, "ab", 0.3, 0.7), legChan(i, "knee", 0.5, 0.7), legChan(i, "ankle", 0.34, 0.5));
}

/** Critically-ish damped followers for every pose channel. */
export class PoseSpring {
  private readonly x: Float64Array;
  private readonly v: Float64Array;
  private ready = false;

  constructor() {
    this.x = new Float64Array(CHANNELS.length);
    this.v = new Float64Array(CHANNELS.length);
  }

  reset(): void {
    this.ready = false;
  }

  step(target: Pose, dt: number, stiffness: number): Pose {
    const out = target;
    if (!this.ready) {
      CHANNELS.forEach((c, i) => {
        this.x[i] = c.get(target);
        this.v[i] = 0;
      });
      this.ready = true;
      return out;
    }
    const sub = Math.max(1, Math.ceil(dt));
    const h = dt / sub;
    for (let i = 0; i < CHANNELS.length; i += 1) {
      const c = CHANNELS[i];
      const goal = c.get(target);
      if (target.snap & c.group) {
        this.x[i] = goal;
        this.v[i] = 0;
        continue;
      }
      const k = c.k * stiffness;
      const damp = 2 * c.z * Math.sqrt(k);
      let x = this.x[i];
      let v = this.v[i];
      for (let s = 0; s < sub; s += 1) {
        v += (k * (goal - x) - damp * v) * h;
        x += v * h;
      }
      this.x[i] = x;
      this.v[i] = v;
      c.set(out, x);
    }
    // Springs may overshoot; a scale must never go through zero (inside-out mesh).
    out.squashX = Math.max(0.02, out.squashX);
    out.squashY = Math.max(0.02, out.squashY);
    return out;
  }
}

/* ------------------------------------------------------------ pose driver */

export class PoseDriver {
  private stride = 0;
  private spin = 0;
  private lastJumps = -1;
  private djT = 0;
  private djDir = 1;
  private lastState = "";
  private stateT = 0;
  private lastAnimMove: string | null = null;
  private blinkT = 120;
  private hurtPhase = 0;
  readonly spring = new PoseSpring();
  private held: Pose | null = null;
  readonly style: StyleProfile;

  constructor(
    private readonly spec: PoseSpec,
    fighterId: FighterId,
  ) {
    this.style = STYLES[fighterId];
  }

  /** Returns the smoothed pose for this render frame. */
  update(f: Fighter, time: number, dt: number): Pose {
    // Hitlag freezes the animation exactly where the hit landed (the model shakes on its own).
    if (f.hitlag > 0 && this.held) return this.held;
    const target = this.target(f, time, dt);
    const out = this.spring.step(target, dt, 1);
    this.held = out;
    return out;
  }

  private target(f: Fighter, time: number, dt: number): Pose {
    const st = this.style;
    const p = newPose();
    p.hover = st.floats;
    if (f.state !== this.lastState) {
      this.lastState = f.state;
      this.stateT = 0;
    }
    this.stateT += dt;

    if (this.lastJumps >= 0 && f.jumpsLeft < this.lastJumps && !f.grounded) {
      this.djT = 1;
      this.djDir = f.facing;
    }
    this.lastJumps = f.jumpsLeft;
    this.djT = Math.max(0, this.djT - dt / (st.flip ? 34 : 24));

    if (f.invuln > 0 && f.state !== "respawn") p.alpha = 0.62 + 0.38 * Math.abs(Math.sin(time * 0.55));
    if (f.state === "roll" || f.state === "spotDodge" || f.state === "airDodge") p.alpha = 0.42;

    this.blinkT -= dt;
    switch (f.state) {
      case "idle":
        this.idle(f, p, time);
        break;
      case "victory":
        this.victory(f, p, time);
        break;
      case "walk":
      case "run":
        this.locomotion(f, p, dt);
        break;
      case "turn":
        this.turn(f, p);
        break;
      case "jumpsquat":
        this.jumpsquat(f, p);
        break;
      case "land":
        this.land(f, p);
        break;
      case "airborne":
      case "airDodge":
        this.airborne(f, p, time);
        break;
      case "shield":
      case "shieldStun":
        this.shield(f, p, time);
        break;
      case "shieldBreak":
        this.shieldBreak(f, p, time);
        break;
      case "roll":
      case "spotDodge":
      case "ledgeRoll":
        this.dodge(f, p);
        break;
      case "hitstun":
        this.hitstun(f, p, time, dt);
        break;
      case "grab":
      case "grabbing":
        this.grabPose(f, p);
        break;
      case "grabbed":
        this.grabbed(f, p, time);
        break;
      case "ledgeHang":
      case "ledgeClimb":
        this.ledge(f, p, time);
        break;
      case "respawn":
        this.respawn(f, p, time);
        break;
      case "attack":
      case "airAttack":
      case "special":
      case "airSpecial":
      case "ledgeAttack":
      case "throw":
        this.poseMove(f, p, time);
        break;
      default:
        this.idle(f, p, time);
        break;
    }
    this.face(f, p);
    return p;
  }

  /* --------------------------------------------------------------- face */

  private face(f: Fighter, p: Pose): void {
    const e = p.expr;
    switch (f.state) {
      case "attack":
      case "airAttack":
      case "special":
      case "airSpecial":
      case "throw":
      case "ledgeAttack": {
        const move = currentMove(f);
        const live = move?.hitboxes.some((b) => f.sf >= b.from && f.sf <= b.to);
        e.anger = 0.75;
        e.open = live ? 1 : 0.15;
        break;
      }
      case "hitstun":
        e.wide = 1;
        e.open = f.hitlag > 0 ? 0.4 : 0.9;
        break;
      case "shieldBreak":
        e.wide = 1;
        e.open = 0.7;
        break;
      case "run":
        e.anger = 0.3;
        break;
      case "shield":
      case "shieldStun":
        e.anger = 0.5;
        break;
      case "victory":
        e.open = 0.7;
        break;
      case "grabbed":
        e.wide = 0.7;
        e.open = 0.5;
        break;
      case "ledgeHang":
        e.wide = 0.3;
        e.anger = 0.3;
        break;
      case "jumpsquat":
        e.anger = 0.25;
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- idle */

  private idle(f: Fighter, p: Pose, time: number): void {
    const s = this.style;
    const t = time * s.idleRate + f.slot * 1.7;
    const breathe = Math.sin(t);
    const sway = Math.sin(t * 0.5 + 1.3);
    p.hipY = (s.floats ? breathe * s.idleBounce : Math.abs(breathe) * -s.idleBounce * 0.5 + s.idleBounce * 0.25);
    p.squashY = 1 + breathe * 0.01;
    p.pitch = 0.04 + sway * s.idleSway * 0.3;
    p.chestYaw = 0.12 + sway * s.idleSway;
    p.pelvisYaw = -0.08 - sway * s.idleSway * 0.5;
    p.spine = 0.05 + breathe * 0.02;
    p.headYaw = -0.1 + sway * 0.04;
    p.headPitch = breathe * 0.02;
    p.leg[0].hip = s.idleStance;
    p.leg[1].hip = -s.idleStance * 0.7;
    p.leg[0].knee = 0.28 + (1 - Math.abs(breathe)) * 0.08 * (s.floats ? 0 : 1);
    p.leg[1].knee = 0.22;
    p.leg[0].ankle = -0.04;
    p.arm[0] = { sh: s.guardSh + breathe * 0.04, ab: 0.2, el: s.guardEl, wr: -0.2, ext: 1 };
    p.arm[1] = { sh: s.guardSh + 0.25 - breathe * 0.04, ab: 0.1, el: s.guardEl + 0.1, wr: -0.1, ext: 1 };
    if (s.id === "volt") {
      // Toe-bounce: weight rocks front to back, fists flick.
      const bounce = Math.sin(t * 2);
      p.leg[0].hip = s.idleStance + bounce * 0.08;
      p.leg[1].hip = -s.idleStance * 0.6 - bounce * 0.08;
      p.arm[0].wr = Math.sin(t * 3) * 0.25;
      p.leg[0].ankle = Math.max(0, bounce) * 0.5;
      p.leg[1].ankle = Math.max(0, -bounce) * 0.5;
    } else if (s.id === "bulwark") {
      // Heavy shoulder roll and slow knuckle crack.
      p.arm[0].sh += Math.sin(t * 0.7) * 0.12;
      p.chestRoll = Math.sin(t * 0.5) * 0.05;
      p.spine = 0.1 + breathe * 0.04;
    } else if (s.id === "wisp") {
      p.arm[0] = { sh: 0.5 + Math.sin(t) * 0.35, ab: 0.45, el: 0.6 + Math.sin(t + 1) * 0.2, wr: Math.sin(t * 1.5) * 0.4, ext: 1 };
      p.arm[1] = { sh: 0.7 + Math.sin(t + 2) * 0.35, ab: 0.45, el: 0.7 + Math.sin(t + 3) * 0.2, wr: Math.sin(t * 1.3) * 0.4, ext: 1 };
      p.roll = 0;
      p.headRoll = Math.sin(t * 0.7) * 0.08;
    } else if (s.id === "nova") {
      p.arm[0].wr = Math.sin(t * 2) * 0.08;
      p.arm[1].sh += Math.max(0, Math.sin(t * 0.35)) * 0.1;
    }
  }

  private victory(f: Fighter, p: Pose, time: number): void {
    const s = this.style;
    const t = time * 0.16;
    p.hipY = Math.abs(Math.sin(t)) * 8;
    p.squashY = 1 + Math.sin(t * 2) * 0.03;
    p.headPitch = -0.2;
    p.expr.open = 0.8;
    switch (s.id) {
      case "nova":
        // Crisp salute then fists raised.
        p.arm[0] = { sh: -2.3 + Math.sin(t * 2) * 0.1, ab: 0.4, el: 0.4, wr: 0, ext: 1 };
        p.arm[1] = { sh: -2.1 - Math.sin(t * 2) * 0.1, ab: 0.4, el: 0.5, wr: 0, ext: 1 };
        break;
      case "volt":
        p.roll = Math.sin(t) > 0.95 ? Math.PI * 2 * ease((Math.sin(t) - 0.95) / 0.05) : 0;
        p.arm[0] = { sh: -2.6, ab: 0.6, el: 0.2, wr: Math.sin(t * 6) * 0.4, ext: 1 };
        p.arm[1] = { sh: 0.4, ab: 0.2, el: 1.4, wr: 0, ext: 1 };
        p.chestYaw = Math.sin(t * 2) * 0.4;
        break;
      case "bulwark": {
        // Chest pound.
        const pound = Math.max(0, Math.sin(t * 3));
        p.arm[0] = { sh: 0.9 - pound * 0.3, ab: 0.0, el: 2.0, wr: 0, ext: 1 };
        p.arm[1] = { sh: 0.9 - (1 - pound) * 0.3, ab: 0.0, el: 2.0, wr: 0, ext: 1 };
        p.spine = -0.15;
        p.hipY = Math.abs(Math.sin(t * 1.5)) * 4;
        break;
      }
      default:
        p.arm[0] = { sh: -2.4 + Math.sin(t * 2) * 0.4, ab: 0.7, el: 0.3, wr: 0.4, ext: 1 };
        p.arm[1] = { sh: -2.0 - Math.sin(t * 2) * 0.4, ab: 0.7, el: 0.3, wr: -0.4, ext: 1 };
        p.hipY += 10;
        p.roll = Math.sin(t) * 0.2;
        break;
    }
    void f;
  }

  /* ---------------------------------------------------------- locomotion */

  private locomotion(f: Fighter, p: Pose, dt: number): void {
    const s = this.style;
    const speed = Math.abs(f.vx);
    const run = f.state === "run";
    this.stride += speed * (run ? s.runRate : s.walkRate) * dt;
    const ph = this.stride;
    const sw = Math.sin(ph);
    const c2 = Math.cos(ph * 2);
    const lift = (x: number): number => Math.max(0, x);
    const amp = run ? 0.95 : 0.5;
    // Legs: thighs scissor, knee folds on the recovery swing, foot rolls heel-to-toe.
    p.leg[0].hip = sw * amp + (run ? 0.1 : 0);
    p.leg[1].hip = -sw * amp + (run ? 0.1 : 0);
    p.leg[0].knee = 0.25 + lift(Math.cos(ph)) * (run ? s.runKnee : 0.7);
    p.leg[1].knee = 0.25 + lift(-Math.cos(ph)) * (run ? s.runKnee : 0.7);
    p.leg[0].ankle = -Math.cos(ph) * 0.3;
    p.leg[1].ankle = Math.cos(ph) * 0.3;
    // Arms counter-swing with bent elbows; bulky fighters swing less, speedy ones whip.
    const swing = run ? s.runSwing : s.runSwing * 0.55;
    p.arm[0] = { sh: 0.75 + sw * swing, ab: 0.14, el: run ? 1.5 - sw * 0.3 : 0.9, wr: 0, ext: 1 };
    p.arm[1] = { sh: 0.75 - sw * swing, ab: 0.14, el: run ? 1.5 + sw * 0.3 : 0.9, wr: 0, ext: 1 };
    // Torso counter-rotates against the pelvis, bobs twice per stride, leans into the run.
    p.pelvisYaw = sw * (run ? 0.28 : 0.14);
    p.chestYaw = -sw * (run ? 0.4 : 0.2);
    p.chestRoll = sw * 0.05;
    p.pitch = run ? s.runLean : s.runLean * 0.25;
    p.spine = run ? 0.1 : 0.02;
    p.hipY = -Math.abs(Math.cos(ph)) * (run ? s.runBounce : s.runBounce * 0.45) + (run ? 1.5 : 0.5);
    p.headPitch = -p.pitch * 0.7;
    p.headYaw = sw * 0.08;
    if (s.id === "bulwark") {
      // Stomp: each footfall slams the body down; the shoulders heave.
      p.hipY = -Math.pow(Math.abs(Math.cos(ph)), 0.6) * s.runBounce;
      p.squashY = 1 - Math.pow(Math.max(0, -c2), 2) * 0.05;
      p.pelvisRoll = sw * 0.08;
    } else if (s.id === "volt") {
      p.arm[0].sh = 0.5 + sw * swing * 1.2;
      p.arm[1].sh = 0.5 - sw * swing * 1.2;
      p.roll = 0;
    } else if (s.id === "wisp") {
      p.arm[0].sh = 0.9 + Math.sin(ph * 0.7) * 0.4;
      p.arm[1].sh = 1.1 - Math.sin(ph * 0.7) * 0.4;
      p.hipY = Math.sin(ph) * s.runBounce;
    }
    if (run && f.sf < 6) {
      // Dash start: explosive lean.
      p.pitch += (1 - f.sf / 6) * 0.25;
    }
  }

  private turn(f: Fighter, p: Pose): void {
    const t = clamp01(this.stateT / 8);
    p.pitch = -0.32 * (1 - t) - 0.05;
    p.chestYaw = lerp(-0.5, 0.2, easeInOut(t));
    p.pelvisYaw = lerp(0.4, 0, t);
    p.leg[0].hip = lerp(0.7, 0.2, t);
    p.leg[1].hip = lerp(-0.5, -0.1, t);
    p.leg[0].knee = 0.5;
    p.leg[0].ankle = 0.4;
    p.arm[0] = { sh: lerp(-0.2, 0.7, t), ab: 0.4, el: 0.9, wr: 0, ext: 1 };
    p.arm[1] = { sh: lerp(0.3, 0.9, t), ab: 0.3, el: 1.0, wr: 0, ext: 1 };
    p.hipY = -3 * (1 - t);
    void f;
  }

  /* ------------------------------------------------------------- jumping */

  private jumpsquat(f: Fighter, p: Pose): void {
    const s = this.style;
    const t = clamp01(f.sf / Math.max(2, 4));
    const d = easeInOut(t) * s.jumpDip;
    p.hipY = -9 * d;
    p.squashY = 1 - 0.1 * d;
    p.squashX = 1 + 0.05 * d;
    p.pitch = 0.18 * d;
    p.spine = 0.2 * d;
    p.leg[0] = { hip: 0.75 * d, ab: 0.1, knee: 1.5 * d, ankle: 0.2 };
    p.leg[1] = { hip: 0.55 * d, ab: 0.1, knee: 1.3 * d, ankle: 0.2 };
    p.arm[0] = { sh: 1.5 + 0.5 * d, ab: 0.25, el: 0.5, wr: 0, ext: 1 };
    p.arm[1] = { sh: 1.6 + 0.5 * d, ab: 0.25, el: 0.5, wr: 0, ext: 1 };
    p.headPitch = -0.1 * d;
    p.expr.anger = 0.3;
  }

  private land(f: Fighter, p: Pose): void {
    const s = this.style;
    const t = clamp01(f.sf / Math.max(2, f.landLock));
    const d = (1 - easeOutBack(t) * 0.9) * s.landDip;
    const dd = Math.max(0, d);
    p.hipY = -11 * dd;
    p.squashY = 1 - 0.12 * dd;
    p.squashX = 1 + 0.07 * dd;
    p.pitch = 0.16 * dd;
    p.spine = 0.25 * dd;
    p.leg[0] = { hip: 0.7 * dd, ab: 0.14, knee: 1.5 * dd, ankle: 0.2 };
    p.leg[1] = { hip: 0.35 * dd, ab: 0.14, knee: 1.3 * dd, ankle: 0.2 };
    p.arm[0] = { sh: 0.85 + 0.5 * dd, ab: 0.45, el: 0.7, wr: 0, ext: 1 };
    p.arm[1] = { sh: 0.95 + 0.5 * dd, ab: 0.45, el: 0.7, wr: 0, ext: 1 };
    p.headPitch = -0.15 * dd;
  }

  private airborne(f: Fighter, p: Pose, time: number): void {
    const s = this.style;
    const rising = f.vy < -1.5;
    const apex = Math.abs(f.vy) < 4;
    const falling = f.vy > 1.5;
    const fast = f.fastFall;
    if (rising) {
      // Launch: trailing legs, one knee driving, arms swept high.
      p.leg[0] = { hip: 0.9, ab: 0.1, knee: 1.5, ankle: -0.2 };
      p.leg[1] = { hip: -0.45, ab: 0.1, knee: 0.3, ankle: 0.7 };
      p.arm[0] = { sh: -1.1, ab: 0.5, el: 0.5, wr: 0, ext: 1 };
      p.arm[1] = { sh: -0.6, ab: 0.45, el: 0.6, wr: 0, ext: 1 };
      p.squashY = 1.05;
      p.squashX = 0.97;
      p.pitch = 0.05;
      p.spine = -0.08;
    } else if (apex) {
      p.leg[0] = { hip: 0.5, ab: 0.14, knee: 0.9, ankle: 0.1 };
      p.leg[1] = { hip: 0.15, ab: 0.14, knee: 0.7, ankle: 0.2 };
      p.arm[0] = { sh: -0.2, ab: 0.65, el: 0.5, wr: 0, ext: 1 };
      p.arm[1] = { sh: 0.1, ab: 0.65, el: 0.6, wr: 0, ext: 1 };
    } else if (falling) {
      p.leg[0] = { hip: 0.25, ab: 0.1, knee: 0.3, ankle: 0.5 };
      p.leg[1] = { hip: -0.1, ab: 0.1, knee: 0.15, ankle: 0.5 };
      p.arm[0] = { sh: -0.7, ab: 0.55, el: 0.6, wr: 0.2, ext: 1 };
      p.arm[1] = { sh: -0.4, ab: 0.55, el: 0.7, wr: 0.2, ext: 1 };
      p.squashY = 1.02;
    }
    if (fast) {
      // Fast fall: dive position, legs locked straight, fists up.
      p.leg[0] = { hip: 0.06, ab: 0.05, knee: 0.04, ankle: 0.7 };
      p.leg[1] = { hip: -0.05, ab: 0.05, knee: 0.04, ankle: 0.7 };
      p.arm[0] = { sh: -1.5, ab: 0.2, el: 0.35, wr: 0, ext: 1 };
      p.arm[1] = { sh: -1.35, ab: 0.2, el: 0.4, wr: 0, ext: 1 };
      p.squashY = 1.1;
      p.squashX = 0.93;
      p.pitch = 0.1;
      p.headPitch = 0.2;
    }
    p.pitch += clamp01(Math.abs(f.vx) / 8) * 0.2 * Math.sign(f.vx * f.facing);
    if (f.helpless) {
      p.arm[0] = { sh: -2.2, ab: 0.5, el: 0.2, wr: 0, ext: 1 };
      p.arm[1] = { sh: -1.9, ab: 0.5, el: 0.2, wr: 0, ext: 1 };
      p.leg[0].hip = 0.2;
      p.leg[1].hip = -0.3;
      p.expr.wide = 0.6;
      p.expr.open = 0.5;
    }
    if (this.djT > 0) {
      const t = 1 - this.djT;
      if (s.flip) {
        // Volt: full backflip.
        p.roll = -this.djDir * ease(t) * Math.PI * 2 * f.facing * this.djDir;
        p.leg[0] = { hip: 1.4, ab: 0.1, knee: 2.0, ankle: 0 };
        p.leg[1] = { hip: 1.2, ab: 0.1, knee: 2.0, ankle: 0 };
        p.arm[0] = { sh: 1.0, ab: 0.1, el: 2.0, wr: 0, ext: 1 };
        p.arm[1] = { sh: 1.0, ab: 0.1, el: 2.0, wr: 0, ext: 1 };
        p.snap |= SNAP_ROOT;
      } else if (s.floats) {
        p.arm[0] = { sh: -1.8, ab: 0.9, el: 0.2, wr: 0.5, ext: 1 };
        p.arm[1] = { sh: -1.8, ab: 0.9, el: 0.2, wr: -0.5, ext: 1 };
        p.squashY = 1 + Math.sin(t * Math.PI) * 0.12;
        p.roll = Math.sin(t * Math.PI * 2) * 0.35;
      } else {
        // Second jump: tuck then burst open.
        const tuck = Math.sin(clamp01(t * 1.6) * Math.PI);
        p.leg[0] = { hip: lerp(0.5, 1.5, tuck), ab: 0.1, knee: lerp(0.8, 2.1, tuck), ankle: 0 };
        p.leg[1] = { hip: lerp(-0.1, 1.2, tuck), ab: 0.1, knee: lerp(0.8, 2.0, tuck), ankle: 0 };
        p.arm[0] = { sh: lerp(-1.5, 0.6, tuck), ab: 0.3, el: lerp(0.4, 1.6, tuck), wr: 0, ext: 1 };
        p.arm[1] = { sh: lerp(-1.3, 0.8, tuck), ab: 0.3, el: lerp(0.4, 1.6, tuck), wr: 0, ext: 1 };
        p.squashY = 1 - tuck * 0.1;
        p.spine = tuck * 0.3;
      }
    }
    if (f.state === "airDodge") {
      p.roll = (f.sf / 30) * Math.PI * 2 * 0.7 * f.facing;
      p.leg[0].knee = 1.5;
      p.leg[1].knee = 1.5;
      p.snap |= SNAP_ROOT;
    }
    if (s.floats) p.hipY += Math.sin(time * 0.1) * 3;
  }

  /* ----------------------------------------------------------- defensive */

  private shield(f: Fighter, p: Pose, time: number): void {
    const stun = f.state === "shieldStun";
    p.hipY = -8;
    p.pitch = stun ? -0.12 : 0.12;
    p.spine = 0.25;
    p.squashY = 0.95;
    p.leg[0] = { hip: 0.7, ab: 0.14, knee: 1.2, ankle: 0.1 };
    p.leg[1] = { hip: -0.3, ab: 0.14, knee: 0.9, ankle: 0.1 };
    p.arm[0] = { sh: 0.0, ab: -0.15, el: 1.9, wr: 0.3, ext: 1 };
    p.arm[1] = { sh: 0.15, ab: -0.15, el: 1.9, wr: 0.3, ext: 1 };
    p.chestYaw = stun ? -0.2 : 0.1;
    p.headPitch = 0.2;
    p.headYaw = Math.sin(time * 0.3) * (stun ? 0.1 : 0.02);
    if (this.style.floats) {
      p.arm[0] = { sh: -0.3, ab: 0.9, el: 0.9, wr: 0, ext: 1 };
      p.arm[1] = { sh: -0.3, ab: 0.9, el: 0.9, wr: 0, ext: 1 };
    }
  }

  private shieldBreak(f: Fighter, p: Pose, time: number): void {
    p.roll = Math.sin(time * 0.4) * 0.28;
    p.arm[0] = { sh: -1.9, ab: 0.7, el: 0.2, wr: 0.4, ext: 1 };
    p.arm[1] = { sh: -1.7, ab: 0.7, el: 0.2, wr: -0.4, ext: 1 };
    p.hipY = -4 + Math.sin(time * 0.6) * 3;
    p.headRoll = Math.sin(time * 0.5) * 0.3;
    p.leg[0].knee = 0.9;
    p.leg[1].knee = 0.9;
    void f;
  }

  private dodge(f: Fighter, p: Pose): void {
    if (f.state === "spotDodge") {
      const t = clamp01(f.sf / 20);
      p.squashX = 0.78 + Math.abs(Math.sin(f.sf * 0.3)) * 0.08;
      p.hipY = -10;
      p.spine = 0.4;
      p.chestYaw = Math.sin(t * Math.PI) * -0.6;
      p.arm[0] = { sh: 0.2, ab: -0.1, el: 1.9, wr: 0, ext: 1 };
      p.arm[1] = { sh: 0.3, ab: -0.1, el: 1.9, wr: 0, ext: 1 };
      p.leg[0] = { hip: 0.9, ab: 0.2, knee: 1.8, ankle: 0 };
      p.leg[1] = { hip: 0.6, ab: 0.2, knee: 1.7, ankle: 0 };
      return;
    }
    const dir = f.roll || 1;
    const dur = f.state === "roll" ? 30 : 34;
    p.roll = (f.sf / dur) * Math.PI * 2 * dir * f.facing;
    p.snap |= SNAP_ROOT;
    p.hipY = -14;
    p.leg[0] = { hip: 1.5, ab: 0.1, knee: 2.2, ankle: 0 };
    p.leg[1] = { hip: 1.4, ab: 0.1, knee: 2.2, ankle: 0 };
    p.arm[0] = { sh: 1.1, ab: 0.1, el: 2.1, wr: 0, ext: 1 };
    p.arm[1] = { sh: 1.1, ab: 0.1, el: 2.1, wr: 0, ext: 1 };
    p.spine = 0.5;
  }

  /* ------------------------------------------------------------ reactions */

  private hitstun(f: Fighter, p: Pose, time: number, dt: number): void {
    const s = this.style;
    const mag = clamp01((f.hitstun + f.sf) / 60);
    if (f.tumble) {
      this.spin = (this.spin + (0.38 + mag * 0.25) * Math.sign(f.vx || 1) * (f.hitlag > 0 ? 0 : 1) * dt) % (Math.PI * 2);
      p.roll = this.spin * -f.facing;
      p.snap |= SNAP_ROOT;
      this.hurtPhase = 0;
    } else {
      this.spin = 0;
      this.hurtPhase += dt;
      // Flinch: torso snaps back from the hit, then wobbles.
      const k = Math.exp(-this.hurtPhase * 0.12);
      p.pitch = -0.45 * s.hurt * (0.4 + 0.6 * k);
      p.spine = -0.25 * s.hurt * k;
    }
    const flail = Math.sin(time * 0.5);
    p.arm[0] = { sh: -1.7 + flail * 0.4 * s.hurt, ab: 0.7, el: 0.5, wr: flail * 0.5, ext: 1 };
    p.arm[1] = { sh: -1.3 - flail * 0.4 * s.hurt, ab: 0.7, el: 0.6, wr: -flail * 0.5, ext: 1 };
    p.leg[0] = { hip: Math.sin(time * 0.4) * 0.6, ab: 0.2, knee: 0.5, ankle: 0.3 };
    p.leg[1] = { hip: -Math.sin(time * 0.4) * 0.6, ab: 0.2, knee: 0.7, ankle: 0.3 };
    p.headPitch = -0.35;
    p.headRoll = flail * 0.12;
    const speed = Math.hypot(f.vx, f.vy);
    p.stretch = f.hitlag === 0 ? clamp01((speed - 9) / 20) : 0;
    p.squashY = f.hitlag > 0 ? 0.9 : 1;
    p.squashX = f.hitlag > 0 ? 1.1 : 1;
    p.hipY = f.hitlag > 0 ? -3 : 0;
  }

  private grabPose(f: Fighter, p: Pose): void {
    const reaching = f.state === "grab";
    p.pitch = 0.18;
    p.hipY = -5;
    p.leg[0] = { hip: 0.7, ab: 0.14, knee: 0.7, ankle: 0.1 };
    p.leg[1] = { hip: -0.45, ab: 0.14, knee: 0.4, ankle: 0.5 };
    p.arm[0] = { sh: reaching ? 0.0 : 0.1, ab: 0.15, el: reaching ? 0.15 : 0.7, wr: 0, ext: reaching ? 1.12 : 1 };
    p.arm[1] = { sh: reaching ? 0.1 : 0.2, ab: 0.15, el: reaching ? 0.3 : 0.8, wr: 0, ext: 1 };
    p.chestYaw = -0.3;
    p.strike = reaching ? 0.6 : 0;
  }

  private grabbed(f: Fighter, p: Pose, time: number): void {
    p.pitch = -0.35;
    p.arm[0] = { sh: 1.6, ab: 0.5, el: 0.5, wr: 0, ext: 1 };
    p.arm[1] = { sh: 1.5, ab: 0.5, el: 0.5, wr: 0, ext: 1 };
    p.hipY = Math.sin(time * 0.7) * 2 - 6;
    p.leg[0].knee = 1.0;
    p.leg[1].knee = 0.9;
    p.headRoll = Math.sin(time * 0.7) * 0.2;
    void f;
  }

  private ledge(f: Fighter, p: Pose, time: number): void {
    if (f.state === "ledgeHang") {
      p.arm[0] = { sh: -1.65, ab: 0.15, el: 0.2, wr: 0, ext: 1 };
      p.arm[1] = { sh: -1.5, ab: 0.15, el: 0.25, wr: 0, ext: 1 };
      p.leg[0] = { hip: 0.12 + Math.sin(time * 0.1) * 0.08, ab: 0.1, knee: 0.3, ankle: 0.3 };
      p.leg[1] = { hip: 0.22 + Math.sin(time * 0.1 + 1) * 0.08, ab: 0.1, knee: 0.5, ankle: 0.3 };
      p.expr.wide = 0.3;
      p.headPitch = -0.1;
      return;
    }
    // Climb: pull up, swing a knee over, stand.
    const t = clamp01(f.sf / 24);
    p.arm[0] = { sh: lerp(-1.65, 0.7, easeInOut(t)), ab: 0.2, el: lerp(0.2, 1.4, t), wr: 0, ext: 1 };
    p.arm[1] = { sh: lerp(-1.5, 0.8, easeInOut(t)), ab: 0.2, el: lerp(0.25, 1.4, t), wr: 0, ext: 1 };
    p.leg[0] = { hip: lerp(0.15, 0.9, Math.sin(t * Math.PI)), ab: 0.1, knee: lerp(0.3, 1.9, Math.sin(t * Math.PI)), ankle: 0.2 };
    p.leg[1] = { hip: 0.2, ab: 0.1, knee: 0.5, ankle: 0.3 };
    p.pitch = 0.3 * Math.sin(t * Math.PI);
    p.hipY = -8 * (1 - t);
  }

  private respawn(f: Fighter, p: Pose, time: number): void {
    // Kneeling in the light, arms out, rising as the halo fades.
    const t = clamp01((f.sf - 70) / 50);
    p.arm[0] = { sh: lerp(-2.0, 0.7, t), ab: 0.7, el: lerp(0.2, 1.3, t), wr: 0, ext: 1 };
    p.arm[1] = { sh: lerp(-1.8, 0.9, t), ab: 0.7, el: lerp(0.2, 1.3, t), wr: 0, ext: 1 };
    p.hipY = Math.sin(time * 0.12) * 4;
    p.leg[0].knee = 0.5;
    p.leg[1].knee = 0.5;
    p.headPitch = lerp(-0.3, 0, t);
  }

  /* --------------------------------------------------------------- moves */

  private poseMove(f: Fighter, p: Pose, time: number): void {
    const move = currentMove(f);
    const s = this.style;
    if (!move) {
      this.idle(f, p, time);
      return;
    }
    if (move.id !== this.lastAnimMove) this.lastAnimMove = move.id;
    const anim = move.anim;
    const air = !f.grounded;
    const heavy = HEAVY_ANIMS.has(anim);
    // Default combat stance under every attack.
    p.leg[0] = { hip: air ? 0.5 : 0.62, ab: 0.14, knee: air ? 0.9 : 0.7, ankle: 0.1 };
    p.leg[1] = { hip: air ? -0.1 : -0.5, ab: 0.14, knee: air ? 0.6 : 0.45, ankle: 0.3 };
    p.hipY = air ? 0 : -5;
    p.arm[1] = { sh: 0.9, ab: 0.25, el: 1.5, wr: 0, ext: 1 };

    let box: HitboxDef | undefined;
    for (const b of move.hitboxes) {
      if (f.sf <= b.to) {
        box = b;
        break;
      }
    }
    if (!box) box = move.hitboxes[move.hitboxes.length - 1];
    if (!box) {
      this.utility(f, move, p);
      return;
    }
    const spec = this.spec;
    const cx = box.x2 !== undefined ? (box.x + box.x2) / 2 : box.x;
    const cy = box.y2 !== undefined ? (box.y + box.y2) / 2 : box.y;
    const aim = Math.atan2(cy - spec.shoulderY, cx - spec.shoulderX);
    const dist = Math.hypot(cx - spec.shoulderX, cy - spec.shoulderY);
    const windup = Math.max(1, box.from);
    let phase = 0;
    let t = 0;
    if (f.sf < box.from) {
      phase = 0;
      t = clamp01(f.sf / windup);
    } else if (f.sf <= box.to) {
      phase = 1;
      t = clamp01((f.sf - box.from) / Math.max(1, box.to - box.from + 1));
    } else {
      phase = 2;
      t = clamp01((f.sf - box.to) / Math.max(1, move.total - box.to));
    }
    // Anticipation: ease-in so the coil reads, then the strike snaps.
    const coil = phase === 0 ? easeIn(t) : phase === 1 ? 1 : 1 - ease(t);
    p.strike = phase === 0 ? -0.55 * coil * s.windup : phase === 1 ? 1 * s.lunge : 0.55 * s.lunge * (1 - ease(t));
    p.swing = phase === 1 ? 1 : phase === 2 ? 0.5 * (1 - t) : 0;
    const arm = anim === "jab2" ? 1 : 0;
    p.strikeArm = arm;
    const other = 1 - arm;

    if (ARM_ANIMS.has(anim)) {
      const wind = (heavy ? 1.9 : 1.45) * s.windup;
      const back = aim - wind;
      const reach = Math.max(1, dist / spec.armLen);
      const a = p.arm[arm];
      if (phase === 0) {
        a.sh = lerp(0.8, back, easeIn(t));
        a.el = lerp(1.4, 1.9, t);
        a.ext = 0.9;
      } else if (phase === 1) {
        a.sh = aim;
        a.el = 0.08;
        a.ext = Math.min(1.45, reach);
        p.snap |= arm === 0 ? SNAP_ARM0 : SNAP_ARM1;
      } else {
        const over = Math.sin(t * Math.PI) * 0.35 * s.recoil;
        a.sh = lerp(aim + over, 0.8, ease(t));
        a.el = lerp(0.2, 1.5, ease(t));
        a.ext = lerp(1.2, 1, t);
      }
      a.ab = 0.05;
      a.wr = phase === 1 ? 0 : -0.3;
      // Off-hand guards or counter-balances; torso twist drives the punch.
      const o = p.arm[other];
      o.sh = phase === 1 ? aim + 1.7 : 0.9 - 0.4 * coil;
      o.el = 1.6;
      const twist = (phase === 0 ? 1 : phase === 1 ? -1 : -0.3 * (1 - t)) * s.twist;
      p.chestYaw = twist;
      p.pelvisYaw = -twist * 0.55;
      p.pitch = phase === 1 ? 0.22 * s.lunge : phase === 0 ? -0.16 * coil : 0.05;
      p.spine = phase === 1 ? 0.18 : phase === 0 ? -0.18 * coil : 0;
      if (anim === "uptilt" || anim === "upsmash" || anim === "uair") {
        p.pitch = phase === 1 ? -0.14 : -0.04;
        p.spine = phase === 1 ? -0.3 : 0;
        p.leg[0].knee = 1.2;
        if (phase === 1) p.hipY += 3;
      }
      if (anim === "dash" || anim === "lunge") {
        p.pitch = 0.45 * s.lunge;
        p.leg[0] = { hip: 1.0, ab: 0.1, knee: 0.3, ankle: 0.3 };
        p.leg[1] = { hip: -0.9, ab: 0.1, knee: 0.8, ankle: 0.8 };
      }
      if (anim === "smash" || anim === "upsmash") {
        p.hipY += phase === 0 ? -5 * coil : 2;
        p.leg[0].hip = phase === 0 ? 0.9 : 0.8;
        p.leg[1].hip = phase === 0 ? -0.7 : -0.7;
        p.leg[0].knee = phase === 0 ? 1.2 : 0.6;
      }
    } else if (LEG_ANIMS.has(anim)) {
      const hipY = this.spec.hipHeight;
      const legAim = Math.atan2(cx, Math.max(2, cy + hipY));
      const lg = p.leg[0];
      const rest = 0.3;
      const backRot = legAim - 1.0 * s.windup;
      if (phase === 0) {
        lg.hip = lerp(rest, backRot, easeIn(t));
        lg.knee = lerp(0.4, 1.9, t);
      } else if (phase === 1) {
        lg.hip = legAim;
        lg.knee = 0.1;
        lg.ankle = 0.4;
        p.snap |= SNAP_LEG0;
      } else {
        lg.hip = lerp(legAim + Math.sin(t * Math.PI) * 0.3, 0.2, ease(t));
        lg.knee = lerp(0.3, 0.5, t);
      }
      p.leg[1] = { hip: -0.35, ab: 0.14, knee: air ? 0.8 : 0.4, ankle: 0.2 };
      p.arm[0] = { sh: -0.9 - 0.2 * coil, ab: 0.6, el: 0.7, wr: 0, ext: 1 };
      p.arm[1] = { sh: -0.5, ab: 0.6, el: 0.8, wr: 0, ext: 1 };
      p.pitch = anim === "dair" ? 0 : phase === 1 ? -0.25 : 0.05;
      p.spine = phase === 1 ? -0.2 : 0.1;
      if (anim === "dair") {
        p.leg[1] = { hip: 0.0, ab: 0.1, knee: 0.1, ankle: 0.5 };
        p.arm[0] = { sh: -1.7, ab: 0.4, el: 0.4, wr: 0, ext: 1 };
        p.arm[1] = { sh: -1.6, ab: 0.4, el: 0.4, wr: 0, ext: 1 };
      }
      if (anim === "downsmash") {
        p.hipY += phase === 0 ? -7 * coil : -3;
        p.leg[1] = { hip: -0.5, ab: 0.2, knee: 1.1, ankle: 0.2 };
      }
    } else if (anim === "nair" || anim === "spin") {
      const turns = ease(clamp01(f.sf / Math.max(2, move.total * 0.85)));
      p.roll = turns * Math.PI * 2 * f.facing * (s.id === "volt" ? 1.5 : 1);
      p.snap |= SNAP_ROOT;
      p.leg[0] = { hip: 1.0, ab: 0.4, knee: 0.5, ankle: 0.3 };
      p.leg[1] = { hip: -1.0, ab: 0.4, knee: 0.5, ankle: 0.3 };
      p.arm[0] = { sh: -0.1, ab: 0.9, el: 0.2, wr: 0, ext: 1.1 };
      p.arm[1] = { sh: 0.1, ab: 0.9, el: 0.2, wr: 0, ext: 1.1 };
      p.swing = 0.8;
    } else if (anim === "slam") {
      const down = phase === 1 || phase === 2;
      p.arm[0] = { sh: down ? lerp(-2.4, 1.3, easeIn(clamp01(t * 3))) : lerp(0.5, -2.5, easeIn(t)), ab: 0.2, el: down ? 0.3 : 0.5, wr: 0, ext: 1.1 };
      p.arm[1] = { sh: p.arm[0].sh - 0.2, ab: 0.2, el: 0.4, wr: 0, ext: 1.1 };
      p.hipY = phase === 0 ? 6 * coil : -12;
      p.spine = phase === 0 ? -0.35 * coil : 0.45;
      p.pitch = phase === 0 ? -0.2 * coil : 0.4;
      p.leg[0].knee = down ? 1.6 : 0.5;
      p.leg[1].knee = down ? 1.5 : 0.5;
      p.snap |= phase === 1 ? SNAP_ARM0 | SNAP_ARM1 : 0;
    } else if (anim === "teleport") {
      p.squashX = f.vanished ? 0.01 : 1;
      p.arm[0] = { sh: -2.2, ab: 0.6, el: 0.2, wr: 0, ext: 1 };
      p.arm[1] = { sh: -2.0, ab: 0.6, el: 0.2, wr: 0, ext: 1 };
    } else {
      const a = p.arm[0];
      a.sh = phase === 0 ? lerp(0.8, aim - 1.4, easeIn(t)) : phase === 1 ? aim : lerp(aim, 0.8, ease(t));
      a.el = phase === 1 ? 0.1 : 1.2;
      a.ext = phase === 1 ? Math.min(1.4, Math.max(1, dist / spec.armLen)) : 1;
      p.chestYaw = (phase === 0 ? 0.5 : -0.5) * s.twist;
      p.snap |= phase === 1 ? SNAP_ARM0 : 0;
    }
  }

  private utility(f: Fighter, move: MoveDef, p: Pose): void {
    const s = this.style;
    const spawnAt = move.spawns?.[0]?.at ?? Math.floor(move.total * 0.4);
    const t = clamp01(f.sf / Math.max(1, spawnAt));
    const after = clamp01((f.sf - spawnAt) / Math.max(1, move.total - spawnAt));
    const launched = f.sf >= spawnAt;
    p.strike = !launched ? -0.45 * t * s.windup : f.sf - spawnAt < 4 ? 1 : 0.4 * (1 - after);
    p.swing = launched && f.sf - spawnAt < 6 ? 1 : 0;
    if (move.anim === "toss") {
      // Overhead heave: both hands up and back, then a full-body throw.
      p.arm[0] = { sh: !launched ? lerp(0.5, -2.8, easeIn(t)) : lerp(-0.2, 0.7, ease(after)), ab: 0.2, el: !launched ? 0.6 : 0.15, wr: 0, ext: launched ? 1.15 : 1 };
      p.arm[1] = { sh: !launched ? lerp(0.7, -2.6, easeIn(t)) : lerp(0.0, 0.9, ease(after)), ab: 0.2, el: 0.5, wr: 0, ext: 1 };
      p.pitch = !launched ? -0.3 * t : 0.35;
      p.spine = !launched ? -0.3 * t : 0.4;
      p.hipY = !launched ? 4 * t : -10;
    } else if (move.anim === "cast") {
      // Pull the energy in, then push it out with a snap of the wrist.
      p.arm[0] = { sh: !launched ? lerp(0.5, -0.5, easeIn(t)) : lerp(-0.1, 0.6, ease(after)), ab: 0.2, el: !launched ? 1.4 : 0.12, wr: !launched ? -0.5 : 0.6, ext: launched ? 1.2 - after * 0.2 : 1 };
      p.arm[1] = { sh: !launched ? lerp(0.9, -0.8, easeIn(t)) : lerp(-0.2, 0.9, ease(after)), ab: 0.3, el: !launched ? 1.6 : 0.5, wr: 0, ext: 1 };
      p.pitch = !launched ? -0.1 : 0.14 - after * 0.1;
      p.chestYaw = (!launched ? 0.4 : -0.3) * s.twist;
      p.snap |= launched && f.sf - spawnAt < 3 ? SNAP_ARM0 : 0;
    } else if (move.anim === "teleport") {
      p.squashX = f.vanished ? 0.01 : 1;
      p.arm[0] = { sh: -2.2, ab: 0.6, el: 0.2, wr: 0, ext: 1 };
      p.arm[1] = { sh: -2.0, ab: 0.6, el: 0.2, wr: 0, ext: 1 };
    } else if (move.anim === "rise") {
      p.arm[0] = { sh: -1.7, ab: 0.15, el: 0.15, wr: 0, ext: 1.1 };
      p.arm[1] = { sh: -1.6, ab: 0.15, el: 0.2, wr: 0, ext: 1.1 };
      p.leg[0] = { hip: 0.1, ab: 0.04, knee: 0.1, ankle: 0.8 };
      p.leg[1] = { hip: -0.05, ab: 0.04, knee: 0.1, ankle: 0.8 };
      p.squashY = 1.08;
      p.squashX = 0.94;
      p.snap |= SNAP_ARM0 | SNAP_ARM1;
    } else {
      p.arm[0].sh = lerp(0.6, -0.4, easeIn(t));
    }
  }
}
