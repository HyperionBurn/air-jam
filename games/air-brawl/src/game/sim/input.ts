import {
  BUFFER_FRAMES,
  DIR_THRESHOLD,
  FLICK_HIGH,
  FLICK_LOW,
  FLICK_SAMPLES,
  FLICK_WINDOW,
  STICK_DEADZONE,
} from "./constants";
import { BTN, type Fighter, type InputFrame } from "./types";

const HIST = 6;
const FLICK_NONE = 99;

/** Remap a raw stick vector through a radial deadzone, preserving direction. */
const applyDeadzone = (x: number, y: number, out: { x: number; y: number }): void => {
  const mag = Math.hypot(x, y);
  if (mag < STICK_DEADZONE) {
    out.x = 0;
    out.y = 0;
    return;
  }
  const scaled = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  out.x = (x / mag) * scaled;
  out.y = (y / mag) * scaled;
};

const scratch = { x: 0, y: 0 };

/**
 * Digest one tick of raw input into the fighter's input memory: processed
 * stick, press buffers, release edges, and flick detection (used to turn an
 * attack press into a smash on a touch stick).
 */
export const readInput = (f: Fighter, input: InputFrame): void => {
  applyDeadzone(input.mx, input.my, scratch);
  let sx = scratch.x;
  let sy = scratch.y;
  // Right-stick smash: behave as a perfect flick in that direction paired with an attack press.
  const cFlick = input.flick ?? 0;
  if (cFlick > 0) {
    sx = cFlick === 1 ? 1 : cFlick === 2 ? -1 : 0;
    sy = cFlick === 3 ? -1 : cFlick === 4 ? 1 : 0;
  }

  // Flick detection against the last few samples (before pushing the new one).
  let minAbsX = 1;
  let maxY = -1;
  let minY = 1;
  for (let i = 1; i <= FLICK_SAMPLES; i += 1) {
    const idx = (f.histPos - i + HIST * 4) % HIST;
    minAbsX = Math.min(minAbsX, Math.abs(f.sxHist[idx]));
    maxY = Math.max(maxY, f.syHist[idx]);
    minY = Math.min(minY, f.syHist[idx]);
  }
  f.flickXAge = Math.min(FLICK_NONE, f.flickXAge + 1);
  f.flickUpAge = Math.min(FLICK_NONE, f.flickUpAge + 1);
  f.flickDownAge = Math.min(FLICK_NONE, f.flickDownAge + 1);
  if (Math.abs(sx) >= FLICK_HIGH && minAbsX <= FLICK_LOW) {
    f.flickXAge = 0;
    f.flickXDir = sx > 0 ? 1 : -1;
  }
  if (sy <= -FLICK_HIGH && maxY >= -FLICK_LOW) f.flickUpAge = 0;
  if (sy >= FLICK_HIGH && minY <= FLICK_LOW) f.flickDownAge = 0;

  if (cFlick > 0) {
    if (sx !== 0) {
      f.flickXAge = 0;
      f.flickXDir = sx > 0 ? 1 : -1;
    }
    if (sy < 0) f.flickUpAge = 0;
    if (sy > 0) f.flickDownAge = 0;
  }

  f.sxHist[f.histPos] = sx;
  f.syHist[f.histPos] = sy;
  f.histPos = (f.histPos + 1) % HIST;
  f.stickX = sx;
  f.stickY = sy;

  f.downHeldFrames = sy >= DIR_THRESHOLD + 0.2 ? f.downHeldFrames + 1 : 0;

  f.prevHeld = f.held;
  f.held = input.held;
  const taps = input.taps | (input.held & ~f.prevHeld) | (cFlick > 0 ? BTN.ATTACK : 0);
  f.bJump = taps & BTN.JUMP ? BUFFER_FRAMES : Math.max(0, f.bJump - 1);
  f.bAttack = taps & BTN.ATTACK ? BUFFER_FRAMES : Math.max(0, f.bAttack - 1);
  f.bSpecial = taps & BTN.SPECIAL ? BUFFER_FRAMES : Math.max(0, f.bSpecial - 1);
  f.bShield = taps & BTN.SHIELD ? BUFFER_FRAMES : Math.max(0, f.bShield - 1);
  f.tapped = taps;
};

export const isHeld = (f: Fighter, bit: number): boolean => (f.held & bit) !== 0;
export const wasReleased = (f: Fighter, bit: number): boolean =>
  (f.prevHeld & bit) !== 0 && (f.held & bit) === 0;

export interface StickDir {
  /** -1/0/1 */
  x: number;
  y: number;
  /** Dominant axis. */
  axis: "x" | "y" | null;
}

const dirScratch: StickDir = { x: 0, y: 0, axis: null };

/** Discretise the stick into a direction with a dominant axis. */
export const stickDir = (f: Fighter): StickDir => {
  const ax = Math.abs(f.stickX);
  const ay = Math.abs(f.stickY);
  dirScratch.x = ax >= DIR_THRESHOLD ? (f.stickX > 0 ? 1 : -1) : 0;
  dirScratch.y = ay >= DIR_THRESHOLD ? (f.stickY > 0 ? 1 : -1) : 0;
  dirScratch.axis =
    dirScratch.x === 0 && dirScratch.y === 0 ? null : ay > ax * 1.15 ? "y" : dirScratch.x !== 0 ? "x" : "y";
  if (dirScratch.axis === "y") dirScratch.x = ay > ax * 1.15 ? 0 : dirScratch.x;
  if (dirScratch.axis === "x") dirScratch.y = 0;
  return dirScratch;
};

export const flickedX = (f: Fighter, dir: number): boolean =>
  f.flickXAge <= FLICK_WINDOW && f.flickXDir === dir;
export const flickedUp = (f: Fighter): boolean => f.flickUpAge <= FLICK_WINDOW;
export const flickedDown = (f: Fighter): boolean => f.flickDownAge <= FLICK_WINDOW;

/** Consume a buffered press. */
export const consumeJump = (f: Fighter): boolean => {
  if (f.bJump > 0) {
    f.bJump = 0;
    return true;
  }
  return false;
};
export const consumeAttack = (f: Fighter): boolean => {
  if (f.bAttack > 0) {
    f.bAttack = 0;
    return true;
  }
  return false;
};
export const consumeSpecial = (f: Fighter): boolean => {
  if (f.bSpecial > 0) {
    f.bSpecial = 0;
    return true;
  }
  return false;
};
export const consumeShield = (f: Fighter): boolean => {
  if (f.bShield > 0) {
    f.bShield = 0;
    return true;
  }
  return false;
};

export const clearBuffers = (f: Fighter): void => {
  f.bJump = 0;
  f.bAttack = 0;
  f.bSpecial = 0;
  f.bShield = 0;
};
