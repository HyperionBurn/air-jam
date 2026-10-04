import { ITEM_INTERVALS, ITEM_KINDS, ITEMS } from "../data/items";
import { STAGES } from "../data/stages";
import { applyHit, pinGrabbed, resolveMelee } from "./combat";
import {
  AEGIS_FRAMES,
  FINAL_KO_FREEZE,
  FINAL_KO_TIMESCALE,
  ITEM_BUFF_FRAMES,
  ITEM_PICKUP_RADIUS,
  ITEM_TTL,
  SPAWN_INVULN,
  TICK_HZ,
} from "./constants";
import { updateFighter } from "./fighter-states";
import {
  createFighter,
  emit,
  isTargetable,
  releaseGrabLink,
  releaseLedge,
  resetFighterBody,
  setState,
} from "./ops";
import { updateProjectiles } from "./projectiles";
import {
  createLedges,
  createPlatforms,
  findSupport,
  spawnPointFor,
  updatePlatforms,
} from "./stage";
import {
  NEUTRAL_INPUT,
  type Fighter,
  type InputFrame,
  type ItemKind,
  type MatchConfig,
  type PlayerStats,
  type RosterEntry,
  type StageDef,
  type World,
} from "./types";
import { circleHitsRect, clamp, nextRandom } from "./util";

export const DEFAULT_CONFIG: MatchConfig = {
  stageId: "proving-ground",
  mode: "stock",
  stocks: 3,
  timeLimitSec: 120,
  teams: false,
  friendlyFire: false,
  items: "off",
  hazards: true,
  kbScale: 1,
  seed: 1337,
  countdownFrames: 3 * TICK_HZ,
};

const emptyStats = (): PlayerStats => ({
  kos: 0,
  falls: 0,
  selfDestructs: 0,
  damageDealt: 0,
  damageTaken: 0,
  survivalFrames: 0,
  longestSurvival: 0,
  moveHits: {},
  koMoves: {},
  aliveFrames: 0,
});

export const createWorld = (partial: Partial<MatchConfig>, roster: RosterEntry[]): World => {
  const config: MatchConfig = { ...DEFAULT_CONFIG, ...partial };
  const base = STAGES[config.stageId];
  const stage: StageDef = config.hazards ? base : { ...base, hazards: [] };
  const stocks = config.mode === "timed" ? 99 : config.stocks;

  const world: World = {
    config,
    stage,
    frame: 0,
    matchFrame: 0,
    phase: config.countdownFrames > 0 ? "countdown" : "fight",
    countdown: config.countdownFrames,
    freeze: 0,
    timeScale: 1,
    slowmo: 0,
    fighters: [],
    platforms: createPlatforms(stage),
    ledges: createLedges(stage),
    projectiles: [],
    items: [],
    nextEntityId: 1,
    rng: config.seed | 0 || 1,
    events: [],
    stats: [],
    eliminated: [],
    winnerTeam: -1,
    winners: [],
    nextItemAt: Math.floor((ITEM_INTERVALS[config.items] || 0) * 0.7),
    hazardState: stage.hazards.map((h) => ({ id: h.id, phase: "idle" as const, hitMask: 0, lane: 0 })),
    spotlight: null,
    finishTimer: 0,
    scores: roster.map(() => 0),
    endReason: null,
    finalKo: null,
  };

  roster.forEach((entry, index) => {
    const f = createFighter(entry, index, stocks);
    world.fighters.push(f);
    world.stats.push(emptyStats());
  });
  placeFightersAtSpawns(world);
  return world;
};

/** Place every fighter at its spawn and settle it on the ground. */
export const placeFightersAtSpawns = (world: World): void => {
  const count = world.fighters.length;
  world.fighters.forEach((f, order) => {
    const spawn = spawnPointFor(world.stage, order, count);
    f.x = spawn.x;
    f.y = spawn.y;
    f.px = f.x;
    f.py = f.y;
    f.facing = spawn.x <= 0 ? 1 : -1;
    const support = findSupport(world, f);
    f.grounded = support >= 0;
    f.platform = support;
    f.state = f.grounded ? "idle" : "airborne";
    f.invuln = SPAWN_INVULN;
  });
};

/* ------------------------------------------------------------------ HAZARDS */

const updateHazards = (world: World): void => {
  const hazards = world.stage.hazards;
  for (let i = 0; i < hazards.length; i += 1) {
    const h = hazards[i];
    const hs = world.hazardState[i];
    const clock = world.matchFrame + h.offset;
    const t = clock % h.period;
    const cycle = Math.floor(clock / h.period);
    const warnStart = h.period - h.warn - h.active;
    const activeStart = h.period - h.active;
    const phase = t >= activeStart ? "active" : t >= warnStart ? "warn" : "idle";
    hs.lane = cycle % h.xs.length;
    if (phase !== hs.phase) {
      hs.phase = phase;
      if (phase === "warn") hs.hitMask = 0;
      if (phase !== "idle") emit(world, { type: "hazard", id: h.id, phase: phase === "warn" ? "warn" : "fire" });
    }
    if (phase !== "active") continue;
    const cx = h.xs[hs.lane];
    for (const f of world.fighters) {
      if (!isTargetable(f) || f.invuln > 0) continue;
      if (hs.hitMask & (1 << f.index)) continue;
      if (
        circleHitsRect(
          f.x,
          f.y - f.def.height / 2,
          1,
          cx - h.w / 2 - f.def.halfWidth,
          h.top,
          cx + h.w / 2 + f.def.halfWidth,
          h.bottom,
        ) &&
        f.y - f.def.height < h.bottom &&
        f.y > h.top
      ) {
        hs.hitMask |= 1 << f.index;
        const dirSign = f.x >= cx ? 1 : -1;
        const outcome = applyHit(
          world,
          f,
          { damage: h.damage, angle: h.angle, baseKb: h.baseKb, growth: h.growth, fx: "fire", sfx: "heavy" },
          { attacker: -1, moveId: `hazard:${h.id}`, dirSign, x: f.x, y: f.y - f.def.height / 2 },
        );
        if (outcome !== "none") emit(world, { type: "hazardHit", victim: f.index, id: h.id });
      }
    }
  }
};

/* -------------------------------------------------------------------- ITEMS */

const MAX_ITEMS = { off: 0, low: 1, normal: 2, chaos: 4 } as const;

const pickItemKind = (world: World): ItemKind => {
  let total = 0;
  for (const kind of ITEM_KINDS) total += ITEMS[kind].weight;
  let roll = nextRandom(world) * total;
  for (const kind of ITEM_KINDS) {
    roll -= ITEMS[kind].weight;
    if (roll <= 0) return kind;
  }
  return ITEM_KINDS[0];
};

const updateItems = (world: World): void => {
  const setting = world.config.items;
  if (setting !== "off" && world.phase === "fight") {
    if (world.matchFrame >= world.nextItemAt && world.items.length < MAX_ITEMS[setting]) {
      const range = world.stage.itemRange;
      const kind = pickItemKind(world);
      const x = range[0] + nextRandom(world) * (range[1] - range[0]);
      const y = world.stage.respawn.y - 160;
      world.items.push({ id: world.nextEntityId++, kind, x, y, vy: 0, grounded: false, ttl: ITEM_TTL });
      emit(world, { type: "itemSpawn", kind, x, y });
      const interval = ITEM_INTERVALS[setting];
      world.nextItemAt = world.matchFrame + Math.floor(interval * (0.7 + nextRandom(world) * 0.6));
    }
  }
  for (let i = world.items.length - 1; i >= 0; i -= 1) {
    const item = world.items[i];
    item.ttl -= 1;
    if (!item.grounded) {
      const prevY = item.y;
      item.vy = Math.min(7, item.vy + 0.35);
      item.y += item.vy;
      for (const p of world.platforms) {
        if (prevY <= p.y + 1 && item.y >= p.y && item.x >= p.x && item.x <= p.x + p.def.w) {
          item.y = p.y;
          item.vy = 0;
          item.grounded = true;
          break;
        }
      }
    }
    let remove = item.ttl <= 0 || item.y > world.stage.blast.bottom;
    if (!remove) {
      for (const f of world.fighters) {
        if (!isTargetable(f)) continue;
        if (item.kind === "chaosBomb" && f.heldItem) continue;
        const dx = f.x - item.x;
        const dy = f.y - f.def.height / 2 - (item.y - 20);
        if (dx * dx + dy * dy > ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS) continue;
        applyItem(world, f, item.kind);
        remove = true;
        break;
      }
    }
    if (remove) world.items.splice(i, 1);
  }
};

const applyItem = (world: World, f: Fighter, kind: ItemKind): void => {
  if (kind === "powerCore") f.buffPower = ITEM_BUFF_FRAMES;
  else if (kind === "surge") f.buffSpeed = ITEM_BUFF_FRAMES;
  else if (kind === "aegis") {
    f.buffAegis = AEGIS_FRAMES;
    f.armorHits = 3;
  } else f.heldItem = "chaosBomb";
  emit(world, { type: "itemPickup", who: f.index, kind });
};

/* ---------------------------------------------------------------- KO / WIN */

const teamsAlive = (world: World, excludeVictim = -1): Set<number> => {
  const alive = new Set<number>();
  for (const f of world.fighters) {
    if (!f.alive) continue;
    if (f.index === excludeVictim && f.stocks <= 1 && world.config.mode === "stock") continue;
    alive.add(f.team);
  }
  return alive;
};

export const wouldEndMatch = (world: World, victim: number): boolean =>
  world.config.mode === "stock" &&
  world.fighters.length > 1 &&
  new Set(world.fighters.map((f) => f.team)).size > 1 &&
  teamsAlive(world, victim).size <= 1;

const blastExit = (world: World, f: Fighter): { x: number; y: number; dx: number; dy: number } => {
  const b = world.stage.blast;
  const x = clamp(f.x, b.left, b.right);
  const y = clamp(f.y, b.top, b.bottom);
  const dx = f.x < b.left ? -1 : f.x > b.right ? 1 : 0;
  const dy = f.y < b.top ? -1 : f.y > b.bottom ? 1 : 0;
  return { x, y, dx, dy };
};

const knockOut = (world: World, f: Fighter): void => {
  const credited =
    f.lastHitBy >= 0 && f.lastHitBy !== f.index && world.frame - f.lastHitFrame <= 6 * TICK_HZ ? f.lastHitBy : -1;
  const selfDestruct = credited < 0;
  const stats = world.stats[f.index];
  stats.falls += 1;
  stats.longestSurvival = Math.max(stats.longestSurvival, f.lifeFrames);
  stats.survivalFrames += f.lifeFrames;
  const moveId = selfDestruct ? "fall" : f.lastHitMove;
  if (credited >= 0) {
    const killer = world.stats[credited];
    killer.kos += 1;
    killer.koMoves[moveId] = (killer.koMoves[moveId] ?? 0) + 1;
    world.scores[credited] += 1;
  } else {
    stats.selfDestructs += 1;
    world.scores[f.index] -= 1;
  }
  const exit = blastExit(world, f);
  releaseGrabLink(world, f);
  releaseLedge(world, f);
  f.lifeFrames = 0;

  const stockMode = world.config.mode === "stock";
  if (stockMode) f.stocks -= 1;
  const eliminated = stockMode && f.stocks <= 0;
  let final = false;
  if (eliminated) {
    f.alive = false;
    setState(f, "dead");
    world.eliminated.push(f.index);
    resetFighterBody(f);
    f.vanished = true;
    f.invuln = 0;
    if (
      world.phase === "fight" &&
      world.fighters.length > 1 &&
      new Set(world.fighters.map((o) => o.team)).size > 1 &&
      teamsAlive(world).size <= 1
    ) {
      final = true;
    }
  } else {
    resetFighterBody(f);
    setState(f, "respawn");
    f.vanished = true;
    f.invuln = 999;
  }

  emit(world, {
    type: "ko",
    victim: f.index,
    killer: credited,
    x: exit.x,
    y: exit.y,
    dx: exit.dx,
    dy: exit.dy,
    moveId,
    final,
    selfDestruct,
  });

  if (final) {
    world.finalKo = { victim: f.index, x: exit.x, y: exit.y };
    beginFinish(world, "stocks");
  }
};

const beginFinish = (world: World, reason: "stocks" | "time" | "draw"): void => {
  if (world.phase === "finishing" || world.phase === "over") return;
  world.phase = "finishing";
  world.endReason = reason;
  world.freeze = reason === "stocks" ? FINAL_KO_FREEZE : 0;
  world.slowmo = 0;
  world.timeScale = reason === "stocks" ? FINAL_KO_TIMESCALE + 0.2 : 1;
  world.finishTimer = reason === "stocks" ? 84 : 36;
  world.spotlight = world.finalKo
    ? { x: world.finalKo.x, y: world.finalKo.y, frames: world.freeze + world.finishTimer }
    : null;
  resolveWinners(world, reason);
  for (const f of world.fighters) {
    if (f.alive && world.winners.includes(f.index)) {
      f.invuln = 999;
    }
  }
};

const resolveWinners = (world: World, reason: "stocks" | "time" | "draw"): void => {
  const fighters = world.fighters;
  if (reason === "stocks") {
    const alive = teamsAlive(world);
    if (alive.size === 1) {
      const team = [...alive][0];
      world.winnerTeam = team;
      world.winners = fighters.filter((f) => f.team === team && f.alive).map((f) => f.index);
      return;
    }
    // Simultaneous elimination: last eliminated wins.
    const last = world.eliminated[world.eliminated.length - 1];
    if (last !== undefined) {
      world.winnerTeam = fighters[last].team;
      world.winners = [last];
      return;
    }
    world.winnerTeam = -1;
    world.winners = [];
    return;
  }
  // Timed: best team score, tie → damage dealt, then draw.
  const totals = new Map<number, { score: number; damage: number }>();
  for (const f of fighters) {
    const entry = totals.get(f.team) ?? { score: 0, damage: 0 };
    entry.score += world.scores[f.index];
    entry.damage += world.stats[f.index].damageDealt;
    totals.set(f.team, entry);
  }
  const ranked = [...totals.entries()].sort(
    (a, b) => b[1].score - a[1].score || b[1].damage - a[1].damage,
  );
  if (ranked.length === 0) return;
  if (
    ranked.length > 1 &&
    ranked[0][1].score === ranked[1][1].score &&
    Math.round(ranked[0][1].damage) === Math.round(ranked[1][1].damage)
  ) {
    world.winnerTeam = -1;
    world.winners = [];
    world.endReason = "draw";
    return;
  }
  world.winnerTeam = ranked[0][0];
  world.winners = fighters.filter((f) => f.team === ranked[0][0]).map((f) => f.index);
};

const endMatch = (world: World): void => {
  world.phase = "over";
  world.timeScale = 1;
  world.spotlight = null;
  for (const f of world.fighters) {
    if (f.alive && world.winners.includes(f.index) && f.state !== "respawn") {
      setState(f, "victory");
    }
  }
  emit(world, {
    type: "matchEnd",
    winnerTeam: world.winnerTeam,
    winners: world.winners,
    reason: world.endReason ?? "stocks",
  });
};

const checkBlastZones = (world: World): void => {
  const b = world.stage.blast;
  for (const f of world.fighters) {
    if (!f.alive || f.state === "respawn") continue;
    if (f.x < b.left || f.x > b.right || f.y < b.top || f.y > b.bottom) knockOut(world, f);
  }
};

/** Detect a decisive hit this tick and ask the host for a dramatic slow-mo. */
const watchMatchPoint = (world: World): void => {
  if (world.phase !== "fight") return;
  for (const event of world.events) {
    if (event.type === "hit" && event.killing && wouldEndMatch(world, event.victim)) {
      world.slowmo = 110;
      world.timeScale = 0.3;
      world.spotlight = { x: event.x, y: event.y, frames: 110 };
    }
  }
};

/* --------------------------------------------------------------------- STEP */

/**
 * Advance the simulation one fixed tick. `inputs` is indexed by fighter index;
 * missing entries are treated as neutral. Events for this tick are left in
 * `world.events` (cleared at the start of the next call).
 */
export const stepWorld = (world: World, inputs: ReadonlyArray<InputFrame | undefined>): void => {
  world.events.length = 0;
  if (world.phase === "over") return;
  if (world.freeze > 0) {
    world.freeze -= 1;
    if (world.spotlight) world.spotlight.frames -= 1;
    return;
  }
  world.frame += 1;

  if (world.phase === "countdown") {
    world.countdown -= 1;
    if (world.countdown > 0 && world.countdown % TICK_HZ === 0) {
      emit(world, { type: "countdown", n: world.countdown / TICK_HZ });
    }
    if (world.countdown <= 0) {
      world.phase = "fight";
      emit(world, { type: "fightStart" });
    }
  } else {
    world.matchFrame += 1;
  }

  const control = world.phase === "fight";
  updatePlatforms(world);
  if (control) {
    updateHazards(world);
  }
  updateItems(world);

  for (const f of world.fighters) {
    const input = (control ? inputs[f.index] : undefined) ?? NEUTRAL_INPUT;
    updateFighter(world, f, input);
    if (f.alive && f.state !== "respawn") f.lifeFrames += 1;
  }
  pinGrabbed(world);
  if (control || world.phase === "finishing") {
    updateProjectiles(world);
    if (control) resolveMelee(world);
  }
  checkBlastZones(world);

  if (world.phase === "fight") {
    for (let i = 0; i < world.fighters.length; i += 1) {
      if (world.fighters[i].alive) world.stats[i].aliveFrames += 1;
    }
    watchMatchPoint(world);
    if (world.config.mode === "timed" && world.matchFrame >= world.config.timeLimitSec * TICK_HZ) {
      beginFinish(world, "time");
    }
  }

  if (world.slowmo > 0) {
    world.slowmo -= 1;
    if (world.slowmo === 0 && world.phase === "fight") world.timeScale = 1;
  }
  if (world.spotlight) {
    world.spotlight.frames -= 1;
    if (world.spotlight.frames <= 0 && world.phase !== "finishing") world.spotlight = null;
  }
  if (world.phase === "finishing") {
    world.finishTimer -= 1;
    if (world.finishTimer <= 0) endMatch(world);
  }
};

/** Final ranking, best first: winners, then survivors by stocks, then reverse elimination order. */
export const rankFighters = (world: World): number[] => {
  const winners = world.winners.slice();
  const rest = world.fighters
    .filter((f) => !winners.includes(f.index))
    .map((f) => f.index);
  const alive = rest.filter((i) => world.fighters[i].alive);
  alive.sort((a, b) => {
    const fa = world.fighters[a];
    const fb = world.fighters[b];
    return (
      fb.stocks - fa.stocks ||
      world.scores[b] - world.scores[a] ||
      world.stats[b].damageDealt - world.stats[a].damageDealt
    );
  });
  const out = rest.filter((i) => !world.fighters[i].alive).reverse();
  winners.sort((a, b) => world.scores[b] - world.scores[a] || a - b);
  return [...winners, ...alive, ...out];
};

/** Compact deterministic signature for divergence tests. */
export const worldHash = (world: World): string => {
  let h = 2166136261;
  const mix = (n: number) => {
    h ^= Math.round(n * 100) | 0;
    h = Math.imul(h, 16777619);
  };
  mix(world.frame);
  for (const f of world.fighters) {
    mix(f.x);
    mix(f.y);
    mix(f.vx);
    mix(f.vy);
    mix(f.percent);
    mix(f.stocks);
    mix(f.sf);
    mix(f.state.length);
  }
  for (const p of world.projectiles) {
    mix(p.x);
    mix(p.y);
  }
  return (h >>> 0).toString(16);
};
