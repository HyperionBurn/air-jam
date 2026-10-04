import type { World } from "./types";

/** Mulberry32 on world.rng — the sim's only source of randomness. */
export const nextRandom = (world: World): number => {
  world.rng = (world.rng + 0x6d2b79f5) | 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const approach = (value: number, target: number, step: number): number => {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return value;
};

export const sign = (value: number): -1 | 0 | 1 => (value > 0 ? 1 : value < 0 ? -1 : 0);

export const DEG = Math.PI / 180;

/** Circle vs axis-aligned rectangle overlap. */
export const circleHitsRect = (
  cx: number,
  cy: number,
  r: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean => {
  const nx = clamp(cx, left, right);
  const ny = clamp(cy, top, bottom);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
};
