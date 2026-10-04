import { PROJECTILES } from "../data/projectiles";
import { MAX_PROJECTILES } from "./constants";
import { applyHit } from "./combat";
import { emit, isTargetable } from "./ops";
import type { Fighter, ProjectileEntity, ProjectileId, World } from "./types";
import { circleHitsRect, clamp } from "./util";

export const spawnProjectile = (
  world: World,
  owner: Fighter,
  id: ProjectileId,
  x: number,
  y: number,
  vx: number,
  vy: number,
): boolean => {
  const def = PROJECTILES[id];
  if (world.projectiles.length >= MAX_PROJECTILES) return false;
  let owned = 0;
  for (const p of world.projectiles) {
    if (p.ownerIndex === owner.index && p.def.id === id && !p.dead) owned += 1;
  }
  if (owned >= def.maxPerOwner) return false;
  const entity: ProjectileEntity = {
    id: world.nextEntityId++,
    def,
    ownerIndex: owner.index,
    x,
    y,
    px: x,
    py: y,
    vx,
    vy,
    age: 0,
    hitsLeft: def.pierce,
    hitMask: 0,
    returning: false,
    dead: false,
    powered: owner.buffPower > 0,
  };
  world.projectiles.push(entity);
  emit(world, { type: "projectile", who: owner.index, id, x, y });
  return true;
};

const friendly = (world: World, owner: Fighter | undefined, target: Fighter): boolean =>
  !!owner && target.team === owner.team && !world.config.friendlyFire;

export const explodeProjectile = (world: World, p: ProjectileEntity): void => {
  if (p.dead) return;
  p.dead = true;
  const blast = p.def.blast;
  if (!blast) return;
  const owner = world.fighters[p.ownerIndex];
  emit(world, { type: "explosion", x: p.x, y: p.y, radius: blast.radius });
  for (const target of world.fighters) {
    if (!isTargetable(target) || target === owner) continue;
    if (friendly(world, owner, target)) continue;
    if (
      !circleHitsRect(
        p.x,
        p.y,
        blast.radius,
        target.x - target.def.halfWidth,
        target.y - target.def.height,
        target.x + target.def.halfWidth,
        target.y,
      )
    ) {
      continue;
    }
    const dir = target.x >= p.x ? 1 : -1;
    applyHit(
      world,
      target,
      {
        damage: blast.damage,
        angle: p.def.angle,
        baseKb: blast.baseKb,
        growth: blast.growth,
        fx: p.def.fx,
        sfx: "heavy",
      },
      { attacker: p.ownerIndex, moveId: p.def.id, dirSign: dir, x: target.x, y: target.y - target.def.height / 2 },
    );
  }
};

const enemyNear = (world: World, p: ProjectileEntity, radius: number): boolean => {
  const owner = world.fighters[p.ownerIndex];
  for (const target of world.fighters) {
    if (!isTargetable(target) || target === owner) continue;
    if (friendly(world, owner, target)) continue;
    const dx = target.x - p.x;
    const dy = target.y - target.def.height / 2 - p.y;
    if (dx * dx + dy * dy <= radius * radius) return true;
  }
  return false;
};

export const updateProjectiles = (world: World): void => {
  const blast = world.stage.blast;
  for (const p of world.projectiles) {
    if (p.dead) continue;
    const def = p.def;
    const owner = world.fighters[p.ownerIndex];
    p.px = p.x;
    p.py = p.y;
    p.age += 1;

    if (def.boomerangAt !== undefined && p.age === def.boomerangAt) {
      p.vx = -p.vx;
      p.returning = true;
      p.hitMask = 0;
    }
    if (p.returning && owner) {
      p.vx = clamp(p.vx + Math.sign(owner.x - p.x) * 0.55, -13, 13);
      p.vy += (owner.y - owner.def.height * 0.55 - p.y) * 0.03;
      p.vy = clamp(p.vy, -6, 6);
      if (Math.abs(owner.x - p.x) < 36 && Math.abs(owner.y - owner.def.height * 0.55 - p.y) < 60 && p.age > def.boomerangAt! + 8) {
        p.dead = true;
        continue;
      }
    }

    p.vy += def.gravity;
    if (def.drag) p.vx *= 1 - def.drag;
    p.x += p.vx;
    p.y += p.vy;

    // Stage collision.
    for (const plat of world.platforms) {
      const left = plat.x;
      const right = plat.x + plat.def.w;
      const bottom = plat.y + plat.def.h;
      const r = def.radius;
      const withinX = p.x + r > left && p.x - r < right;
      if (!withinX) continue;
      if (p.vy >= 0 && p.py + r <= plat.y + 2 + Math.abs(plat.dy) && p.y + r >= plat.y) {
        if (def.look === "mine") {
          p.y = plat.y - r;
          p.vy = 0;
          p.vx *= 0.6;
        } else if (def.bounce) {
          p.y = plat.y - r;
          p.vy = Math.abs(p.vy) < 2.2 ? 0 : -p.vy * 0.5;
          p.vx *= 0.92;
        } else if (plat.def.solid) {
          p.dead = true;
        }
        break;
      }
      if (plat.def.solid && p.y + r > plat.y + 2 && p.y - r < bottom) {
        if (def.look === "mine") {
          p.vx = 0;
        } else if (def.bounce) {
          p.vx = -p.vx * 0.6;
          p.x += p.vx;
        } else {
          p.dead = true;
        }
        break;
      }
    }
    if (p.dead) continue;

    if (p.x < blast.left - 200 || p.x > blast.right + 200 || p.y < blast.top - 300 || p.y > blast.bottom + 200) {
      p.dead = true;
      continue;
    }

    // Triggered explosives.
    if (def.blast) {
      const armed = def.arm === undefined || p.age >= def.arm;
      if (armed && def.trigger !== undefined && enemyNear(world, p, def.trigger)) {
        explodeProjectile(world, p);
        continue;
      }
      if (p.age >= def.ttl) {
        explodeProjectile(world, p);
        continue;
      }
    } else if (p.age >= def.ttl) {
      p.dead = true;
      continue;
    }

    // Contact damage.
    if (def.damage <= 0) continue;
    for (const target of world.fighters) {
      if (!isTargetable(target) || target.index === p.ownerIndex) continue;
      if (friendly(world, owner, target)) continue;
      if (p.hitMask & (1 << target.index)) continue;
      if (
        !circleHitsRect(
          p.x,
          p.y,
          def.radius,
          target.x - target.def.halfWidth,
          target.y - target.def.height,
          target.x + target.def.halfWidth,
          target.y,
        )
      ) {
        continue;
      }
      const dirSign = (p.vx > 0.01 ? 1 : p.vx < -0.01 ? -1 : (owner?.facing ?? 1)) as 1 | -1;
      const outcome = applyHit(
        world,
        target,
        {
          damage: def.damage,
          angle: def.angle,
          baseKb: def.baseKb,
          growth: def.growth,
          hitlag: def.hitlag,
          fx: def.fx,
          sfx: def.sfx,
        },
        { attacker: p.ownerIndex, moveId: def.id, dirSign, x: p.x, y: p.y },
      );
      if (outcome === "none") continue;
      p.hitMask |= 1 << target.index;
      if (outcome === "shield" || outcome === "aegis") {
        p.dead = true;
        break;
      }
      p.hitsLeft -= 1;
      if (p.hitsLeft <= 0) {
        p.dead = true;
        break;
      }
    }
  }
  // Compact.
  let write = 0;
  for (let i = 0; i < world.projectiles.length; i += 1) {
    if (!world.projectiles[i].dead) world.projectiles[write++] = world.projectiles[i];
  }
  world.projectiles.length = write;
};
