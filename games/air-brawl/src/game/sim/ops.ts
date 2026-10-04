import { FIGHTERS } from "../data/fighters";
import { ITEM_THROW } from "../data/items";
import type {
  Facing,
  Fighter,
  MoveDef,
  RosterEntry,
  SimEvent,
  StateName,
  World,
} from "./types";

export const emit = (world: World, event: SimEvent): void => {
  world.events.push(event);
};

export const createFighter = (entry: RosterEntry, index: number, stocks: number): Fighter => {
  const def = FIGHTERS[entry.fighterId];
  return {
    index,
    id: entry.id,
    name: entry.name,
    slot: entry.slot,
    team: entry.team,
    def,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    state: "idle",
    sf: 0,
    moveId: null,
    chargeFrames: 0,
    chargeMul: 1,
    grounded: false,
    platform: -1,
    dropThrough: 0,
    jumpsLeft: def.airJumps,
    jumpCut: false,
    fastFall: false,
    helpless: false,
    airDodgeUsed: false,
    landLock: 0,
    percent: 0,
    stocks,
    alive: true,
    respawnTimer: 0,
    hitlag: 0,
    hitstun: 0,
    tumble: false,
    pendLx: 0,
    pendLy: 0,
    bounced: false,
    invuln: 0,
    armorHits: 0,
    shield: def.shieldMax,
    shieldRegenDelay: 0,
    hitLog: [],
    lastHitBy: -1,
    lastHitMove: "",
    lastHitFrame: -9999,
    grabTarget: -1,
    grabbedBy: -1,
    grabTimer: 0,
    pummelCd: 0,
    mashCount: 0,
    ledge: -1,
    ledgeCooldown: 0,
    ledgeGrabs: 0,
    hang: 0,
    vanished: false,
    teleportTx: 0,
    teleportTy: 0,
    roll: 1,
    rolled: false,
    turnDir: 1,
    held: 0,
    prevHeld: 0,
    tapped: 0,
    bJump: 0,
    bAttack: 0,
    bSpecial: 0,
    bShield: 0,
    stickX: 0,
    stickY: 0,
    sxHist: [0, 0, 0, 0, 0, 0],
    syHist: [0, 0, 0, 0, 0, 0],
    histPos: 0,
    flickXAge: 99,
    flickXDir: 0,
    flickUpAge: 99,
    flickDownAge: 99,
    downHeldFrames: 0,
    buffPower: 0,
    buffSpeed: 0,
    buffAegis: 0,
    heldItem: null,
    sinceHit: 999,
    lifeFrames: 0,
    spawnFrame: 0,
  };
};

export const setState = (f: Fighter, state: StateName): void => {
  f.state = state;
  f.sf = 0;
};

/** The move a fighter is currently executing (if any). */
export const currentMove = (f: Fighter): MoveDef | null => {
  if (!f.moveId) return null;
  if (f.moveId === ITEM_THROW.id) return ITEM_THROW;
  return f.def.moves[f.moveId] ?? null;
};

/** Look up a move, preferring the `${id}Air` variant when airborne. */
export const resolveMove = (f: Fighter, id: string, airborne: boolean): MoveDef => {
  if (airborne) {
    const air = f.def.moves[`${id}Air`];
    if (air) return air;
  }
  return f.def.moves[id];
};

export const hurtLeft = (f: Fighter): number => f.x - f.def.halfWidth;
export const hurtRight = (f: Fighter): number => f.x + f.def.halfWidth;
export const hurtTop = (f: Fighter): number => f.y - f.def.height;

export const faceToward = (f: Fighter, dir: number): void => {
  if (dir !== 0) f.facing = (dir > 0 ? 1 : -1) as Facing;
};

/** Targetable by hitboxes right now? */
export const isTargetable = (f: Fighter): boolean =>
  f.alive && !f.vanished && f.state !== "respawn" && f.state !== "dead" && f.state !== "victory";

/** Free whoever is linked to `f` through a grab. */
export const releaseGrabLink = (world: World, f: Fighter): void => {
  if (f.grabTarget >= 0) {
    const target = world.fighters[f.grabTarget];
    if (target && target.grabbedBy === f.index) {
      target.grabbedBy = -1;
      if (target.state === "grabbed") {
        target.state = target.grounded ? "idle" : "airborne";
        target.sf = 0;
        target.invuln = Math.max(target.invuln, 18);
      }
    }
    f.grabTarget = -1;
  }
  if (f.grabbedBy >= 0) {
    const grabber = world.fighters[f.grabbedBy];
    if (grabber && grabber.grabTarget === f.index) {
      grabber.grabTarget = -1;
      if (grabber.state === "grabbing" || grabber.state === "throw") {
        grabber.state = grabber.grounded ? "idle" : "airborne";
        grabber.sf = 0;
        grabber.moveId = null;
      }
    }
    f.grabbedBy = -1;
  }
};

export const releaseLedge = (world: World, f: Fighter): void => {
  if (f.ledge >= 0) {
    const ref = world.ledges[f.ledge];
    if (ref && ref.occupant === f.index) ref.occupant = -1;
    f.ledge = -1;
  }
};

export const becomeAirborne = (f: Fighter): void => {
  f.grounded = false;
  f.platform = -1;
};

/** Reset transient combat state (new stock, respawn, etc.). */
export const resetFighterBody = (f: Fighter): void => {
  f.vx = 0;
  f.vy = 0;
  f.moveId = null;
  f.hitlag = 0;
  f.hitstun = 0;
  f.tumble = false;
  f.pendLx = 0;
  f.pendLy = 0;
  f.bounced = false;
  f.helpless = false;
  f.fastFall = false;
  f.airDodgeUsed = false;
  f.jumpsLeft = f.def.airJumps;
  f.jumpCut = false;
  f.shield = f.def.shieldMax;
  f.shieldRegenDelay = 0;
  f.percent = 0;
  f.grabTarget = -1;
  f.grabbedBy = -1;
  f.vanished = false;
  f.ledgeGrabs = 0;
  f.buffPower = 0;
  f.buffSpeed = 0;
  f.buffAegis = 0;
  f.heldItem = null;
  f.landLock = 0;
};
