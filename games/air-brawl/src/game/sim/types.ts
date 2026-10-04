/**
 * Air Brawl simulation types.
 *
 * The simulation is pure TypeScript (no React, SDK, DOM, or wall clock). It
 * advances in fixed 60 Hz ticks, mutates a single `World` in place with a fixed
 * operation order, and uses a seeded RNG — identical inputs produce identical
 * worlds (verified by `worldHash`).
 *
 * Units: world units (a fighter is ~90 tall, the main platform ~1000 wide),
 * velocities are units/frame, time is integer frames. +x is right, +y is DOWN
 * (screen space) so "up" is negative y.
 */

export type FighterId = "nova" | "volt" | "bulwark" | "wisp";
export type StageId = "proving-ground" | "skyline-rush" | "foundry";

export type Facing = 1 | -1;

/** Button bitmask used by the whole input pipeline (phone → host → sim). */
export const BTN = {
  JUMP: 1,
  ATTACK: 2,
  SPECIAL: 4,
  SHIELD: 8,
} as const;
export type ButtonBit = (typeof BTN)[keyof typeof BTN];

/** Per-tick input for one fighter, produced by the host input decoder or a bot. */
export interface InputFrame {
  /** Stick, -1..1. `my` is positive DOWN. */
  mx: number;
  my: number;
  /** Buttons currently held (BTN bits). */
  held: number;
  /** Buttons pressed since the previous tick (tap-safe, survives fast taps). */
  taps: number;
}

export const NEUTRAL_INPUT: Readonly<InputFrame> = Object.freeze({
  mx: 0,
  my: 0,
  held: 0,
  taps: 0,
});

export type StateName =
  | "idle"
  | "walk"
  | "run"
  | "turn"
  | "jumpsquat"
  | "airborne"
  | "land"
  | "attack"
  | "airAttack"
  | "special"
  | "airSpecial"
  | "shield"
  | "shieldStun"
  | "shieldBreak"
  | "roll"
  | "spotDodge"
  | "airDodge"
  | "hitstun"
  | "grab"
  | "grabbing"
  | "grabbed"
  | "throw"
  | "ledgeHang"
  | "ledgeClimb"
  | "ledgeRoll"
  | "ledgeAttack"
  | "respawn"
  | "dead"
  | "victory";

export type HitFx =
  | "impact"
  | "slash"
  | "electric"
  | "fire"
  | "magic"
  | "shock"
  | "meteor";

export type SfxWeight = "light" | "mid" | "heavy";

export interface HitboxDef {
  /** Inclusive move-frame window in which the hitbox is live. */
  from: number;
  to: number;
  /** Circle centre relative to the fighter's feet, facing right. y<0 = up. */
  x: number;
  y: number;
  r: number;
  /** Optional second endpoint: the hitbox sweeps a capsule (x,y)→(x2,y2). */
  x2?: number;
  y2?: number;
  damage: number;
  /** Degrees. 0 = forward, 90 = up, 180 = back, 270 = down (spike). 361 = auto. */
  angle: number;
  baseKb: number;
  growth: number;
  /** Multipliers against defaults. */
  hitlag?: number;
  stun?: number;
  priority?: number;
  /** Hits in the same group connect once per target per move. */
  group?: number;
  fx?: HitFx;
  sfx?: SfxWeight;
  /** Grab hitbox: ignores shields, connects into the grab state. */
  grab?: boolean;
  /** Shield damage multiplier. */
  shieldMul?: number;
  /** Hit is ground-only / air-only (undefined = both). */
  groundOnly?: boolean;
  airOnly?: boolean;
}

export interface MotionKey {
  /** Move frame at which this key applies. */
  at: number;
  vx?: number; // forward-relative (multiplied by facing)
  vy?: number;
  /** "set" replaces velocity, "add" adds an impulse. */
  mode?: "set" | "add";
  /** Hold this velocity until the next key (otherwise one-shot). */
  hold?: number;
}

export interface ChainDef {
  to: string;
  /** Move-frame window in which a buffered attack press advances the chain. */
  from: number;
  until: number;
}

export interface ChargeDef {
  /** Move frame to hold at while the attack button stays down. */
  at: number;
  max: number;
  damageMul: number;
  kbMul: number;
}

export interface TeleportDef {
  /** Frame the fighter vanishes / reappears. */
  vanishAt: number;
  appearAt: number;
  dist: number;
  /** "stick": use stick direction (default up if neutral). */
  dir: "stick" | "forward" | "up";
}

export interface SpawnDef {
  at: number;
  projectile: ProjectileId;
  x: number;
  y: number;
  /** Velocity relative to facing. */
  vx: number;
  vy: number;
  /** Replaces vx/vy: aim along stick if held (speed = hypot(vx,vy)). */
  aim?: boolean;
}

export type AnimId =
  | "jab"
  | "jab2"
  | "jab3"
  | "tilt"
  | "uptilt"
  | "downtilt"
  | "smash"
  | "upsmash"
  | "downsmash"
  | "dash"
  | "nair"
  | "fair"
  | "bair"
  | "uair"
  | "dair"
  | "cast"
  | "lunge"
  | "rise"
  | "slam"
  | "spin"
  | "grab"
  | "throw"
  | "pummel"
  | "teleport"
  | "toss"
  | "ledge";

export interface MoveDef {
  id: string;
  name: string;
  kind: "ground" | "aerial" | "special" | "grab" | "throw" | "ledge";
  /** Total frames including recovery. */
  total: number;
  hitboxes: HitboxDef[];
  /** Frames of lag when an aerial is landed (0 = normal landing). */
  landingLag?: number;
  chain?: ChainDef;
  charge?: ChargeDef;
  motion?: MotionKey[];
  spawns?: SpawnDef[];
  teleport?: TeleportDef;
  /** Gravity multiplier while the move runs in the air (default 1). */
  gravity?: number;
  /** Fraction of air drift control while the move runs (default 1). */
  drift?: number;
  /** Horizontal steering acceleration from the stick while the move runs. */
  steer?: number;
  /** Move-frame window in which `steer` applies (default whole move). */
  steerWindow?: [number, number];
  /** Fighter cannot jump / act again until landing. */
  helpless?: boolean;
  /** Frame windows with full invulnerability. */
  invuln?: [number, number];
  /** Frame window of super armor (hits flinchless, still deal damage). */
  armor?: [number, number];
  /** Frame at which a throw releases its victim (throws only). */
  releaseAt?: number;
  anim: AnimId;
}

export type ProjectileId =
  | "novaBolt"
  | "bulwarkRock"
  | "wispOrb"
  | "wispDisc"
  | "wispMine"
  | "bomb";

export interface ProjectileDef {
  id: ProjectileId;
  radius: number;
  ttl: number;
  gravity: number;
  drag: number;
  damage: number;
  angle: number;
  baseKb: number;
  growth: number;
  hitlag: number;
  fx: HitFx;
  sfx: SfxWeight;
  /** Hits before the projectile is consumed (1 = destroyed on hit). */
  pierce: number;
  /** Bounces off solid platforms. */
  bounce?: boolean;
  /** Boomerang: reverses horizontal velocity at `turnAt` frames. */
  boomerangAt?: number;
  /** Mine: dormant until armed, explodes when an enemy is within `trigger`. */
  arm?: number;
  trigger?: number;
  /** Explosion radius/damage on expiry (mines, bombs). */
  blast?: { radius: number; damage: number; baseKb: number; growth: number };
  /** Max simultaneous projectiles of this id per owner. */
  maxPerOwner: number;
  /** Visual tag for the renderer. */
  look: "bolt" | "orb" | "disc" | "mine" | "rock" | "bomb" | "wave";
}

export interface FighterDef {
  id: FighterId;
  name: string;
  archetype: string;
  blurb: string;
  /** 1..5 stat dots for the phone select screen. */
  stats: { speed: number; weight: number; power: number; recovery: number; difficulty: number };
  moveHints: string[];
  weight: number;
  halfWidth: number;
  height: number;
  walkSpeed: number;
  runSpeed: number;
  groundAccel: number;
  traction: number;
  airSpeed: number;
  airAccel: number;
  airFriction: number;
  jumpsquat: number;
  jumpVel: number;
  shortHopVel: number;
  doubleJumpVel: number;
  airJumps: number;
  gravity: number;
  fallSpeed: number;
  fastFallSpeed: number;
  /** Frames of landing lag on a normal landing. */
  landLag: number;
  shieldMax: number;
  rollSpeed: number;
  airDodgeSpeed: number;
  /** Visual: size multiplier. */
  scale: number;
  moves: Record<string, MoveDef>;
}

export interface PlatformDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Solid platforms block from all sides; soft ones are one-way from above. */
  solid: boolean;
  /** Solid platforms with ledges can be grabbed on both corners. */
  ledges?: boolean;
  /** Deterministic sinusoidal motion. */
  move?: { ax: number; ay: number; period: number; phase?: number };
}

export interface HazardDef {
  id: string;
  /** "beam" = sky-to-floor column, "geyser" = rises from below. Visual only. */
  kind: "beam" | "geyser";
  /** Cycle in frames; the warning + active windows sit at the end of the cycle. */
  period: number;
  warn: number;
  active: number;
  offset: number;
  /** Lane centres; each cycle moves to the next entry. */
  xs: number[];
  w: number;
  top: number;
  bottom: number;
  damage: number;
  angle: number;
  baseKb: number;
  growth: number;
}

export interface StageTheme {
  skyTop: string;
  skyBottom: string;
  glow: string;
  platform: string;
  platformEdge: string;
  accent: string;
  /** Renderer decor preset. */
  decor: "proving" | "skyline" | "foundry";
}

export interface StageDef {
  id: StageId;
  name: string;
  tagline: string;
  platforms: PlatformDef[];
  hazards: HazardDef[];
  blast: { left: number; right: number; top: number; bottom: number };
  /** Camera is clamped inside this box (world units). */
  camera: { left: number; right: number; top: number; bottom: number };
  /** Starting spots, at least 8, left→right. */
  spawns: { x: number; y: number }[];
  /** Respawn halo anchor. */
  respawn: { x: number; y: number };
  /** Item drop x-range. */
  itemRange: [number, number];
  theme: StageTheme;
}

export type ItemKind = "powerCore" | "surge" | "aegis" | "chaosBomb";
export type ItemSetting = "off" | "low" | "normal" | "chaos";

export interface ItemEntity {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  ttl: number;
}

export interface ProjectileEntity {
  id: number;
  def: ProjectileDef;
  ownerIndex: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  hitsLeft: number;
  /** Fighter indices already hit (multi-pierce safety). */
  hitMask: number;
  returning: boolean;
  dead: boolean;
  powered: boolean;
}

export type MatchMode = "stock" | "timed";

export interface MatchConfig {
  stageId: StageId;
  mode: MatchMode;
  stocks: number;
  /** Timed mode length in seconds. */
  timeLimitSec: number;
  teams: boolean;
  friendlyFire: boolean;
  items: ItemSetting;
  hazards: boolean;
  /** Global knockback multiplier (Fast Party uses > 1). */
  kbScale: number;
  seed: number;
  /** Frames of pre-fight countdown (fighters locked). */
  countdownFrames: number;
}

export interface RosterEntry {
  id: string;
  name: string;
  fighterId: FighterId;
  /** 0-based slot → colour/spawn. */
  slot: number;
  team: number;
}

export interface PlayerStats {
  kos: number;
  falls: number;
  selfDestructs: number;
  damageDealt: number;
  damageTaken: number;
  survivalFrames: number;
  longestSurvival: number;
  /** Move id → number of connecting hits. */
  moveHits: Record<string, number>;
  /** Move id → number of KOs it caused. */
  koMoves: Record<string, number>;
  /** Frames the fighter was alive (match-time attribution). */
  aliveFrames: number;
}

export interface Fighter {
  index: number;
  id: string;
  name: string;
  slot: number;
  team: number;
  def: FighterDef;

  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  facing: Facing;

  state: StateName;
  /** Frame counter within the current state / move. */
  sf: number;
  moveId: string | null;
  chargeFrames: number;
  /** Damage/kb multiplier applied by the current charged move. */
  chargeMul: number;

  grounded: boolean;
  platform: number; // index into world.platforms, -1 when airborne
  dropThrough: number; // frames of soft-platform pass-through
  jumpsLeft: number;
  jumpCut: boolean;
  fastFall: boolean;
  helpless: boolean;
  airDodgeUsed: boolean;
  /** Frames of landing lock remaining in the `land` state. */
  landLock: number;

  percent: number;
  stocks: number;
  alive: boolean;
  respawnTimer: number;

  hitlag: number;
  hitstun: number;
  tumble: boolean;
  /** Pending launch applied when hitlag ends. */
  pendLx: number;
  pendLy: number;
  bounced: boolean;

  invuln: number;
  armorHits: number;

  shield: number;
  shieldRegenDelay: number;

  /** Hit bookkeeping: target index * 8 + group, cleared when a move starts. */
  hitLog: number[];
  lastHitBy: number; // fighter index or -1
  lastHitMove: string;
  lastHitFrame: number;

  grabTarget: number; // fighter index or -1
  grabbedBy: number;
  grabTimer: number;
  pummelCd: number;
  mashCount: number;

  ledge: number; // index into world.ledges or -1
  ledgeCooldown: number;
  ledgeGrabs: number;
  hang: number;

  /** Vanished (teleport) — untargetable and invisible. */
  vanished: boolean;
  teleportTx: number;
  teleportTy: number;

  roll: number; // roll direction ±1
  rolled: boolean;
  turnDir: Facing;

  /** Input memory. */
  held: number;
  tapped: number;
  prevHeld: number;
  /** Buffered press windows (frames remaining). */
  bJump: number;
  bAttack: number;
  bSpecial: number;
  bShield: number;
  stickX: number;
  stickY: number;
  /** Stick samples for flick detection (ring of 6). */
  sxHist: number[];
  syHist: number[];
  histPos: number;
  /** Frames since a directional flick: x (signed), up, down. Large = none. */
  flickXAge: number;
  flickXDir: number;
  flickUpAge: number;
  flickDownAge: number;
  downHeldFrames: number;

  /** Power-ups. */
  buffPower: number;
  buffSpeed: number;
  buffAegis: number;
  heldItem: ItemKind | null;

  /** Frames since this fighter last got hit (for DI/stale heuristics). */
  sinceHit: number;
  /** Frames alive in the current stock. */
  lifeFrames: number;
  /** Respawn spot index (for halo), cosmetic. */
  spawnFrame: number;
}

export type SimEvent =
  | { type: "countdown"; n: number }
  | { type: "fightStart" }
  | {
      type: "hit";
      attacker: number;
      victim: number;
      x: number;
      y: number;
      damage: number;
      kb: number;
      angle: number;
      dx: number;
      dy: number;
      moveId: string;
      fx: HitFx;
      sfx: SfxWeight;
      lag: number;
      killing: boolean;
    }
  | { type: "shieldHit"; attacker: number; victim: number; x: number; y: number; damage: number }
  | { type: "shieldBreak"; victim: number; x: number; y: number }
  | { type: "clash"; a: number; b: number; x: number; y: number }
  | { type: "jump"; who: number; x: number; y: number; air: boolean }
  | { type: "land"; who: number; x: number; y: number; hard: boolean }
  | { type: "dash"; who: number; x: number; y: number; dir: number }
  | { type: "dodge"; who: number; x: number; y: number; air: boolean }
  | { type: "attack"; who: number; moveId: string; x: number; y: number }
  | { type: "special"; who: number; moveId: string; x: number; y: number }
  | { type: "projectile"; who: number; id: ProjectileId; x: number; y: number }
  | { type: "explosion"; x: number; y: number; radius: number }
  | { type: "grab"; attacker: number; victim: number; x: number; y: number }
  | { type: "throw"; attacker: number; victim: number; x: number; y: number }
  | { type: "ledge"; who: number; x: number; y: number }
  | { type: "teleport"; who: number; x: number; y: number; appear: boolean }
  | { type: "ko"; victim: number; killer: number; x: number; y: number; dx: number; dy: number; moveId: string; final: boolean; selfDestruct: boolean }
  | { type: "respawn"; who: number; x: number; y: number }
  | { type: "itemSpawn"; kind: ItemKind; x: number; y: number }
  | { type: "itemPickup"; who: number; kind: ItemKind }
  | { type: "hazard"; id: string; phase: "warn" | "fire" }
  | { type: "hazardHit"; victim: number; id: string }
  | { type: "matchEnd"; winnerTeam: number; winners: number[]; reason: "stocks" | "time" | "draw" };

export interface LedgeRef {
  platform: number;
  side: -1 | 1; // -1 = left corner, +1 = right corner
  occupant: number; // fighter index or -1
}

export type WorldPhase = "countdown" | "fight" | "finishing" | "over";

export interface World {
  config: MatchConfig;
  stage: StageDef;
  frame: number;
  matchFrame: number;
  phase: WorldPhase;
  countdown: number;
  freeze: number;
  /** Time dilation requested by the sim (1 = normal). */
  timeScale: number;
  slowmo: number;
  fighters: Fighter[];
  platforms: PlatformRuntime[];
  ledges: LedgeRef[];
  projectiles: ProjectileEntity[];
  items: ItemEntity[];
  nextEntityId: number;
  rng: number;
  events: SimEvent[];
  stats: PlayerStats[];
  /** Order in which fighters were eliminated (index list, first out first). */
  eliminated: number[];
  winnerTeam: number;
  winners: number[];
  nextItemAt: number;
  hazardState: { id: string; phase: "idle" | "warn" | "active"; hitMask: number; lane: number }[];
  /** Camera hint for dramatic moments (final KO, big hits). */
  spotlight: { x: number; y: number; frames: number } | null;
  /** Ticks left in the post-final-KO slow-mo before the match ends. */
  finishTimer: number;
  /** Timed-mode scores (KOs − selfDestruct falls). */
  scores: number[];
  endReason: "stocks" | "time" | "draw" | null;
  finalKo: { victim: number; x: number; y: number } | null;
}

/** Platform with its per-frame resolved position. */
export interface PlatformRuntime {
  def: PlatformDef;
  x: number;
  y: number;
  dx: number;
  dy: number;
}
