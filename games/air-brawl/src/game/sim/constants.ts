/** Tunables shared by the whole simulation. Everything is in world units / frames. */

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/** Input */
export const STICK_DEADZONE = 0.14;
/** Stick magnitude at which a direction counts as "held". */
export const DIR_THRESHOLD = 0.45;
/** Stick magnitude for tilts vs. smash flicks. */
export const FLICK_HIGH = 0.78;
export const FLICK_LOW = 0.38;
/** Frames in which a flick still converts an attack press into a smash. */
export const FLICK_WINDOW = 10;
/** Stick reaching a direction from rest within this many frames counts as a flick. */
export const FLICK_SAMPLES = 5;
/** Buffered press lifetime (frames). */
export const BUFFER_FRAMES = 6;
export const RUN_THRESHOLD = 0.62;
export const DOWN_HOLD_DROP = 2;
export const FASTFALL_THRESHOLD = 0.72;
/** Releasing jump within this many airborne frames cuts the jump short. */
export const JUMP_CUT_WINDOW = 10;

/** Combat */
export const KB_SPEED = 0.2;
export const KB_DECEL_X = 0.32;
export const KB_GRAVITY_MUL = 0.78;
export const HITSTUN_PER_KB = 0.38;
export const TUMBLE_KB = 62;
export const HITLAG_BASE = 4;
export const HITLAG_PER_DAMAGE = 0.32;
export const HITLAG_MAX = 18;
export const BOUNCE_SPEED = 15;
/** Directional influence: max launch angle shift (radians). */
export const DI_MAX = 0.2;
export const PRIORITY_CLANK = 9;

/** Shield */
export const SHIELD_DRAIN = 0.1;
export const SHIELD_REGEN = 0.17;
export const SHIELD_REGEN_DELAY = 36;
export const SHIELD_RESET_AFTER_BREAK = 22;
export const SHIELD_BREAK_FRAMES = 150;
export const SHIELD_PUSHBACK = 3.2;
export const SHIELD_STUN_BASE = 3;
export const SHIELD_STUN_PER_DAMAGE = 0.42;

/** Dodges (frames) */
export const ROLL_FRAMES = 30;
export const ROLL_INVULN: [number, number] = [4, 20];
export const SPOT_DODGE_FRAMES = 24;
export const SPOT_DODGE_INVULN: [number, number] = [3, 17];
export const AIR_DODGE_FRAMES = 30;
export const AIR_DODGE_INVULN: [number, number] = [3, 20];

/** Grabs */
export const GRAB_BASE_HOLD = 90;
export const GRAB_HOLD_PER_PERCENT = 0.9;
export const GRAB_MASH_REDUCTION = 5;
export const PUMMEL_COOLDOWN = 20;
export const PUMMEL_DAMAGE = 2;

/** Ledges */
export const LEDGE_GRAB_REACH_X = 40;
export const LEDGE_GRAB_REACH_Y = 70;
export const LEDGE_HANG_MAX = 320;
export const LEDGE_COOLDOWN = 36;
export const LEDGE_CLIMB_FRAMES = 26;
export const LEDGE_ROLL_FRAMES = 34;
export const LEDGE_ATTACK_FRAMES = 34;
export const LEDGE_HANG_Y = 42;

/** Stocks / respawn */
export const RESPAWN_DELAY = 70;
export const RESPAWN_HOLD_MAX = 200;
export const RESPAWN_INVULN = 120;
export const SPAWN_INVULN = 90;
export const FINAL_KO_FREEZE = 36;
export const FINAL_KO_SLOWMO = 70;
export const FINAL_KO_TIMESCALE = 0.3;

/** Items */
export const ITEM_PICKUP_RADIUS = 46;
export const ITEM_BUFF_FRAMES = 660;
export const ITEM_TTL = 1500;
export const POWER_DAMAGE_MUL = 1.45;
export const POWER_KB_MUL = 1.18;
export const SURGE_SPEED_MUL = 1.28;
export const AEGIS_FRAMES = 420;

/**
 * Anti-spam and skill.
 *
 * Move staling: every landed move goes into the attacker's queue of the last STALE_QUEUE moves;
 * each copy of the same move already in the queue costs STALE_STEP of its damage (never below
 * STALE_MIN) and a third of that of its knockback. Mixing moves keeps them fresh.
 */
export const STALE_QUEUE = 9;
export const STALE_STEP = 0.085;
export const STALE_MIN = 0.55;
/** A shield raised into an incoming hit within this many frames is a parry: no shield damage, no stun. */
export const PERFECT_SHIELD_FRAMES = 5;
/** After lowering the shield it cannot be raised again for this long: no mashing a permanent parry window. */
export const SHIELD_RELEASE_LOCK = 12;
/** Dodges used within this window of each other get weaker (shorter invulnerability) and slower to recover. */
export const DODGE_FATIGUE_WINDOW = 80;
export const DODGE_FATIGUE_STEP = 0.28;
export const DODGE_FATIGUE_MIN = 0.3;
export const DODGE_FATIGUE_LAG = 5;
/** Projectile specials (anything that spawns) cannot be restarted until this long after they began. */
export const PROJECTILE_RECAST = 16;

/** Misc */
export const MAX_SUBSTEP = 10;
export const MAX_PROJECTILES = 40;
export const STAGE_TOP_KO_BIAS = 1;
