import type { HitboxDef, MoveDef } from "../sim/types";

/**
 * Shared normal-move templates. Each fighter scales them with a `MoveProfile`
 * (speed, power, reach…) and then overrides / adds its own specials, so every
 * character gets a complete, coherent move set from structured frame data.
 */

export interface MoveProfile {
  /** Time multiplier: <1 = faster startup and recovery. */
  speed: number;
  /** Extra multiplier on recovery frames only. */
  lag: number;
  power: number;
  kb: number;
  growth: number;
  reach: number;
  size: number;
  landing: number;
}

export const AVERAGE_PROFILE: MoveProfile = {
  speed: 1,
  lag: 1,
  power: 1,
  kb: 1,
  growth: 1,
  reach: 1,
  size: 1,
  landing: 1,
};

type HitOpts = Partial<
  Pick<
    HitboxDef,
    | "x2"
    | "y2"
    | "hitlag"
    | "stun"
    | "priority"
    | "group"
    | "fx"
    | "sfx"
    | "grab"
    | "shieldMul"
    | "groundOnly"
    | "airOnly"
  >
>;

/** Hitbox shorthand: frames, circle (x,y,r), damage, angle, base kb, growth. */
export const hb = (
  from: number,
  to: number,
  x: number,
  y: number,
  r: number,
  damage: number,
  angle: number,
  baseKb: number,
  growth: number,
  opts: HitOpts = {},
): HitboxDef => ({ from, to, x, y, r, damage, angle, baseKb, growth, ...opts });

const scaleFrame = (frame: number, speed: number): number => Math.max(0, Math.round(frame * speed));

/** Apply a profile to a move template, returning a fresh MoveDef. */
export const scaleMove = (template: MoveDef, p: MoveProfile): MoveDef => {
  const sf = (f: number) => scaleFrame(f, p.speed);
  const hitboxes = template.hitboxes.map((box) => {
    const from = Math.max(1, sf(box.from));
    const to = Math.max(from, sf(box.to));
    return {
      ...box,
      from,
      to,
      x: box.x * p.reach,
      y: box.y,
      r: box.r * p.size,
      ...(box.x2 !== undefined ? { x2: box.x2 * p.reach } : {}),
      ...(box.y2 !== undefined ? { y2: box.y2 } : {}),
      damage: Math.max(box.grab ? 0 : 0.5, box.damage * p.power),
      baseKb: box.baseKb * p.kb,
      growth: box.growth * p.growth,
    };
  });
  const lastActive = hitboxes.reduce((m, box) => Math.max(m, box.to), 0);
  const total = Math.max(
    lastActive + 2,
    Math.round(template.total * p.speed * (template.kind === "grab" ? 1 : p.lag)),
  );
  return {
    ...template,
    total,
    hitboxes,
    landingLag:
      template.landingLag !== undefined
        ? Math.max(2, Math.round(template.landingLag * p.landing))
        : undefined,
    chain: template.chain
      ? { ...template.chain, from: sf(template.chain.from), until: Math.max(sf(template.chain.from) + 2, sf(template.chain.until)) }
      : undefined,
    charge: template.charge ? { ...template.charge, at: Math.max(2, sf(template.charge.at)) } : undefined,
    motion: template.motion?.map((key) => ({
      ...key,
      at: sf(key.at),
      hold: key.hold !== undefined ? Math.max(1, sf(key.hold)) : undefined,
    })),
    spawns: template.spawns?.map((s) => ({ ...s, at: Math.max(1, sf(s.at)) })),
    invuln: template.invuln ? [sf(template.invuln[0]), Math.max(sf(template.invuln[0]) + 1, sf(template.invuln[1]))] : undefined,
    armor: template.armor ? [sf(template.armor[0]), Math.max(sf(template.armor[0]) + 1, sf(template.armor[1]))] : undefined,
    releaseAt: template.releaseAt !== undefined ? Math.max(2, sf(template.releaseAt)) : undefined,
  };
};

const move = (m: MoveDef): MoveDef => m;

/** Normal-move templates for an average (Nova-like) fighter. */
const TEMPLATES: Record<string, MoveDef> = {
  jab1: move({
    id: "jab1",
    name: "Jab",
    kind: "ground",
    total: 17,
    hitboxes: [hb(4, 6, 44, -54, 28, 2.4, 361, 10, 6, { sfx: "light", fx: "impact", hitlag: 0.9 })],
    chain: { to: "jab2", from: 7, until: 17 },
    anim: "jab",
  }),
  jab2: move({
    id: "jab2",
    name: "Jab 2",
    kind: "ground",
    total: 17,
    hitboxes: [hb(3, 5, 46, -50, 28, 2.4, 361, 10, 6, { sfx: "light", fx: "impact", hitlag: 0.9 })],
    chain: { to: "jab3", from: 7, until: 17 },
    anim: "jab2",
  }),
  jab3: move({
    id: "jab3",
    name: "Jab Finisher",
    kind: "ground",
    total: 30,
    hitboxes: [hb(6, 10, 54, -52, 34, 4.2, 42, 26, 62, { sfx: "mid", fx: "impact" })],
    anim: "jab3",
  }),
  ftilt: move({
    id: "ftilt",
    name: "Forward Tilt",
    kind: "ground",
    total: 26,
    hitboxes: [hb(7, 10, 54, -54, 32, 7.5, 38, 24, 82, { sfx: "mid", fx: "slash" })],
    anim: "tilt",
  }),
  utilt: move({
    id: "utilt",
    name: "Up Tilt",
    kind: "ground",
    total: 24,
    hitboxes: [
      hb(6, 11, 8, -104, 38, 6.5, 90, 26, 88, { sfx: "mid", fx: "slash", x2: 34, y2: -78 }),
    ],
    anim: "uptilt",
  }),
  dtilt: move({
    id: "dtilt",
    name: "Down Tilt",
    kind: "ground",
    total: 20,
    hitboxes: [hb(5, 9, 56, -14, 26, 5, 80, 20, 58, { sfx: "light", fx: "impact" })],
    anim: "downtilt",
  }),
  dashAttack: move({
    id: "dashAttack",
    name: "Dash Attack",
    kind: "ground",
    total: 38,
    hitboxes: [hb(5, 16, 46, -50, 34, 7.5, 48, 26, 76, { sfx: "mid", fx: "impact" })],
    motion: [{ at: 0, vx: 7, mode: "set", hold: 14 }],
    anim: "dash",
  }),
  fsmash: move({
    id: "fsmash",
    name: "Forward Smash",
    kind: "ground",
    total: 50,
    charge: { at: 12, max: 52, damageMul: 1.35, kbMul: 1.25 },
    hitboxes: [hb(17, 21, 66, -56, 42, 16, 38, 32, 96, { sfx: "heavy", fx: "slash", x2: 34, y2: -62 })],
    anim: "smash",
  }),
  usmash: move({
    id: "usmash",
    name: "Up Smash",
    kind: "ground",
    total: 48,
    charge: { at: 11, max: 52, damageMul: 1.35, kbMul: 1.25 },
    hitboxes: [hb(14, 21, 0, -112, 48, 15, 90, 30, 100, { sfx: "heavy", fx: "slash", x2: 40, y2: -96 })],
    anim: "upsmash",
  }),
  dsmash: move({
    id: "dsmash",
    name: "Down Smash",
    kind: "ground",
    total: 46,
    charge: { at: 10, max: 52, damageMul: 1.35, kbMul: 1.25 },
    hitboxes: [
      hb(12, 16, 62, -20, 32, 12, 32, 26, 90, { sfx: "heavy", fx: "impact", group: 0 }),
      hb(18, 22, -62, -20, 32, 12, 148, 26, 90, { sfx: "heavy", fx: "impact", group: 1 }),
    ],
    anim: "downsmash",
  }),
  nair: move({
    id: "nair",
    name: "Neutral Air",
    kind: "aerial",
    total: 36,
    landingLag: 9,
    hitboxes: [
      hb(4, 8, 0, -52, 42, 8, 361, 18, 66, { sfx: "mid", fx: "impact", group: 0 }),
      hb(9, 18, 0, -52, 38, 4.5, 361, 14, 50, { sfx: "light", fx: "impact", group: 1 }),
    ],
    anim: "nair",
  }),
  fair: move({
    id: "fair",
    name: "Forward Air",
    kind: "aerial",
    total: 34,
    landingLag: 14,
    hitboxes: [hb(9, 13, 54, -52, 34, 10, 42, 30, 96, { sfx: "mid", fx: "slash" })],
    anim: "fair",
  }),
  bair: move({
    id: "bair",
    name: "Back Air",
    kind: "aerial",
    total: 30,
    landingLag: 12,
    hitboxes: [hb(7, 11, -56, -50, 32, 11.5, 148, 28, 100, { sfx: "heavy", fx: "impact" })],
    anim: "bair",
  }),
  uair: move({
    id: "uair",
    name: "Up Air",
    kind: "aerial",
    total: 28,
    landingLag: 9,
    hitboxes: [hb(6, 12, 8, -112, 38, 8.5, 90, 22, 90, { sfx: "mid", fx: "slash", x2: 30, y2: -96 })],
    anim: "uair",
  }),
  dair: move({
    id: "dair",
    name: "Down Air",
    kind: "aerial",
    total: 42,
    landingLag: 20,
    hitboxes: [hb(12, 20, 4, 10, 30, 11, 270, 22, 70, { sfx: "heavy", fx: "meteor", priority: 7 })],
    anim: "dair",
  }),
  grab: move({
    id: "grab",
    name: "Grab",
    kind: "grab",
    total: 42,
    hitboxes: [hb(7, 10, 50, -52, 32, 0, 0, 0, 0, { grab: true, fx: "impact", sfx: "light" })],
    anim: "grab",
  }),
  throwF: move({
    id: "throwF",
    name: "Forward Throw",
    kind: "throw",
    total: 32,
    releaseAt: 14,
    hitboxes: [hb(14, 14, 44, -50, 20, 7, 38, 44, 82, { sfx: "heavy", fx: "impact" })],
    anim: "throw",
  }),
  throwB: move({
    id: "throwB",
    name: "Back Throw",
    kind: "throw",
    total: 34,
    releaseAt: 16,
    hitboxes: [hb(16, 16, -44, -50, 20, 8, 146, 44, 86, { sfx: "heavy", fx: "impact" })],
    anim: "throw",
  }),
  throwU: move({
    id: "throwU",
    name: "Up Throw",
    kind: "throw",
    total: 30,
    releaseAt: 14,
    hitboxes: [hb(14, 14, 0, -100, 20, 6, 90, 50, 86, { sfx: "heavy", fx: "impact" })],
    anim: "throw",
  }),
  throwD: move({
    id: "throwD",
    name: "Down Throw",
    kind: "throw",
    total: 34,
    releaseAt: 14,
    hitboxes: [hb(14, 14, 40, -10, 20, 5, 80, 26, 40, { sfx: "mid", fx: "impact" })],
    anim: "throw",
  }),
  ledgeAttack: move({
    id: "ledgeAttack",
    name: "Ledge Attack",
    kind: "ledge",
    total: 36,
    hitboxes: [hb(14, 20, 58, -34, 36, 7, 55, 26, 70, { sfx: "mid", fx: "impact" })],
    anim: "ledge",
  }),
};

export const BASE_MOVE_IDS = Object.keys(TEMPLATES);

/** Build a fighter's shared normals from a profile. */
export const buildNormals = (profile: MoveProfile): Record<string, MoveDef> => {
  const out: Record<string, MoveDef> = {};
  for (const [id, template] of Object.entries(TEMPLATES)) {
    out[id] = scaleMove(template, profile);
  }
  return out;
};

export const getTemplate = (id: string): MoveDef => TEMPLATES[id];
