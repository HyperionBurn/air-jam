import { ITEM_THROW } from "../data/items";
import {
  AIR_DODGE_FRAMES,
  AIR_DODGE_INVULN,
  BOUNCE_SPEED,
  DIR_THRESHOLD,
  DOWN_HOLD_DROP,
  FASTFALL_THRESHOLD,
  JUMP_CUT_WINDOW,
  KB_DECEL_X,
  KB_GRAVITY_MUL,
  LEDGE_ATTACK_FRAMES,
  LEDGE_CLIMB_FRAMES,
  LEDGE_COOLDOWN,
  LEDGE_HANG_MAX,
  LEDGE_ROLL_FRAMES,
  PUMMEL_COOLDOWN,
  PUMMEL_DAMAGE,
  RESPAWN_DELAY,
  RESPAWN_HOLD_MAX,
  RESPAWN_INVULN,
  ROLL_FRAMES,
  ROLL_INVULN,
  RUN_THRESHOLD,
  SHIELD_BREAK_FRAMES,
  SHIELD_DRAIN,
  SHIELD_REGEN,
  SHIELD_REGEN_DELAY,
  SHIELD_RESET_AFTER_BREAK,
  SPOT_DODGE_FRAMES,
  SPOT_DODGE_INVULN,
  SURGE_SPEED_MUL,
} from "./constants";
import { applyHit, breakShield } from "./combat";
import {
  clearBuffers,
  consumeAttack,
  consumeJump,
  consumeShield,
  consumeSpecial,
  flickedDown,
  flickedUp,
  flickedX,
  isHeld,
  readInput,
  stickDir,
  wasReleased,
} from "./input";
import {
  becomeAirborne,
  currentMove,
  emit,
  faceToward,
  releaseGrabLink,
  releaseLedge,
  resolveMove,
  setState,
} from "./ops";
import { moveFighter, snapToLedge, stickToGround, tryLedgeGrab } from "./physics";
import { spawnProjectile } from "./projectiles";
import { ledgePoint } from "./stage";
import { BTN, type Fighter, type InputFrame, type MoveDef, type World } from "./types";
import { approach, clamp, sign } from "./util";

/* ------------------------------------------------------------------ HELPERS */

const speedMul = (f: Fighter): number => (f.buffSpeed > 0 ? SURGE_SPEED_MUL : 1);

const landNormally = (world: World, f: Fighter, lag: number, hard = false): void => {
  f.grounded = true;
  f.fastFall = false;
  f.helpless = false;
  f.jumpsLeft = f.def.airJumps;
  f.airDodgeUsed = false;
  f.jumpCut = false;
  f.ledgeGrabs = 0;
  f.landLock = lag;
  f.vx *= 0.6;
  f.vy = 0;
  f.moveId = null;
  setState(f, "land");
  emit(world, { type: "land", who: f.index, x: f.x, y: f.y, hard });
};

/** Begin a move by id (resolving the air variant when airborne). */
export const startMove = (world: World, f: Fighter, id: string, keepMomentum = false): boolean => {
  const airborne = !f.grounded;
  const move = id === ITEM_THROW.id ? ITEM_THROW : resolveMove(f, id, airborne);
  if (!move) return false;
  f.moveId = move.id;
  f.sf = 0;
  f.hitLog.length = 0;
  f.chargeFrames = 0;
  f.chargeMul = 1;
  if (airborne) f.jumpCut = true;
  if (move.kind === "special") f.state = airborne ? "airSpecial" : "special";
  else if (move.kind === "ledge") f.state = "ledgeAttack";
  else if (move.kind === "grab") f.state = "attack";
  else f.state = airborne ? "airAttack" : "attack";
  if (!keepMomentum && !airborne) f.vx *= 0.35;
  emit(world, {
    type: move.kind === "special" ? "special" : "attack",
    who: f.index,
    moveId: move.id,
    x: f.x,
    y: f.y,
  });
  return true;
};

const enterAirborne = (f: Fighter): void => {
  becomeAirborne(f);
  setState(f, "airborne");
};

const startJumpsquat = (f: Fighter): void => {
  setState(f, "jumpsquat");
  f.jumpCut = false;
};

const startShield = (f: Fighter): void => {
  setState(f, "shield");
  f.vx *= 0.5;
};

const trySelectGroundMove = (f: Fighter): string => {
  const dir = stickDir(f);
  const running = f.state === "run" && Math.abs(f.vx) > f.def.runSpeed * 0.7;
  if (dir.axis === "y") {
    if (dir.y < 0) return flickedUp(f) ? "usmash" : "utilt";
    return flickedDown(f) ? "dsmash" : "dtilt";
  }
  if (dir.axis === "x") {
    faceToward(f, dir.x);
    if (running && dir.x === sign(f.vx)) return flickedX(f, dir.x) ? "fsmash" : "dashAttack";
    return flickedX(f, dir.x) ? "fsmash" : "ftilt";
  }
  if (running) return "dashAttack";
  return "jab1";
};

const selectAerialMove = (f: Fighter): string => {
  const dir = stickDir(f);
  if (dir.axis === "y") return dir.y < 0 ? "uair" : "dair";
  if (dir.axis === "x") return dir.x === f.facing ? "fair" : "bair";
  return "nair";
};

const selectSpecialMove = (f: Fighter): string => {
  const dir = stickDir(f);
  if (dir.axis === "y") return dir.y < 0 ? "uspecial" : "dspecial";
  if (dir.axis === "x") {
    faceToward(f, dir.x);
    return "sspecial";
  }
  return "nspecial";
};

/* ------------------------------------------------------------ GROUND ACTIONS */

/** Common actionable-ground decisions. Returns true if the state changed. */
const tryGroundActions = (world: World, f: Fighter): boolean => {
  if (f.held & BTN.SHIELD && f.bAttack > 0) {
    consumeAttack(f);
    startMove(world, f, "grab");
    return true;
  }
  if (consumeJump(f)) {
    startJumpsquat(f);
    return true;
  }
  if (!(f.held & BTN.SHIELD) && f.bAttack > 0) {
    consumeAttack(f);
    if (f.heldItem === "chaosBomb") {
      f.heldItem = null;
      startMove(world, f, ITEM_THROW.id);
      return true;
    }
    startMove(world, f, trySelectGroundMove(f));
    return true;
  }
  if (consumeSpecial(f)) {
    startMove(world, f, selectSpecialMove(f));
    return true;
  }
  if (f.held & BTN.SHIELD) {
    consumeShield(f);
    startShield(f);
    return true;
  }
  if (f.downHeldFrames === DOWN_HOLD_DROP && f.platform >= 0) {
    // Drop through soft platforms with a held-down stick.
    const support = world.platforms[f.platform];
    if (!support.def.solid) {
      f.dropThrough = 14;
      enterAirborne(f);
      f.vy = 2;
      return true;
    }
  }
  return false;
};

/** Ground locomotion shared by idle/walk/run/turn/land. */
const groundLocomotion = (world: World, f: Fighter, allowMove: boolean): void => {
  const def = f.def;
  const mul = speedMul(f);
  const maxWalk = def.walkSpeed * mul;
  const maxRun = def.runSpeed * mul;
  const mag = Math.abs(f.stickX);
  if (allowMove && mag > 0) {
    const desired =
      sign(f.stickX) * (mag < RUN_THRESHOLD ? maxWalk * (mag / RUN_THRESHOLD) : maxRun);
    const speeding = Math.abs(desired) > Math.abs(f.vx) && sign(desired) === sign(f.vx || desired);
    f.vx = approach(f.vx, desired, speeding ? def.groundAccel : def.traction * 1.4);
  } else {
    f.vx = approach(f.vx, 0, def.traction);
  }
  f.x += 0; // (movement applied in physics step)
  void world;
};

/** Choose idle/walk/run label from velocity + stick. */
const labelGroundState = (world: World, f: Fighter): void => {
  const maxWalk = f.def.walkSpeed * speedMul(f);
  const speed = Math.abs(f.vx);
  const wantsRun = Math.abs(f.stickX) >= RUN_THRESHOLD;
  if (speed < 0.35 && f.stickX === 0) {
    if (f.state !== "idle") setState(f, "idle");
    return;
  }
  const next = speed > maxWalk * 1.12 && wantsRun ? "run" : "walk";
  if (f.state !== next) {
    if (next === "run" && f.state !== "run" && speed < maxWalk * 1.4) {
      emit(world, { type: "dash", who: f.index, x: f.x, y: f.y, dir: sign(f.vx) });
    }
    setState(f, next);
  }
};

const physicsGround = (world: World, f: Fighter): void => {
  f.vy = 0;
  moveFighter(world, f);
  if (!stickToGround(world, f)) {
    // Walked off the edge.
    if (f.state === "idle" || f.state === "walk" || f.state === "run" || f.state === "turn" || f.state === "land") {
      setState(f, "airborne");
    }
  }
};

/* ------------------------------------------------------------------- AIR */

const airControl = (f: Fighter, driftScale: number): void => {
  const def = f.def;
  const maxAir = def.airSpeed * speedMul(f);
  const target = f.stickX * maxAir;
  if (Math.abs(f.stickX) > 0.05) {
    if (Math.sign(target) !== Math.sign(f.vx) || Math.abs(f.vx) < Math.abs(target)) {
      f.vx = approach(f.vx, target, def.airAccel * driftScale);
    } else if (Math.abs(f.vx) > Math.abs(target)) {
      f.vx = approach(f.vx, target, def.airFriction * 2 * driftScale);
    }
  } else {
    f.vx = approach(f.vx, 0, def.airFriction * 0.9 * driftScale);
  }
};

const applyGravity = (f: Fighter, scale = 1): void => {
  const def = f.def;
  if (f.fastFall && scale >= 1) {
    f.vy = def.fastFallSpeed;
    return;
  }
  f.vy = Math.min(def.fallSpeed, f.vy + def.gravity * scale);
};

const physicsAir = (world: World, f: Fighter, onLand: (hard: boolean) => void, grabLedges = true): void => {
  const vyBefore = f.vy;
  const result = moveFighter(world, f);
  if (result.landed) {
    onLand(vyBefore > 11);
    return;
  }
  if (grabLedges && f.vy >= -2) tryLedgeGrab(world, f);
};

const handleAirActions = (world: World, f: Fighter): boolean => {
  if (f.helpless) return false;
  // Aerials / specials take priority so they feel instant out of a jump.
  if (consumeAttack(f)) {
    if (f.heldItem === "chaosBomb") {
      f.heldItem = null;
      startMove(world, f, ITEM_THROW.id, true);
      return true;
    }
    startMove(world, f, selectAerialMove(f), true);
    return true;
  }
  if (consumeSpecial(f)) {
    startMove(world, f, selectSpecialMove(f), true);
    return true;
  }
  if (consumeJump(f)) {
    if (f.jumpsLeft > 0) {
      f.jumpsLeft -= 1;
      f.vy = f.def.doubleJumpVel;
      f.vx = f.vx * 0.35 + f.stickX * f.def.airSpeed * 0.55;
      f.fastFall = false;
      f.jumpCut = false;
      emit(world, { type: "jump", who: f.index, x: f.x, y: f.y, air: true });
    } else {
      // Keep the press buffered so a landing jump still feels right.
      f.bJump = 3;
    }
  }
  if (consumeShield(f) && !f.airDodgeUsed) {
    f.airDodgeUsed = true;
    setState(f, "airDodge");
    f.invuln = Math.max(f.invuln, AIR_DODGE_INVULN[1] - AIR_DODGE_INVULN[0]);
    const mag = Math.hypot(f.stickX, f.stickY);
    const speed = f.def.airDodgeSpeed;
    f.vx = mag > 0.2 ? (f.stickX / mag) * speed : 0;
    f.vy = mag > 0.2 ? (f.stickY / mag) * speed : 0;
    emit(world, { type: "dodge", who: f.index, x: f.x, y: f.y - f.def.height / 2, air: true });
    return true;
  }
  return false;
};

/* ------------------------------------------------------------- STATE UPDATES */

type Handler = (world: World, f: Fighter) => void;

const updateIdleLike: Handler = (world, f) => {
  if (f.state === "turn") {
    f.sf += 1;
    f.vx = approach(f.vx, 0, f.def.traction * 2.4);
    if (f.sf === 1) faceToward(f, f.turnDir);
    if (tryGroundActions(world, f)) {
      physicsGround(world, f);
      return;
    }
    if (f.sf >= 8) setState(f, "idle");
    physicsGround(world, f);
    return;
  }

  f.sf += 1;
  if (tryGroundActions(world, f)) {
    // Preserve momentum into the new state; physics runs inside it next tick.
    physicsGround(world, f);
    return;
  }

  const dirX = Math.abs(f.stickX) >= DIR_THRESHOLD * 0.8 ? sign(f.stickX) : 0;
  // Running skid when reversing at speed.
  if (
    f.state === "run" &&
    dirX !== 0 &&
    dirX !== sign(f.vx) &&
    Math.abs(f.vx) > f.def.walkSpeed * 1.3 &&
    Math.abs(f.stickX) >= RUN_THRESHOLD
  ) {
    setState(f, "turn");
    f.turnDir = dirX as 1 | -1;
    physicsGround(world, f);
    return;
  }
  if (dirX !== 0 && f.state !== "run") faceToward(f, dirX);
  else if (dirX !== 0 && dirX === sign(f.vx)) faceToward(f, dirX);

  groundLocomotion(world, f, true);
  physicsGround(world, f);
  if (f.grounded) labelGroundState(world, f);
};

const updateLand: Handler = (world, f) => {
  f.sf += 1;
  f.vx = approach(f.vx, 0, f.def.traction * 1.2);
  if (f.landLock <= 5 && f.sf >= 1) {
    if (tryGroundActions(world, f)) {
      physicsGround(world, f);
      return;
    }
  }
  if (f.sf >= f.landLock) setState(f, "idle");
  physicsGround(world, f);
};

const updateJumpsquat: Handler = (world, f) => {
  f.sf += 1;
  f.vx = approach(f.vx, 0, f.def.traction * 0.4);
  if (f.sf >= f.def.jumpsquat) {
    const shortHop = !(f.held & BTN.JUMP);
    f.vy = shortHop ? f.def.shortHopVel : f.def.jumpVel;
    f.vx = f.vx * 0.85 + f.stickX * f.def.airSpeed * 0.3;
    f.jumpCut = shortHop;
    becomeAirborne(f);
    setState(f, "airborne");
    emit(world, { type: "jump", who: f.index, x: f.x, y: f.y, air: false });
    // Move off the ground this very frame so the jump never feels delayed.
    moveFighter(world, f);
    return;
  }
  physicsGround(world, f);
};

const updateAirborne: Handler = (world, f) => {
  f.sf += 1;
  if (f.helpless) {
    airControl(f, 0.55);
  } else {
    airControl(f, 1);
    if (!f.jumpCut && f.sf <= JUMP_CUT_WINDOW && wasReleased(f, BTN.JUMP) && f.vy < -4.5) {
      f.vy *= 0.5;
      f.jumpCut = true;
    }
    if (!f.fastFall && f.vy > 0.5 && f.stickY >= FASTFALL_THRESHOLD) f.fastFall = true;
    if (f.stickY < 0.3 && f.vy < 0) f.fastFall = false;
    if (handleAirActions(world, f)) return;
  }
  applyGravity(f);
  physicsAir(world, f, (hard) => landNormally(world, f, f.helpless ? 12 : f.def.landLag, hard));
};

const updateAirDodge: Handler = (world, f) => {
  f.sf += 1;
  f.vx *= 0.9;
  f.vy *= 0.9;
  if (f.sf === AIR_DODGE_INVULN[0]) f.invuln = Math.max(f.invuln, AIR_DODGE_INVULN[1] - AIR_DODGE_INVULN[0]);
  const vyBefore = f.vy;
  const result = moveFighter(world, f);
  if (result.landed) {
    landNormally(world, f, 4, vyBefore > 11);
    return;
  }
  if (f.sf >= AIR_DODGE_FRAMES) setState(f, "airborne");
};

/* ----------------------------------------------------------------- MOVES */

const stepMove: Handler = (world, f) => {
  const move = currentMove(f);
  if (!move) {
    f.moveId = null;
    if (f.grounded) setState(f, "idle");
    else enterAirborne(f);
    return;
  }
  const frame = f.sf;

  // Charging smashes: hold on the charge frame while attack stays down.
  if (move.charge && frame === move.charge.at && f.grounded) {
    if (isHeld(f, BTN.ATTACK) && f.chargeFrames < move.charge.max) {
      f.chargeFrames += 1;
      f.chargeMul = 1 + ((move.charge.damageMul - 1) * f.chargeFrames) / move.charge.max;
      f.vx = approach(f.vx, 0, f.def.traction);
      physicsGround(world, f);
      return;
    }
  }

  let motionActive = false;
  if (move.motion) {
    for (const key of move.motion) {
      const hold = key.hold ?? 1;
      if (frame >= key.at && frame < key.at + hold) {
        const progress = hold > 1 ? (frame - key.at) / hold : 0;
        if (key.vx !== undefined) {
          const vx = key.vx * f.facing * speedMul(f);
          f.vx = key.mode === "add" ? f.vx + vx : vx;
          motionActive = true;
        }
        if (key.vy !== undefined) {
          const vy = key.vy * (1 - 0.45 * progress);
          f.vy = key.mode === "add" ? f.vy + vy : vy;
          if (f.grounded && key.vy < 0) becomeAirborne(f);
          motionActive = true;
        }
      }
    }
  }

  if (move.invuln && frame === move.invuln[0]) {
    f.invuln = Math.max(f.invuln, move.invuln[1] - move.invuln[0]);
  }

  if (move.spawns) {
    for (const s of move.spawns) {
      if (s.at !== frame) continue;
      let vx = s.vx * f.facing;
      let vy = s.vy;
      if (s.aim && Math.hypot(f.stickX, f.stickY) > 0.4) {
        const speed = Math.hypot(s.vx, s.vy);
        const mag = Math.hypot(f.stickX, f.stickY);
        vx = (f.stickX / mag) * speed;
        vy = (f.stickY / mag) * speed;
      }
      spawnProjectile(world, f, s.projectile, f.x + s.x * f.facing, f.y + s.y, vx, vy);
    }
  }

  if (move.teleport) stepTeleport(world, f, move);

  // Steering.
  if (move.steer) {
    const win = move.steerWindow;
    if (!win || (frame >= win[0] && frame <= win[1])) {
      f.vx = clamp(f.vx + f.stickX * move.steer, -10, 10);
    }
  }

  const vanished = f.vanished;
  if (!f.grounded) {
    // Air physics inside the move.
    if (!motionActive || move.motion?.every((k) => k.vy === undefined)) {
      if (move.gravity !== 0) applyGravity(f, (move.gravity ?? 1) * (f.fastFall ? 0 : 1));
    }
    if (!motionActive) airControl(f, move.drift ?? 1);
  } else if (!motionActive) {
    f.vx = approach(f.vx, 0, f.def.traction * 0.8);
  }

  f.sf += 1;

  // Chains (jab combos).
  if (move.chain && frame >= move.chain.from && frame <= move.chain.until && f.bAttack > 0) {
    consumeAttack(f);
    const dir = stickDir(f);
    if (dir.axis === "x") faceToward(f, dir.x);
    startMove(world, f, move.chain.to, true);
    if (f.grounded) physicsGround(world, f);
    return;
  }

  if (vanished) {
    if (f.sf >= move.total) endMove(world, f, move);
    return;
  }

  // Physics.
  if (f.grounded) {
    physicsGround(world, f);
    if (!f.grounded) {
      // Slid off the edge mid-move: continue the move in the air.
      f.state = move.kind === "special" ? "airSpecial" : f.state === "attack" ? "airAttack" : f.state;
    }
  } else {
    const vyBefore = f.vy;
    const result = moveFighter(world, f);
    if (result.landed) {
      const remaining = move.total - f.sf;
      let lag = move.landingLag ?? (move.kind === "special" ? 10 : f.def.landLag + 3);
      // Auto-cancel: landing very early or very late is a normal landing.
      if (f.sf <= 3 || remaining <= 8) lag = f.def.landLag;
      if (move.helpless || f.helpless) lag = Math.max(lag, 14);
      landNormally(world, f, lag, vyBefore > 11);
      return;
    }
    if (!move.helpless || f.vy >= -2) tryLedgeGrab(world, f);
    if (f.state === "ledgeHang") return;
  }

  if (f.sf >= move.total) endMove(world, f, move);
};

const endMove = (world: World, f: Fighter, move: MoveDef): void => {
  void world;
  f.moveId = null;
  f.chargeMul = 1;
  f.chargeFrames = 0;
  f.vanished = false;
  if (move.helpless && !f.grounded) f.helpless = true;
  if (f.grounded) setState(f, "idle");
  else setState(f, "airborne");
};

const stepTeleport = (world: World, f: Fighter, move: MoveDef): void => {
  const tp = move.teleport!;
  if (f.sf === tp.vanishAt) {
    f.vanished = true;
    f.vx = 0;
    f.vy = 0;
    const mag = Math.hypot(f.stickX, f.stickY);
    let dx = 0;
    let dy = -1;
    if (tp.dir === "forward") {
      dx = f.facing;
      dy = 0;
    } else if (tp.dir === "stick" && mag > 0.35) {
      dx = f.stickX / mag;
      dy = f.stickY / mag;
    }
    const b = world.stage.blast;
    f.teleportTx = clamp(f.x + dx * tp.dist, b.left + 80, b.right - 80);
    f.teleportTy = clamp(f.y + dy * tp.dist, b.top + 80, b.bottom - 120);
    becomeAirborne(f);
    emit(world, { type: "teleport", who: f.index, x: f.x, y: f.y - f.def.height / 2, appear: false });
  }
  if (f.vanished) {
    f.vx = 0;
    f.vy = 0;
    if (f.sf >= tp.appearAt - 1) {
      f.vanished = false;
      f.x = f.teleportTx;
      f.y = f.teleportTy;
      f.px = f.x;
      f.py = f.y;
      // Never reappear inside solid ground.
      for (let i = 0; i < world.platforms.length; i += 1) {
        const p = world.platforms[i];
        if (!p.def.solid) continue;
        if (f.x > p.x - f.def.halfWidth && f.x < p.x + p.def.w + f.def.halfWidth && f.y > p.y + 1 && f.y - f.def.height < p.y + p.def.h) {
          f.y = p.y;
        }
      }
      emit(world, { type: "teleport", who: f.index, x: f.x, y: f.y - f.def.height / 2, appear: true });
    }
  }
};

/* ----------------------------------------------------------------- SHIELD */

const updateShield: Handler = (world, f) => {
  f.sf += 1;
  f.vx = approach(f.vx, 0, f.def.traction * 1.5);
  f.shield -= SHIELD_DRAIN;
  f.shieldRegenDelay = SHIELD_REGEN_DELAY;
  if (f.shield <= 0) {
    f.shield = 0;
    breakShield(world, f);
    return;
  }
  if (f.bAttack > 0) {
    consumeAttack(f);
    startMove(world, f, "grab");
    physicsGround(world, f);
    return;
  }
  if (consumeJump(f)) {
    startJumpsquat(f);
    physicsGround(world, f);
    return;
  }
  if (f.sf > 2 && flickedDown(f)) {
    setState(f, "spotDodge");
    emit(world, { type: "dodge", who: f.index, x: f.x, y: f.y - f.def.height / 2, air: false });
    physicsGround(world, f);
    return;
  }
  if (f.sf > 2 && f.flickXAge <= 3 && f.flickXDir !== 0) {
    setState(f, "roll");
    f.roll = f.flickXDir;
    emit(world, { type: "dodge", who: f.index, x: f.x, y: f.y - f.def.height / 2, air: false });
    physicsGround(world, f);
    return;
  }
  if (!(f.held & BTN.SHIELD)) {
    setState(f, "idle");
  }
  physicsGround(world, f);
};

const updateShieldStun: Handler = (world, f) => {
  f.sf += 1;
  f.vx = approach(f.vx, 0, f.def.traction);
  f.hitstun -= 1;
  if (f.hitstun <= 0) {
    if (f.held & BTN.SHIELD) startShield(f);
    else setState(f, "idle");
  }
  physicsGround(world, f);
};

const updateShieldBreak: Handler = (world, f) => {
  f.sf += 1;
  f.hitstun -= 1;
  if (!f.grounded) {
    f.vy = Math.min(f.def.fallSpeed, f.vy + f.def.gravity);
    const result = moveFighter(world, f);
    if (result.landed) f.vx = 0;
  } else {
    f.vx = approach(f.vx, 0, f.def.traction);
    physicsGround(world, f);
  }
  if (f.hitstun <= 0) {
    f.shield = SHIELD_RESET_AFTER_BREAK;
    if (f.grounded) setState(f, "idle");
    else enterAirborne(f);
  }
  void SHIELD_BREAK_FRAMES;
};

const updateRoll: Handler = (world, f) => {
  f.sf += 1;
  const t = clamp(f.sf / ROLL_FRAMES, 0, 1);
  f.vx = f.roll * f.def.rollSpeed * Math.sin(Math.PI * t) * 1.15;
  if (f.sf === ROLL_INVULN[0]) f.invuln = Math.max(f.invuln, ROLL_INVULN[1] - ROLL_INVULN[0]);
  physicsGround(world, f);
  if (f.sf >= ROLL_FRAMES) {
    f.vx = 0;
    setState(f, "idle");
  }
};

const updateSpotDodge: Handler = (world, f) => {
  f.sf += 1;
  f.vx = approach(f.vx, 0, 2);
  if (f.sf === SPOT_DODGE_INVULN[0]) f.invuln = Math.max(f.invuln, SPOT_DODGE_INVULN[1] - SPOT_DODGE_INVULN[0]);
  physicsGround(world, f);
  if (f.sf >= SPOT_DODGE_FRAMES) setState(f, "idle");
};

/* ----------------------------------------------------------------- HITSTUN */

const updateHitstun: Handler = (world, f) => {
  f.sf += 1;
  f.hitstun -= 1;
  const vxBefore = f.vx;
  const vyBefore = f.vy;
  if (f.grounded) {
    f.vx = approach(f.vx, 0, f.def.traction * 1.3);
    physicsGround(world, f);
  } else {
    f.vx = approach(f.vx, 0, KB_DECEL_X);
    f.vy = Math.min(f.def.fallSpeed * 1.5, f.vy + f.def.gravity * KB_GRAVITY_MUL);
    const result = moveFighter(world, f);
    if (result.hitWall && Math.abs(vxBefore) > 9) f.vx = -vxBefore * 0.45;
    if (result.landed) {
      if (!f.bounced && vyBefore > BOUNCE_SPEED * 0.7 && f.hitstun > 4) {
        f.bounced = true;
        f.grounded = false;
        f.platform = -1;
        f.vy = -vyBefore * 0.5;
        f.y -= 1;
        emit(world, { type: "land", who: f.index, x: f.x, y: f.y, hard: true });
      } else {
        f.vx *= 0.5;
        emit(world, { type: "land", who: f.index, x: f.x, y: f.y, hard: vyBefore > 11 });
      }
    }
  }
  if (f.hitstun <= 0) {
    f.tumble = false;
    if (f.grounded) setState(f, "idle");
    else enterAirborne(f);
  }
};

/* ------------------------------------------------------------------- GRABS */

const updateGrabbing: Handler = (world, f) => {
  f.sf += 1;
  f.vx = approach(f.vx, 0, f.def.traction);
  const target = f.grabTarget >= 0 ? world.fighters[f.grabTarget] : null;
  if (!target || target.grabbedBy !== f.index || target.state !== "grabbed") {
    f.grabTarget = -1;
    setState(f, "idle");
    return;
  }
  f.grabTimer -= 1;
  if (f.pummelCd > 0) f.pummelCd -= 1;
  if (f.grabTimer <= 0) {
    // Escape: shove apart.
    target.vx = -f.facing * 3;
    releaseGrabLink(world, f);
    f.hitlag = 0;
    setState(f, "idle");
    f.vx = f.facing * -1.5;
    physicsGround(world, f);
    return;
  }
  const dir = stickDir(f);
  if (f.sf > 8 && Math.hypot(f.stickX, f.stickY) >= 0.72 && dir.axis) {
    const id =
      dir.axis === "y"
        ? dir.y < 0
          ? "throwU"
          : "throwD"
        : dir.x === f.facing
          ? "throwF"
          : "throwB";
    f.moveId = id;
    setState(f, "throw");
    return;
  }
  if (consumeAttack(f) && f.pummelCd === 0) {
    f.pummelCd = PUMMEL_COOLDOWN;
    target.percent += PUMMEL_DAMAGE;
    world.stats[f.index].damageDealt += PUMMEL_DAMAGE;
    world.stats[target.index].damageTaken += PUMMEL_DAMAGE;
    f.hitlag = 3;
    emit(world, {
      type: "hit",
      attacker: f.index,
      victim: target.index,
      x: target.x,
      y: target.y - target.def.height * 0.6,
      damage: PUMMEL_DAMAGE,
      kb: 0,
      angle: 0,
      dx: 0,
      dy: 0,
      moveId: "pummel",
      fx: "impact",
      sfx: "light",
      lag: 3,
      killing: false,
    });
  }
  physicsGround(world, f);
};

const updateGrabbed: Handler = (world, f) => {
  f.sf += 1;
  const grabber = f.grabbedBy >= 0 ? world.fighters[f.grabbedBy] : null;
  if (!grabber || grabber.grabTarget !== f.index) {
    f.grabbedBy = -1;
    setState(f, f.grounded ? "idle" : "airborne");
    return;
  }
  // Mash buttons / flick the stick to break free faster.
  if (f.tapped !== 0 || f.flickXAge === 0 || f.flickUpAge === 0 || f.flickDownAge === 0) {
    grabber.grabTimer -= 6;
  }
};

const updateThrow: Handler = (world, f) => {
  const move = currentMove(f);
  const target = f.grabTarget >= 0 ? world.fighters[f.grabTarget] : null;
  f.sf += 1;
  if (!move) {
    setState(f, "idle");
    return;
  }
  if (move.releaseAt !== undefined && f.sf === move.releaseAt && target && target.grabbedBy === f.index) {
    const box = move.hitboxes[0];
    if (move.id === "throwB") faceToward(f, -f.facing);
    target.grabbedBy = -1;
    f.grabTarget = -1;
    // Place the victim in the direction of the throw before launching.
    target.x = f.x + f.facing * (f.def.halfWidth + target.def.halfWidth);
    target.state = "airborne";
    const dirSign = (move.id === "throwB" ? -f.facing : f.facing) as 1 | -1;
    emit(world, { type: "throw", attacker: f.index, victim: target.index, x: target.x, y: target.y - 50 });
    applyHit(
      world,
      target,
      {
        damage: box.damage,
        angle: box.angle,
        baseKb: box.baseKb,
        growth: box.growth,
        hitlag: box.hitlag,
        stun: box.stun,
        fx: box.fx ?? "impact",
        sfx: box.sfx ?? "heavy",
      },
      {
        attacker: f.index,
        moveId: move.id,
        dirSign,
        x: target.x,
        y: target.y - target.def.height / 2,
        attackerLag: true,
      },
    );
  }
  f.vx = approach(f.vx, 0, f.def.traction);
  physicsGround(world, f);
  if (f.sf >= move.total) {
    f.moveId = null;
    setState(f, "idle");
  }
};

/* ------------------------------------------------------------------ LEDGES */

const updateLedgeHang: Handler = (world, f) => {
  f.hang += 1;
  f.sf += 1;
  snapToLedge(world, f);
  const ledge = world.ledges[f.ledge];
  if (!ledge) {
    enterAirborne(f);
    return;
  }
  const toward = -ledge.side;
  if (f.hang < 6) return;
  const dropOut = () => {
    releaseLedge(world, f);
    f.ledgeCooldown = LEDGE_COOLDOWN;
    enterAirborne(f);
    f.vx = ledge.side * 1.2;
    f.vy = 0;
  };
  if (consumeJump(f)) {
    releaseLedge(world, f);
    f.ledgeCooldown = LEDGE_COOLDOWN;
    becomeAirborne(f);
    setState(f, "airborne");
    f.vy = f.def.jumpVel * 0.95;
    f.vx = toward * 3.2;
    f.jumpCut = false;
    emit(world, { type: "jump", who: f.index, x: f.x, y: f.y, air: false });
    return;
  }
  if (consumeAttack(f)) {
    startLedgeMove(world, f, "attack", toward);
    return;
  }
  if (consumeShield(f)) {
    startLedgeMove(world, f, "roll", toward);
    return;
  }
  if (f.stickY <= -0.6 || (Math.sign(f.stickX) === toward && Math.abs(f.stickX) >= 0.6)) {
    startLedgeMove(world, f, "climb", toward);
    return;
  }
  if (f.stickY >= 0.7 || (Math.sign(f.stickX) === -toward && Math.abs(f.stickX) >= 0.7) || f.hang >= LEDGE_HANG_MAX) {
    dropOut();
  }
};

const startLedgeMove = (world: World, f: Fighter, kind: "attack" | "roll" | "climb", toward: number): void => {
  const ledge = world.ledges[f.ledge];
  const point = ledgePoint(world, ledge);
  f.teleportTx = f.x;
  f.teleportTy = f.y;
  f.roll = toward;
  if (kind === "climb") setState(f, "ledgeClimb");
  else if (kind === "roll") setState(f, "ledgeRoll");
  else {
    f.moveId = "ledgeAttack";
    f.hitLog.length = 0;
    setState(f, "ledgeAttack");
  }
  f.invuln = Math.max(f.invuln, 24);
  f.facing = toward as 1 | -1;
  // Remember the platform surface for the landing spot.
  f.platform = ledge.platform;
  void point;
};

const finishLedgeMove = (world: World, f: Fighter, distance: number): void => {
  const ledge = world.ledges[f.ledge];
  if (!ledge) {
    enterAirborne(f);
    return;
  }
  const point = ledgePoint(world, ledge);
  const plat = world.platforms[ledge.platform];
  releaseLedge(world, f);
  f.x = point.x + f.roll * distance;
  f.y = plat.y;
  f.px = f.x;
  f.py = f.y;
  f.vx = 0;
  f.vy = 0;
  f.grounded = true;
  f.platform = ledge.platform;
  f.ledgeCooldown = LEDGE_COOLDOWN;
  setState(f, "idle");
};

const updateLedgeScripted: Handler = (world, f) => {
  f.sf += 1;
  const ledge = world.ledges[f.ledge];
  if (!ledge) {
    enterAirborne(f);
    return;
  }
  const point = ledgePoint(world, ledge);
  if (f.state === "ledgeClimb") {
    const t = clamp(f.sf / LEDGE_CLIMB_FRAMES, 0, 1);
    const goalX = point.x + f.roll * (f.def.halfWidth + 10);
    const goalY = point.y;
    // Up first, then over.
    const up = clamp(t * 1.6, 0, 1);
    const over = clamp((t - 0.45) / 0.55, 0, 1);
    f.x = f.teleportTx + (goalX - f.teleportTx) * over;
    f.y = f.teleportTy + (goalY - f.teleportTy) * up;
    if (f.sf >= LEDGE_CLIMB_FRAMES) finishLedgeMove(world, f, f.def.halfWidth + 10);
  } else if (f.state === "ledgeRoll") {
    const t = clamp(f.sf / LEDGE_ROLL_FRAMES, 0, 1);
    const goalX = point.x + f.roll * 150;
    f.x = f.teleportTx + (goalX - f.teleportTx) * t;
    f.y = f.teleportTy + (point.y - f.teleportTy) * clamp(t * 2, 0, 1);
    if (f.sf >= LEDGE_ROLL_FRAMES) finishLedgeMove(world, f, 150);
  }
};

const updateLedgeAttack: Handler = (world, f) => {
  const move = currentMove(f);
  if (!move) {
    finishLedgeMove(world, f, f.def.halfWidth + 40);
    return;
  }
  // The attack carries the fighter up onto the stage.
  if (f.sf === 1) {
    const ledge = world.ledges[f.ledge];
    if (ledge) {
      const point = ledgePoint(world, ledge);
      const plat = world.platforms[ledge.platform];
      releaseLedge(world, f);
      f.x = point.x + f.roll * (f.def.halfWidth + 24);
      f.y = plat.y;
      f.px = f.x;
      f.py = f.y;
      f.grounded = true;
      f.platform = ledge.platform;
    }
  }
  stepMove(world, f);
  if (f.state === "idle") f.ledgeCooldown = LEDGE_COOLDOWN;
  void LEDGE_ATTACK_FRAMES;
};

/* ----------------------------------------------------------------- RESPAWN */

const updateRespawn: Handler = (world, f) => {
  f.sf += 1;
  const halo = world.stage.respawn;
  const spread = (f.slot - 3.5) * 36;
  f.vx = 0;
  f.vy = 0;
  f.x = halo.x + spread;
  f.y = halo.y;
  if (f.sf < RESPAWN_DELAY) {
    f.vanished = true;
    f.invuln = 999;
    return;
  }
  if (f.sf === RESPAWN_DELAY) {
    f.vanished = false;
    f.px = f.x;
    f.py = f.y;
    f.spawnFrame = world.frame;
    emit(world, { type: "respawn", who: f.index, x: f.x, y: f.y });
  }
  f.invuln = 999;
  const leave =
    f.sf >= RESPAWN_DELAY + RESPAWN_HOLD_MAX ||
    (f.sf >= RESPAWN_DELAY + 24 &&
      (f.tapped !== 0 || Math.abs(f.stickX) > 0.6 || f.stickY > 0.6));
  if (leave) {
    f.invuln = RESPAWN_INVULN;
    f.vx = f.stickX * 2;
    f.vy = 0;
    f.jumpsLeft = f.def.airJumps;
    setState(f, "airborne");
    clearBuffers(f);
  }
};

const updateVictory: Handler = (world, f) => {
  f.sf += 1;
  f.vx = approach(f.vx, 0, f.def.traction);
  if (f.grounded) physicsGround(world, f);
  else {
    applyGravity(f);
    physicsAir(world, f, () => landNormally(world, f, 0), false);
    if (f.state === "land") setState(f, "victory");
  }
};

/* ----------------------------------------------------------------- DISPATCH */

const HANDLERS: Record<string, Handler> = {
  idle: updateIdleLike,
  walk: updateIdleLike,
  run: updateIdleLike,
  turn: updateIdleLike,
  land: updateLand,
  jumpsquat: updateJumpsquat,
  airborne: updateAirborne,
  airDodge: updateAirDodge,
  attack: stepMove,
  airAttack: stepMove,
  special: stepMove,
  airSpecial: stepMove,
  shield: updateShield,
  shieldStun: updateShieldStun,
  shieldBreak: updateShieldBreak,
  roll: updateRoll,
  spotDodge: updateSpotDodge,
  hitstun: updateHitstun,
  grabbing: updateGrabbing,
  grab: updateGrabbing,
  grabbed: updateGrabbed,
  throw: updateThrow,
  ledgeHang: updateLedgeHang,
  ledgeClimb: updateLedgeScripted,
  ledgeRoll: updateLedgeScripted,
  ledgeAttack: updateLedgeAttack,
  respawn: updateRespawn,
  victory: updateVictory,
};

/** Per-tick fighter update: input, timers, then the current state's handler. */
export const updateFighter = (world: World, f: Fighter, input: InputFrame): void => {
  f.px = f.x;
  f.py = f.y;
  readInput(f, input);
  if (!f.alive) return;
  f.sinceHit += 1;

  // Shield regeneration only while not shielding.
  if (f.state !== "shield" && f.state !== "shieldStun") {
    if (f.shieldRegenDelay > 0) f.shieldRegenDelay -= 1;
    else if (f.shield < f.def.shieldMax && f.state !== "shieldBreak") {
      f.shield = Math.min(f.def.shieldMax, f.shield + SHIELD_REGEN);
    }
  }

  if (f.hitlag > 0) {
    f.hitlag -= 1;
    if (f.hitlag === 0 && f.state === "hitstun") {
      f.vx = f.pendLx;
      f.vy = f.pendLy;
      f.pendLx = 0;
      f.pendLy = 0;
    }
    return;
  }

  if (f.invuln > 0 && f.state !== "respawn") f.invuln -= 1;
  if (f.dropThrough > 0) f.dropThrough -= 1;
  if (f.ledgeCooldown > 0) f.ledgeCooldown -= 1;
  if (f.buffPower > 0) f.buffPower -= 1;
  if (f.buffSpeed > 0) f.buffSpeed -= 1;
  if (f.buffAegis > 0) {
    f.buffAegis -= 1;
    if (f.buffAegis === 0) f.armorHits = 0;
  }

  const handler = HANDLERS[f.state];
  if (handler) handler(world, f);
  else setState(f, f.grounded ? "idle" : "airborne");
};

