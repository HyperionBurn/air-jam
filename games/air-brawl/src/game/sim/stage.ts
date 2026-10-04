import type { Fighter, LedgeRef, PlatformRuntime, StageDef, World } from "./types";

/** Resolve platform positions for a given frame (deterministic). */
const platformPosition = (
  def: StageDef["platforms"][number],
  frame: number,
): { x: number; y: number } => {
  if (!def.move) return { x: def.x, y: def.y };
  const t = (frame / def.move.period + (def.move.phase ?? 0)) * Math.PI * 2;
  const s = Math.sin(t);
  return { x: def.x + s * def.move.ax, y: def.y + s * def.move.ay };
};

export const createPlatforms = (stage: StageDef): PlatformRuntime[] =>
  stage.platforms.map((def) => {
    const pos = platformPosition(def, 0);
    return { def, x: pos.x, y: pos.y, dx: 0, dy: 0 };
  });

export const createLedges = (stage: StageDef): LedgeRef[] => {
  const ledges: LedgeRef[] = [];
  stage.platforms.forEach((def, index) => {
    if (def.solid && def.ledges) {
      ledges.push({ platform: index, side: -1, occupant: -1 });
      ledges.push({ platform: index, side: 1, occupant: -1 });
    }
  });
  return ledges;
};

export const ledgePoint = (world: World, ledge: LedgeRef): { x: number; y: number } => {
  const p = world.platforms[ledge.platform];
  return { x: ledge.side === -1 ? p.x : p.x + p.def.w, y: p.y };
};

/** Move platforms to this frame and carry grounded fighters along. */
export const updatePlatforms = (world: World): void => {
  for (const p of world.platforms) {
    if (!p.def.move) continue;
    const pos = platformPosition(p.def, world.frame);
    p.dx = pos.x - p.x;
    p.dy = pos.y - p.y;
    p.x = pos.x;
    p.y = pos.y;
  }
  for (const f of world.fighters) {
    if (!f.alive || !f.grounded || f.platform < 0) continue;
    const p = world.platforms[f.platform];
    if (p.dx !== 0 || p.dy !== 0) {
      f.x += p.dx;
      f.y += p.dy;
      f.px += p.dx;
      f.py += p.dy;
    }
  }
};

/** Index of the platform supporting a grounded fighter, or -1. */
export const findSupport = (world: World, f: Fighter): number => {
  const tolerance = 2.5;
  let best = -1;
  for (let i = 0; i < world.platforms.length; i += 1) {
    const p = world.platforms[i];
    if (Math.abs(f.y - p.y) > tolerance) continue;
    if (f.x < p.x - 1 || f.x > p.x + p.def.w + 1) continue;
    if (!p.def.solid && f.dropThrough > 0) continue;
    best = i;
    if (i === f.platform) break;
  }
  return best;
};

/** Spawn point for a roster slot given the player count. */
export const spawnPointFor = (stage: StageDef, order: number, count: number): { x: number; y: number } => {
  const spots = stage.spawns.length;
  const idx = count <= 1 ? 3 : Math.round(((order + 0.5) * spots) / count - 0.5);
  return stage.spawns[Math.max(0, Math.min(spots - 1, idx))];
};
