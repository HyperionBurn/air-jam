import {
  DI_MAX,
  GRAB_BASE_HOLD,
  GRAB_HOLD_PER_PERCENT,
  HITLAG_BASE,
  HITLAG_MAX,
  HITLAG_PER_DAMAGE,
  HITSTUN_PER_KB,
  KB_DECEL_X,
  KB_GRAVITY_MUL,
  KB_SPEED,
  PERFECT_SHIELD_FRAMES,
  POWER_DAMAGE_MUL,
  POWER_KB_MUL,
  PRIORITY_CLANK,
  SHIELD_BREAK_FRAMES,
  SHIELD_PUSHBACK,
  SHIELD_STUN_BASE,
  SHIELD_STUN_PER_DAMAGE,
  STALE_MIN,
  STALE_QUEUE,
  STALE_STEP,
  TUMBLE_KB,
} from "./constants";
import { clearBuffers } from "./input";
import {
  becomeAirborne,
  currentMove,
  emit,
  isTargetable,
  releaseGrabLink,
  releaseLedge,
  setState,
} from "./ops";
import type {
  Fighter,
  HitboxDef,
  HitFx,
  MoveDef,
  SfxWeight,
  World,
} from "./types";
import { circleHitsRect, clamp, DEG } from "./util";

export interface HitData {
  damage: number;
  /** Degrees relative to the attack direction (0 = away, 90 = up, 270 = down). */
  angle: number;
  baseKb: number;
  growth: number;
  hitlag?: number;
  stun?: number;
  fx: HitFx;
  sfx: SfxWeight;
  shieldMul?: number;
}

export interface HitContext {
  /** Fighter index of the attacker, or -1 for environment hits. */
  attacker: number;
  moveId: string;
  /** +1 launches to the right, -1 to the left (before the angle is applied). */
  dirSign: 1 | -1;
  x: number;
  y: number;
  dmgMul?: number;
  kbMul?: number;
  /** Attacker takes hitlag too (melee) */
  attackerLag?: boolean;
}

/** How stale `moveId` is for this attacker right now: 1 = fresh, STALE_MIN = fully stale. */
export const staleMultiplier = (attacker: Fighter | null, moveId: string): number => {
  if (!attacker || attacker.staleQueue.length === 0) return 1;
  let copies = 0;
  for (const m of attacker.staleQueue) if (m === moveId) copies += 1;
  return Math.max(STALE_MIN, 1 - STALE_STEP * copies);
};

/** Record a landed move once per use (multi-hit moves count as one). */
const noteLanded = (attacker: Fighter, moveId: string): void => {
  if (attacker.staleUse === attacker.moveUse) return;
  attacker.staleUse = attacker.moveUse;
  attacker.staleQueue.push(moveId);
  if (attacker.staleQueue.length > STALE_QUEUE) attacker.staleQueue.shift();
};

/** Hazards and items hit with ids that are not a fighter's own moves; they never go stale. */
const isEnvironmentMove = (moveId: string): boolean => moveId === "" || moveId.startsWith("hazard") || moveId.startsWith("item");

export type HitOutcome = "hit" | "shield" | "armor" | "aegis" | "none";

/** Smash-style knockback value for a hit landing on `target` after damage. */
export const knockbackValue = (
  weight: number,
  percentAfter: number,
  damage: number,
  baseKb: number,
  growth: number,
  scale: number,
): number => {
  const raw =
    (((percentAfter / 10 + (percentAfter * damage) / 20) * (200 / (weight + 100)) * 1.4 + 18) * growth) / 100 +
    baseKb;
  return raw * scale;
};

export const hitlagFor = (damage: number, mul: number): number =>
  clamp(Math.floor((HITLAG_BASE + damage * HITLAG_PER_DAMAGE) * mul), 3, HITLAG_MAX);

/** Is the target's current move inside a super-armor window? */
export const isArmored = (f: Fighter): boolean => {
  const move = currentMove(f);
  if (!move?.armor) return false;
  return f.sf >= move.armor[0] && f.sf <= move.armor[1];
};

/** Resolve a launch direction (unit vector) for an angle + facing, with auto angle handling. */
export const launchDirection = (
  angleDeg: number,
  dirSign: number,
  kb: number,
  targetGrounded: boolean,
  out: { x: number; y: number },
): void => {
  let angle = angleDeg;
  if (angle === 361) angle = kb < 28 ? 0 : targetGrounded ? 30 : 42;
  const rad = angle * DEG;
  out.x = Math.cos(rad) * dirSign;
  out.y = -Math.sin(rad);
};

const dirScratch = { x: 0, y: 0 };

/** Would this launch carry the target out of the blast zone before it can act again? */
export const willBeKilled = (world: World, f: Fighter, lx: number, ly: number, hitstun: number): boolean => {
  let x = f.x;
  let y = f.y;
  let vx = lx;
  let vy = ly;
  const { left, right, top, bottom } = world.stage.blast;
  const frames = hitstun + 36;
  for (let i = 0; i < frames; i += 1) {
    vx = vx > 0 ? Math.max(0, vx - KB_DECEL_X) : Math.min(0, vx + KB_DECEL_X);
    vy += f.def.gravity * KB_GRAVITY_MUL;
    vy = Math.min(vy, f.def.fallSpeed * 1.4);
    const py = y;
    x += vx;
    y += vy;
    if (x < left || x > right || y < top || y > bottom) return true;
    if (vy > 0) {
      for (const p of world.platforms) {
        if (p.def.solid && py <= p.y && y >= p.y && x >= p.x && x <= p.x + p.def.w) return false;
      }
    }
  }
  return false;
};

const addToken = (f: Fighter, token: number): void => {
  f.hitLog.push(token);
};

const hasToken = (f: Fighter, token: number): boolean => f.hitLog.includes(token);

/**
 * The single place where damage, knockback, shielding and armor are applied.
 * Melee, projectiles, throws, hazards and explosions all funnel through here.
 */
export const applyHit = (
  world: World,
  target: Fighter,
  data: HitData,
  ctx: HitContext,
): HitOutcome => {
  if (!isTargetable(target)) return "none";
  if (target.invuln > 0) return "none";
  const attacker = ctx.attacker >= 0 ? world.fighters[ctx.attacker] : null;
  const fresh = attacker && !isEnvironmentMove(ctx.moveId) ? staleMultiplier(attacker, ctx.moveId) : 1;
  const dmgMul = (ctx.dmgMul ?? 1) * fresh * (attacker && attacker.buffPower > 0 ? POWER_DAMAGE_MUL : 1);
  // Knockback goes stale at a third of the damage rate, so a stale kill move still kills, a bit later.
  const kbMul = (ctx.kbMul ?? 1) * (0.7 + 0.3 * fresh) * (attacker && attacker.buffPower > 0 ? POWER_KB_MUL : 1);
  const damage = data.damage * dmgMul;

  // Aegis pickup: absorbs a few hits entirely.
  if (target.buffAegis > 0 && target.armorHits > 0 && target.state !== "shield") {
    target.armorHits -= 1;
    if (target.armorHits <= 0) target.buffAegis = 0;
    emit(world, { type: "shieldHit", attacker: ctx.attacker, victim: target.index, x: ctx.x, y: ctx.y, damage });
    if (attacker && ctx.attackerLag) attacker.hitlag = Math.max(attacker.hitlag, 5);
    return "aegis";
  }

  // Parry: a shield raised just in time takes nothing, is not stunned, and the attacker is punished.
  if (target.state === "shield" && target.shieldFresh && target.sf <= PERFECT_SHIELD_FRAMES && target.hitlag === 0) {
    const parryLag = Math.max(12, Math.floor(hitlagFor(damage, data.hitlag ?? 1) * 1.6));
    emit(world, { type: "parry", attacker: ctx.attacker, victim: target.index, x: ctx.x, y: ctx.y });
    target.shieldRegenDelay = 20;
    target.shield = Math.min(target.def.shieldMax, target.shield + 6);
    target.hitlag = Math.min(6, parryLag);
    if (attacker && ctx.attackerLag) {
      attacker.hitlag = parryLag;
      if (attacker.grounded) attacker.vx = -ctx.dirSign * SHIELD_PUSHBACK * 1.8;
    }
    return "shield";
  }

  // Shield.
  if (target.state === "shield" || target.state === "shieldStun") {
    const shieldDamage = damage * 1.15 * (data.shieldMul ?? 1) + 1;
    target.shield -= shieldDamage;
    target.shieldRegenDelay = 40;
    const lag = Math.max(3, Math.floor(hitlagFor(damage, data.hitlag ?? 1) * 0.75));
    emit(world, { type: "shieldHit", attacker: ctx.attacker, victim: target.index, x: ctx.x, y: ctx.y, damage });
    if (attacker && ctx.attackerLag) {
      attacker.hitlag = lag;
      if (attacker.grounded) attacker.vx = -ctx.dirSign * SHIELD_PUSHBACK;
    }
    target.hitlag = lag;
    if (target.shield <= 0) {
      target.shield = 0;
      breakShield(world, target);
      return "shield";
    }
    target.state = "shieldStun";
    target.sf = 0;
    target.hitstun = Math.floor(shieldDamage * SHIELD_STUN_PER_DAMAGE) + SHIELD_STUN_BASE;
    target.vx = ctx.dirSign * 1.2;
    return "shield";
  }

  // Normal hit.
  target.percent = Math.min(999, target.percent + damage);
  if (attacker && !isEnvironmentMove(ctx.moveId)) noteLanded(attacker, ctx.moveId);
  if (attacker) {
    world.stats[attacker.index].damageDealt += damage;
    world.stats[attacker.index].moveHits[ctx.moveId] = (world.stats[attacker.index].moveHits[ctx.moveId] ?? 0) + 1;
  }
  world.stats[target.index].damageTaken += damage;
  target.lastHitBy = ctx.attacker;
  target.lastHitMove = ctx.moveId;
  target.lastHitFrame = world.frame;
  target.sinceHit = 0;

  const kb = knockbackValue(
    target.def.weight,
    target.percent,
    damage,
    data.baseKb,
    data.growth,
    world.config.kbScale * kbMul,
  );
  const lag = hitlagFor(damage, data.hitlag ?? 1);

  // Super armor: take the damage, keep acting.
  if (isArmored(target) && kb < 92) {
    target.hitlag = Math.min(4, lag);
    if (attacker && ctx.attackerLag) attacker.hitlag = lag;
    emit(world, {
      type: "hit",
      attacker: ctx.attacker,
      victim: target.index,
      x: ctx.x,
      y: ctx.y,
      damage,
      kb,
      angle: data.angle,
      dx: ctx.dirSign,
      dy: 0,
      moveId: ctx.moveId,
      fx: "impact",
      sfx: "light",
      lag,
      killing: false,
    });
    return "armor";
  }

  launchDirection(data.angle, ctx.dirSign, kb, target.grounded, dirScratch);
  let dx = dirScratch.x;
  let dy = dirScratch.y;

  // Directional influence: tilt the launch toward the held stick.
  if (target.stickX !== 0 || target.stickY !== 0) {
    const cross = dx * target.stickY - dy * target.stickX;
    const shift = clamp(cross, -1, 1) * DI_MAX;
    const cos = Math.cos(shift);
    const sin = Math.sin(shift);
    const nx = dx * cos - dy * sin;
    const ny = dx * sin + dy * cos;
    dx = nx;
    dy = ny;
  }
  // Grounded fighters cannot be spiked into the floor: reflect upward.
  if (target.grounded && dy > 0) dy = -dy * 0.5;

  const speed = kb * KB_SPEED;
  const lx = dx * speed;
  let ly = dy * speed;
  const stunMul = data.stun ?? 1;
  const hitstun = Math.max(4, Math.floor(kb * HITSTUN_PER_KB * stunMul));

  // Cancel whatever the victim was doing.
  releaseGrabLink(world, target);
  releaseLedge(world, target);
  clearBuffers(target);
  target.moveId = null;
  target.chargeFrames = 0;
  target.vanished = false;
  setState(target, "hitstun");
  target.hitstun = hitstun;
  target.tumble = kb >= TUMBLE_KB;
  target.bounced = false;
  target.hitlag = lag;
  target.fastFall = false;
  target.helpless = false;
  if (ly < -0.5 || (!target.grounded && ly !== 0)) {
    becomeAirborne(target);
  } else if (target.grounded && ly < 0) {
    becomeAirborne(target);
  }
  if (target.grounded) ly = 0;
  target.pendLx = lx;
  target.pendLy = ly;

  if (attacker && ctx.attackerLag) attacker.hitlag = lag;

  const killing = willBeKilled(world, target, lx, ly, hitstun);
  emit(world, {
    type: "hit",
    attacker: ctx.attacker,
    victim: target.index,
    x: ctx.x,
    y: ctx.y,
    damage,
    kb,
    angle: data.angle,
    dx,
    dy,
    moveId: ctx.moveId,
    fx: data.fx,
    sfx: data.sfx,
    lag,
    killing,
    stale: fresh >= 1 ? 0 : (1 - fresh) / (1 - STALE_MIN),
  });
  return "hit";
};

export const breakShield = (world: World, f: Fighter): void => {
  releaseGrabLink(world, f);
  setState(f, "shieldBreak");
  f.hitstun = SHIELD_BREAK_FRAMES;
  f.vx = 0;
  f.vy = -9;
  becomeAirborne(f);
  f.invuln = 0;
  emit(world, { type: "shieldBreak", victim: f.index, x: f.x, y: f.y - f.def.height / 2 });
};

/* -------------------------------------------------------------------- GRABS */

export const startGrab = (world: World, attacker: Fighter, target: Fighter): boolean => {
  if (target.grabbedBy >= 0 || target.state === "grabbed") return false;
  if (!isTargetable(target) || target.invuln > 0) return false;
  releaseLedge(world, target);
  target.moveId = null;
  clearBuffers(target);
  setState(target, "grabbed");
  target.grabbedBy = attacker.index;
  target.mashCount = 0;
  target.vx = 0;
  target.vy = 0;
  target.hitlag = 0;
  attacker.moveId = null;
  setState(attacker, "grabbing");
  attacker.grabTarget = target.index;
  attacker.grabTimer = GRAB_BASE_HOLD + target.percent * GRAB_HOLD_PER_PERCENT;
  attacker.vx = 0;
  attacker.pummelCd = 0;
  target.facing = (attacker.facing * -1) as 1 | -1;
  emit(world, { type: "grab", attacker: attacker.index, victim: target.index, x: attacker.x, y: attacker.y - 50 });
  return true;
};

/** Hold the grabbed fighter in front of the grabber. */
export const pinGrabbed = (world: World): void => {
  for (const f of world.fighters) {
    if (f.grabTarget < 0) continue;
    const target = world.fighters[f.grabTarget];
    if (!target || target.grabbedBy !== f.index) continue;
    target.x = f.x + f.facing * (f.def.halfWidth + target.def.halfWidth * 0.7 + 4);
    target.y = f.y;
    target.vx = 0;
    target.vy = 0;
    target.grounded = f.grounded;
    target.platform = f.platform;
    target.facing = (f.facing * -1) as 1 | -1;
  }
};

/* ----------------------------------------------------------- MELEE DETECTION */

interface ActiveCircle {
  f: Fighter;
  move: MoveDef;
  box: HitboxDef;
  x: number;
  y: number;
  r: number;
  clashed: boolean;
}

const circles: ActiveCircle[] = [];

const gatherCircles = (world: World): void => {
  circles.length = 0;
  for (const f of world.fighters) {
    if (!f.alive || f.hitlag > 0 || f.vanished) continue;
    if (
      f.state !== "attack" &&
      f.state !== "airAttack" &&
      f.state !== "special" &&
      f.state !== "airSpecial" &&
      f.state !== "ledgeAttack"
    ) {
      continue;
    }
    const move = currentMove(f);
    if (!move) continue;
    for (const box of move.hitboxes) {
      if (f.sf < box.from || f.sf > box.to) continue;
      if (box.groundOnly && !f.grounded) continue;
      if (box.airOnly && f.grounded) continue;
      const group = box.group ?? 0;
      if (f.hitLog.includes(-(group + 1))) continue;
      const samples = box.x2 !== undefined ? 3 : 1;
      for (let s = 0; s < samples; s += 1) {
        const t = samples === 1 ? 0 : s / (samples - 1);
        const bx = box.x + ((box.x2 ?? box.x) - box.x) * t;
        const by = box.y + ((box.y2 ?? box.y) - box.y) * t;
        circles.push({
          f,
          move,
          box,
          x: f.x + bx * f.facing,
          y: f.y + by,
          r: box.r,
          clashed: false,
        });
      }
    }
  }
};

const resolveClashes = (world: World): void => {
  for (let i = 0; i < circles.length; i += 1) {
    const a = circles[i];
    if (a.clashed || a.box.grab) continue;
    for (let j = i + 1; j < circles.length; j += 1) {
      const b = circles[j];
      if (b.clashed || b.box.grab || a.f === b.f) continue;
      if (a.f.team === b.f.team && !world.config.friendlyFire) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const reach = a.r + b.r;
      if (dx * dx + dy * dy > reach * reach) continue;
      const pa = a.box.priority ?? 5;
      const pb = b.box.priority ?? 5;
      const ga = a.box.group ?? 0;
      const gb = b.box.group ?? 0;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (Math.abs(pa - pb) < PRIORITY_CLANK) {
        addToken(a.f, -(ga + 1));
        addToken(b.f, -(gb + 1));
        a.f.hitlag = Math.max(a.f.hitlag, 7);
        b.f.hitlag = Math.max(b.f.hitlag, 7);
        a.clashed = true;
        b.clashed = true;
        emit(world, { type: "clash", a: a.f.index, b: b.f.index, x: mx, y: my });
      } else if (pa > pb) {
        addToken(b.f, -(gb + 1));
        b.clashed = true;
      } else {
        addToken(a.f, -(ga + 1));
        a.clashed = true;
      }
      if (a.clashed) break;
    }
  }
};

const nearestPointOnHurtbox = (
  t: Fighter,
  cx: number,
  cy: number,
  out: { x: number; y: number },
): void => {
  out.x = clamp(cx, t.x - t.def.halfWidth, t.x + t.def.halfWidth);
  out.y = clamp(cy, t.y - t.def.height, t.y);
};

const pointScratch = { x: 0, y: 0 };

/** Detect and resolve all melee hitboxes for this tick. */
export const resolveMelee = (world: World): void => {
  gatherCircles(world);
  if (circles.length === 0) return;
  resolveClashes(world);

  for (const c of circles) {
    if (c.clashed) continue;
    const attacker = c.f;
    const group = c.box.group ?? 0;
    for (const target of world.fighters) {
      if (target === attacker) continue;
      if (!isTargetable(target)) continue;
      if (target.team === attacker.team && !world.config.friendlyFire) continue;
      if (target.grabbedBy >= 0 && target.grabbedBy !== attacker.index) continue;
      const token = target.index * 8 + group;
      if (hasToken(attacker, token)) continue;
      if (
        !circleHitsRect(
          c.x,
          c.y,
          c.r,
          target.x - target.def.halfWidth,
          target.y - target.def.height,
          target.x + target.def.halfWidth,
          target.y,
        )
      ) {
        continue;
      }
      nearestPointOnHurtbox(target, c.x, c.y, pointScratch);

      if (c.box.grab) {
        if (startGrab(world, attacker, target)) {
          addToken(attacker, token);
          attacker.hitlag = 0;
        }
        break;
      }
      const outcome = applyHit(
        world,
        target,
        {
          damage: c.box.damage,
          angle: c.box.angle,
          baseKb: c.box.baseKb,
          growth: c.box.growth,
          hitlag: c.box.hitlag,
          stun: c.box.stun,
          fx: c.box.fx ?? "impact",
          sfx: c.box.sfx ?? "mid",
          shieldMul: c.box.shieldMul,
        },
        {
          attacker: attacker.index,
          moveId: c.move.id,
          dirSign: attacker.facing,
          x: pointScratch.x,
          y: pointScratch.y,
          dmgMul: attacker.chargeMul,
          kbMul: 1 + (attacker.chargeMul - 1) * 0.75,
          attackerLag: true,
        },
      );
      if (outcome !== "none") addToken(attacker, token);
    }
  }
};
