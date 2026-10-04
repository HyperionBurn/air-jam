import {
  LEDGE_GRAB_REACH_X,
  LEDGE_GRAB_REACH_Y,
  LEDGE_HANG_MAX,
  MAX_SUBSTEP,
} from "./constants";
import { emit } from "./ops";
import { findSupport, ledgePoint } from "./stage";
import type { Fighter, World } from "./types";

export interface MoveResult {
  landed: boolean;
  hitWall: boolean;
  bonked: boolean;
}

const result: MoveResult = { landed: false, hitWall: false, bonked: false };

/**
 * Integrate a fighter's velocity against the stage with sub-stepping, so fast
 * launches never tunnel through platforms. Handles solid walls/ceilings,
 * one-way soft platforms (with drop-through) and landing.
 */
export const moveFighter = (world: World, f: Fighter): MoveResult => {
  const hw = f.def.halfWidth;
  const h = f.def.height;
  result.landed = false;
  result.hitWall = false;
  result.bonked = false;

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(f.vx), Math.abs(f.vy)) / MAX_SUBSTEP));
  const sdx = f.vx / steps;
  const sdy = f.vy / steps;

  for (let s = 0; s < steps; s += 1) {
    if (sdx !== 0) {
      f.x += sdx;
      for (const p of world.platforms) {
        if (!p.def.solid) continue;
        const left = p.x;
        const right = p.x + p.def.w;
        const bottom = p.y + p.def.h;
        if (f.y > p.y + 1.5 && f.y - h < bottom && f.x + hw > left && f.x - hw < right) {
          f.x = sdx > 0 ? left - hw : right + hw;
          f.vx = 0;
          result.hitWall = true;
        }
      }
    }
    if (sdy !== 0) {
      const prevY = f.y;
      f.y += sdy;
      if (sdy > 0) {
        for (let i = 0; i < world.platforms.length; i += 1) {
          const p = world.platforms[i];
          if (!p.def.solid && f.dropThrough > 0) continue;
          const tolerance = 1 + Math.abs(p.dy);
          if (prevY <= p.y + tolerance && f.y >= p.y && f.x >= p.x - 3 && f.x <= p.x + p.def.w + 3) {
            f.y = p.y;
            f.vy = 0;
            f.grounded = true;
            f.platform = i;
            result.landed = true;
            break;
          }
        }
        if (result.landed) break;
      } else {
        for (const p of world.platforms) {
          if (!p.def.solid) continue;
          const bottom = p.y + p.def.h;
          if (
            f.y - h < bottom &&
            prevY - h >= bottom - 1 &&
            f.x + hw > p.x &&
            f.x - hw < p.x + p.def.w
          ) {
            f.y = bottom + h;
            f.vy = 0;
            result.bonked = true;
            break;
          }
        }
      }
    }
  }
  return result;
};

/**
 * After horizontal ground movement: keep the fighter glued to its platform,
 * or report that it walked off an edge (returns false → airborne).
 */
export const stickToGround = (world: World, f: Fighter): boolean => {
  const support = findSupport(world, f);
  if (support < 0) {
    f.grounded = false;
    f.platform = -1;
    return false;
  }
  f.platform = support;
  f.y = world.platforms[support].y;
  f.vy = 0;
  return true;
};

/**
 * Snap onto a ledge if the fighter is falling past one while facing it.
 * Returns true when the fighter grabbed.
 */
export const tryLedgeGrab = (world: World, f: Fighter): boolean => {
  if (f.ledgeCooldown > 0 || f.vy < -2) return false;
  for (let i = 0; i < world.ledges.length; i += 1) {
    const ledge = world.ledges[i];
    if (ledge.occupant >= 0) continue;
    const point = ledgePoint(world, ledge);
    // Fighter must be outside the stage corner, facing it (or steering into it).
    const toward = -ledge.side;
    const dx = (point.x - f.x) * toward; // >0 when still outside the corner
    if (dx < -10 || dx > LEDGE_GRAB_REACH_X + f.def.halfWidth) continue;
    const below = f.y - point.y;
    if (below < 18 || below > f.def.height + LEDGE_GRAB_REACH_Y - 20) continue;
    const facingIn = f.facing === toward;
    const steeringIn = Math.sign(f.stickX) === toward && Math.abs(f.stickX) > 0.3;
    if (!facingIn && !steeringIn) continue;

    f.ledge = i;
    ledge.occupant = f.index;
    f.hang = 0;
    f.state = "ledgeHang";
    f.sf = 0;
    f.moveId = null;
    f.vx = 0;
    f.vy = 0;
    f.fastFall = false;
    f.facing = toward as 1 | -1;
    f.jumpsLeft = f.def.airJumps;
    f.airDodgeUsed = false;
    f.helpless = false;
    f.invuln = Math.max(f.invuln, Math.max(0, 70 - f.ledgeGrabs * 16));
    f.ledgeGrabs += 1;
    snapToLedge(world, f);
    emit(world, { type: "ledge", who: f.index, x: f.x, y: f.y });
    return true;
  }
  return false;
};

/** Hang position: feet below the corner, body hugging the stage wall. */
export const snapToLedge = (world: World, f: Fighter): void => {
  if (f.ledge < 0) return;
  const ledge = world.ledges[f.ledge];
  const point = ledgePoint(world, ledge);
  f.x = point.x + ledge.side * (f.def.halfWidth * 0.55 + 6);
  f.y = point.y + f.def.height * 0.84;
};

export const ledgeHangExpired = (f: Fighter): boolean => f.hang >= LEDGE_HANG_MAX;
