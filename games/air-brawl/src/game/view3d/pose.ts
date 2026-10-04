import { currentMove } from "../sim/ops";
import type { AnimId, Fighter, HitboxDef, MoveDef } from "../sim/types";

/**
 * Sim state → body pose. Angles live in the side-view plane: +x = facing
 * direction, +y = down, positive rotation = clockwise (towards down). The 3D
 * model maps that plane onto its forward/up axes. Strikes aim the limb at the
 * live hitbox so what you see is what collides.
 */
export interface Pose {
  bob: number;
  lean: number;
  rotate: number;
  squashX: number;
  squashY: number;
  armF: number;
  armB: number;
  armFExt: number;
  armBExt: number;
  legF: number;
  legB: number;
  headTilt: number;
  alpha: number;
  /** 0..1 how hard the body is committed to a strike (drives lunge/twist). */
  strike: number;
  /** Torso twist (radians) for punches/swings. */
  twist: number;
  crouch: number;
  /** 0..1 boxer's-guard bend of the elbows (idle/run/shield). */
  guard: number;
}

export const newPose = (): Pose => ({
  bob: 0,
  lean: 0,
  rotate: 0,
  squashX: 1,
  squashY: 1,
  armF: 0.6,
  armB: 1.1,
  armFExt: 1,
  armBExt: 1,
  legF: 0,
  legB: 0,
  headTilt: 0,
  alpha: 1,
  strike: 0,
  twist: 0,
  crouch: 0,
  guard: 0,
});

export interface PoseSpec {
  shoulderX: number;
  /** Negative = above the feet (2D convention). */
  shoulderY: number;
  armLen: number;
  floats: boolean;
}

const ARM_ANIMS = new Set<AnimId>(["jab", "jab2", "jab3", "tilt", "uptilt", "smash", "upsmash", "dash", "fair", "uair", "lunge", "rise", "toss", "pummel", "throw", "grab", "ledge"]);
const LEG_ANIMS = new Set<AnimId>(["downtilt", "downsmash", "bair", "dair"]);

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class PoseDriver {
  private strideT = 0;
  private spin = 0;
  constructor(private readonly spec: PoseSpec) {}

  compute(f: Fighter, time: number): Pose {
    const pose = newPose();
    pose.bob = this.spec.floats ? Math.sin(time * 0.1) * 5 - 4 : 0;

    if (f.invuln > 0 && f.state !== "respawn") pose.alpha = 0.6 + 0.4 * Math.abs(Math.sin(time * 0.55));
    if (f.state === "roll" || f.state === "spotDodge" || f.state === "airDodge") pose.alpha = 0.4;

    switch (f.state) {
      case "idle":
      case "victory": {
        const breathe = Math.sin(time * 0.08 + f.slot);
        pose.bob += breathe * 0.8;
        pose.squashY = 1 + breathe * 0.008;
        pose.armF = 0.55 + breathe * 0.05;
        pose.armB = 0.75 - breathe * 0.05;
        pose.legF = 0.14;
        pose.legB = -0.12;
        pose.crouch = 0.12 + breathe * 0.02;
        pose.twist = 0.12;
        pose.guard = 0.9;
        if (f.state === "victory") {
          const t = time * 0.3;
          pose.armF = -2.4 + Math.sin(t) * 0.25;
          pose.armB = -2.1 - Math.sin(t) * 0.25;
          pose.bob += -Math.abs(Math.sin(time * 0.16)) * 10;
          pose.crouch = 0;
        }
        break;
      }
      case "walk":
      case "run": {
        const speed = Math.abs(f.vx);
        this.strideT += speed * 0.052;
        const sw = Math.sin(this.strideT);
        const run = f.state === "run";
        const amp = run ? 0.95 : 0.55;
        pose.legF = sw * amp;
        pose.legB = -sw * amp;
        pose.armF = run ? 0.25 - sw * 0.95 : 0.55 - sw * 0.5;
        pose.armB = run ? 0.3 + sw * 0.95 : 0.7 + sw * 0.5;
        pose.lean = run ? 0.22 : 0.07;
        pose.bob += -Math.abs(Math.cos(this.strideT)) * (run ? 4 : 2);
        pose.twist = -sw * (run ? 0.3 : 0.15);
        pose.crouch = run ? 0.2 : 0.1;
        pose.guard = run ? 0.9 : 0.6;
        break;
      }
      case "turn":
        pose.lean = -0.28;
        pose.legF = 0.55;
        pose.legB = -0.4;
        pose.armF = -0.4;
        pose.armB = 0.2;
        pose.crouch = 0.2;
        break;
      case "jumpsquat":
        pose.squashY = 0.9;
        pose.crouch = 0.75;
        pose.guard = 0.6;
        pose.legF = 0.45;
        pose.legB = 0.3;
        pose.armF = 1.0;
        pose.armB = 1.2;
        pose.lean = 0.12;
        break;
      case "land": {
        const t = clamp01(f.sf / Math.max(2, f.landLock));
        pose.crouch = 0.8 * (1 - ease(t));
        pose.squashY = 0.92 + 0.08 * ease(t);
        pose.legF = 0.4 * (1 - t);
        pose.legB = 0.3 * (1 - t);
        pose.armF = 0.9 - 0.4 * t;
        pose.armB = 1.1 - 0.4 * t;
        break;
      }
      case "airborne":
      case "airDodge": {
        const rising = f.vy < -1;
        pose.legF = rising ? -0.45 : 0.4;
        pose.legB = rising ? 0.4 : -0.15;
        pose.armF = rising ? -1.0 : -0.35;
        pose.armB = rising ? -0.5 : 0.3;
        pose.squashY = rising ? 1.04 : 0.99;
        pose.crouch = rising ? 0.25 : 0.4;
        pose.guard = 0.5;
        pose.lean = clamp01(Math.abs(f.vx) / 8) * 0.18 * Math.sign(f.vx * f.facing);
        if (f.helpless) {
          pose.armF = -2.0;
          pose.armB = -1.6;
          pose.legF = 0.2;
          pose.legB = -0.3;
        }
        if (f.state === "airDodge") pose.rotate = (f.sf / 30) * Math.PI * 2 * 0.6;
        break;
      }
      case "shield":
        pose.crouch = 0.55;
        pose.guard = 1;
        pose.legF = 0.5;
        pose.legB = -0.3;
        pose.armF = -1.2;
        pose.armB = -0.9;
        pose.lean = 0.12;
        break;
      case "shieldStun":
        pose.crouch = 0.65;
        pose.lean = -0.1;
        pose.armF = -1.1;
        pose.armB = -1.0;
        break;
      case "shieldBreak":
        pose.rotate = Math.sin(time * 0.4) * 0.25;
        pose.armF = -1.9;
        pose.armB = -1.7;
        pose.crouch = 0.4;
        pose.bob += Math.sin(time * 0.6) * 2;
        break;
      case "roll":
        pose.rotate = (f.sf / 30) * Math.PI * 2 * (f.roll > 0 ? 1 : -1) * f.facing;
        pose.crouch = 1;
        pose.legF = 0.9;
        pose.legB = 0.9;
        break;
      case "spotDodge":
        pose.squashX = 0.8 + Math.abs(Math.sin(f.sf * 0.3)) * 0.1;
        pose.crouch = 0.6;
        break;
      case "hitstun": {
        if (f.tumble) {
          this.spin += 0.5 * Math.sign(f.vx || 1) * (f.hitlag > 0 ? 0 : 1);
          pose.rotate = this.spin * -f.facing;
        } else {
          this.spin = 0;
          pose.lean = -0.4;
        }
        pose.armF = -1.7 + Math.sin(time * 0.5) * 0.4;
        pose.armB = -1.3 - Math.sin(time * 0.5) * 0.4;
        pose.legF = Math.sin(time * 0.4) * 0.6;
        pose.legB = -Math.sin(time * 0.4) * 0.6;
        pose.crouch = 0.3;
        break;
      }
      case "grabbing":
      case "grab":
        pose.armF = -0.1;
        pose.armB = 0.05;
        pose.lean = 0.12;
        pose.legF = 0.35;
        pose.legB = -0.25;
        pose.crouch = 0.3;
        break;
      case "grabbed":
        pose.lean = -0.35;
        pose.armF = 1.6;
        pose.armB = 1.5;
        pose.bob += Math.sin(time * 0.7) * 2;
        pose.crouch = 0.3;
        break;
      case "ledgeHang":
        pose.armF = -1.65;
        pose.armB = -1.5;
        pose.legF = 0.1;
        pose.legB = 0.2;
        break;
      case "ledgeClimb":
        pose.armF = -1.2;
        pose.legF = 0.6;
        pose.legB = -0.2;
        pose.lean = 0.2;
        break;
      case "ledgeRoll":
        pose.rotate = (f.sf / 34) * Math.PI * 2 * f.roll * f.facing;
        pose.crouch = 0.9;
        break;
      case "respawn":
        pose.armF = -2.3;
        pose.armB = -2.0;
        pose.bob += Math.sin(time * 0.12) * 4;
        break;
      case "attack":
      case "airAttack":
      case "special":
      case "airSpecial":
      case "ledgeAttack":
      case "throw":
        this.poseMove(f, pose);
        break;
      default:
        break;
    }
    return pose;
  }

  private poseMove(f: Fighter, pose: Pose): void {
    const move = currentMove(f);
    const spec = this.spec;
    if (!move) return;
    const anim = move.anim;
    const airborne = !f.grounded;
    pose.legF = airborne ? 0.4 : 0.55;
    pose.legB = airborne ? -0.2 : -0.45;
    pose.crouch = airborne ? 0.3 : 0.35;

    let box: HitboxDef | undefined;
    for (const b of move.hitboxes) {
      if (f.sf <= b.to) {
        box = b;
        break;
      }
    }
    if (!box) box = move.hitboxes[move.hitboxes.length - 1];
    if (!box) {
      this.poseUtility(f, move, pose);
      return;
    }
    const shoulderX = spec.shoulderX;
    const shoulderY = spec.shoulderY;
    const cx = box.x2 !== undefined ? (box.x + box.x2) / 2 : box.x;
    const cy = box.y2 !== undefined ? (box.y + box.y2) / 2 : box.y;
    const aim = Math.atan2(cy - shoulderY, cx - shoulderX);
    const dist = Math.hypot(cx - shoulderX, cy - shoulderY);
    const windup = Math.max(1, box.from);
    let strike = 0;
    let t = 0;
    if (f.sf < box.from) {
      t = clamp01(f.sf / windup);
    } else if (f.sf <= box.to) {
      strike = 1;
      t = clamp01((f.sf - box.from) / Math.max(1, box.to - box.from + 1));
    } else {
      strike = 2;
      t = clamp01((f.sf - box.to) / Math.max(1, move.total - box.to));
    }
    pose.strike = strike === 1 ? 1 : strike === 0 ? -0.5 * ease(t) : 0.5 * (1 - ease(t));

    const swing = (rest: number, back: number, target: number): number => {
      if (strike === 0) return lerp(rest, back, ease(t));
      if (strike === 1) return lerp(back, target, ease(Math.min(1, t * 2.8)));
      return lerp(target, rest, ease(t));
    };

    if (ARM_ANIMS.has(anim)) {
      const back = aim - 1.5;
      pose.armF = swing(0.55, back, aim);
      // Reach beyond the arm's length is covered by a body lunge, not a stretched limb.
      const reach = Math.max(1, dist / spec.armLen);
      pose.armFExt = strike === 1 ? Math.min(1.4, reach) : strike === 0 ? 0.85 : lerp(1.2, 1, t);
      pose.armB = swing(0.75, aim + 1.1, aim + 0.5) * 0.6 + 0.4;
      pose.lean = strike === 1 ? 0.22 : strike === 0 ? -0.14 : 0.06;
      pose.twist = strike === 1 ? -0.5 : strike === 0 ? 0.5 : -0.1;
      if (anim === "uptilt" || anim === "upsmash" || anim === "uair") pose.lean = strike === 1 ? -0.1 : 0;
      if (anim === "dash" || anim === "lunge") pose.lean = 0.42;
      if (anim === "smash" || anim === "upsmash") pose.crouch = strike === 0 ? 0.6 : 0.4;
    } else if (LEG_ANIMS.has(anim)) {
      const legAim = aim - Math.PI / 2;
      const restRot = -0.35;
      const backRot = legAim - 1.3;
      const rot = strike === 0 ? lerp(restRot, backRot, ease(t)) : strike === 1 ? lerp(backRot, legAim, ease(Math.min(1, t * 2.8))) : lerp(legAim, restRot, ease(t));
      pose.legF = -rot;
      pose.armF = -1.1;
      pose.armB = -0.6;
      pose.lean = anim === "dair" ? 0 : -0.15;
      if (anim === "dair") pose.legB = -pose.legF * 0.5;
      if (anim === "downsmash") pose.crouch = 0.6;
    } else if (anim === "nair" || anim === "spin") {
      pose.rotate = ease(clamp01(f.sf / Math.max(2, move.total * 0.85))) * Math.PI * 2;
      pose.legF = 0.9;
      pose.legB = -0.9;
      pose.armF = -0.2;
      pose.armB = 0.2;
    } else if (anim === "slam") {
      pose.armF = strike === 0 ? lerp(0.5, -2.4, ease(t)) : lerp(-2.4, 1.2, ease(Math.min(1, t * 3)));
      pose.armB = pose.armF - 0.3;
      pose.crouch = strike === 1 ? 0.8 : 0.3;
    } else if (anim === "teleport") {
      pose.squashX = f.vanished ? 0.01 : 1;
      pose.armF = -2.2;
      pose.armB = -2.0;
    } else {
      pose.armF = swing(0.5, aim - 1.4, aim);
      pose.armFExt = strike === 1 ? Math.min(1.4, Math.max(1, dist / spec.armLen)) : 1;
    }
  }

  private poseUtility(f: Fighter, move: MoveDef, pose: Pose): void {
    const spawnAt = move.spawns?.[0]?.at ?? Math.floor(move.total * 0.4);
    const t = clamp01(f.sf / Math.max(1, spawnAt));
    const after = clamp01((f.sf - spawnAt) / Math.max(1, move.total - spawnAt));
    pose.strike = f.sf < spawnAt ? -0.4 * t : f.sf - spawnAt < 4 ? 1 : 0.4 * (1 - after);
    if (move.anim === "toss") {
      pose.armF = f.sf < spawnAt ? lerp(0.5, -2.7, ease(t)) : lerp(-0.2, 0.5, ease(after));
      pose.armFExt = f.sf < spawnAt ? 1 : 1.15;
      pose.armB = 0.9;
      pose.lean = f.sf < spawnAt ? -0.2 : 0.22;
    } else if (move.anim === "cast") {
      pose.armF = f.sf < spawnAt ? lerp(0.5, -0.6, ease(t)) : lerp(-0.1, 0.5, ease(after));
      pose.armB = f.sf < spawnAt ? lerp(1.0, -0.8, ease(t)) : lerp(-0.2, 1.0, ease(after));
      pose.armFExt = f.sf < spawnAt ? 1 : 1.2 - after * 0.2;
      pose.lean = f.sf < spawnAt ? -0.1 : 0.12 - after * 0.1;
    } else if (move.anim === "teleport") {
      pose.squashX = f.vanished ? 0.01 : 1;
    }
  }
}
