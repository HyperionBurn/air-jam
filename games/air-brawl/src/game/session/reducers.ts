import type { AirJamActionContext } from "@air-jam/sdk";
import { FIGHTER_IDS } from "../data/fighters";
import { STAGE_IDS } from "../data/stages";
import type { BotDifficulty } from "../ai/bot-brain";
import type { FighterId, RosterEntry, StageId } from "../sim/types";
import type {
  AirBrawlState,
  HudEntry,
  MatchPreset,
  MatchSettings,
  MatchSpec,
  MatchSummary,
  PlayerEntry,
  RosterSync,
  ScoreboardEntry,
} from "./types";

export const MAX_PARTICIPANTS = 8;
export const AUTO_START_MS = 3200;
export const REMATCH_MS = 14000;

export const PRESETS: Record<MatchPreset, { label: string; stocks: number; kbScale: number; blurb: string }> = {
  standard: { label: "Standard", stocks: 3, kbScale: 1, blurb: "3 stocks, classic launches" },
  fastParty: { label: "Fast Party", stocks: 2, kbScale: 1.22, blurb: "2 stocks, big launches, ~90s rounds" },
};

export const defaultSettings = (): MatchSettings => ({
  mode: "stock",
  stocks: 3,
  timeMinutes: 3,
  preset: "standard",
  stage: "vote",
  hazards: true,
  items: "off",
  teams: false,
  friendlyFire: false,
  botCount: 0,
  botDifficulty: "medium",
  eventMode: true,
});

export const createInitialState = (): Omit<AirBrawlState, "actions"> => ({
  matchPhase: "lobby",
  settings: defaultSettings(),
  players: {},
  autoStartAtMs: null,
  matchSpec: null,
  matchCounter: 0,
  hud: {},
  matchSummary: null,
  scoreboard: {},
  rematchAtMs: null,
  telemetry: false,
});

type State = AirBrawlState;
type Ctx = AirJamActionContext;

const isHost = (ctx: Ctx): boolean => ctx.role === "host";

/* ------------------------------------------------------------------ QUERIES */

export const humansOf = (state: Pick<State, "players">): PlayerEntry[] =>
  Object.values(state.players)
    .filter((p) => !p.isBot)
    .sort((a, b) => a.slot - b.slot);

export const participantsOf = (state: Pick<State, "players">): PlayerEntry[] =>
  Object.values(state.players)
    .filter((p) => p.isBot || p.connected)
    .sort((a, b) => a.slot - b.slot);

/** First connected human (by slot) is the room leader and owns match settings. */
export const leaderIdOf = (state: Pick<State, "players">): string | null =>
  humansOf(state).find((p) => p.connected)?.id ?? null;

const canAdminister = (state: State, ctx: Ctx): boolean => isHost(ctx) || leaderIdOf(state) === ctx.actorId;

export const getReadiness = (
  state: Pick<State, "players">,
): { humans: number; ready: number; participants: number; allReady: boolean; canStart: boolean } => {
  const humans = humansOf(state).filter((p) => p.connected);
  const ready = humans.filter((p) => p.ready).length;
  const participants = participantsOf(state).length;
  return {
    humans: humans.length,
    ready,
    participants,
    allReady: humans.length > 0 && ready === humans.length,
    canStart: humans.length > 0 && participants >= 2,
  };
};

const freeSlot = (players: Record<string, PlayerEntry>): number => {
  const used = new Set(Object.values(players).map((p) => p.slot));
  for (let i = 0; i < MAX_PARTICIPANTS; i += 1) if (!used.has(i)) return i;
  return -1;
};

const leastUsedFighter = (players: Record<string, PlayerEntry>): FighterId => {
  const counts = new Map<FighterId, number>(FIGHTER_IDS.map((id) => [id, 0]));
  for (const p of Object.values(players)) counts.set(p.fighterId, (counts.get(p.fighterId) ?? 0) + 1);
  return FIGHTER_IDS.slice().sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0];
};

const withAutoStart = (state: State, now = Date.now()): State => {
  if (state.matchPhase !== "lobby") {
    return state.autoStartAtMs === null ? state : { ...state, autoStartAtMs: null };
  }
  const r = getReadiness(state);
  const should = r.allReady && r.canStart;
  if (!should) return state.autoStartAtMs === null ? state : { ...state, autoStartAtMs: null };
  return state.autoStartAtMs !== null ? state : { ...state, autoStartAtMs: now + AUTO_START_MS };
};

/** Make bot entries match `settings.botCount` without evicting humans. */
const ensureBots = (state: State): State => {
  const players = { ...state.players };
  const humans = Object.values(players).filter((p) => !p.isBot && (p.connected || state.matchPhase !== "lobby"));
  const maxBots = Math.max(0, MAX_PARTICIPANTS - humans.length);
  const want = Math.min(state.settings.botCount, maxBots);
  const bots = Object.values(players)
    .filter((p) => p.isBot)
    .sort((a, b) => a.slot - b.slot);
  let changed = false;
  for (let i = bots.length - 1; i >= want; i -= 1) {
    delete players[bots[i].id];
    changed = true;
  }
  for (let i = bots.length; i < want; i += 1) {
    const slot = freeSlot(players);
    if (slot < 0) break;
    const id = `bot-${i + 1}`;
    players[id] = {
      id,
      name: `CPU ${i + 1}`,
      fighterId: leastUsedFighter(players),
      ready: true,
      isBot: true,
      slot,
      team: slot % 2,
      connected: true,
      stageVote: null,
    };
    changed = true;
  }
  return changed ? { ...state, players } : state;
};

/* ------------------------------------------------------------------ ROSTER */

export const reduceSyncRoster = (state: State, ctx: Ctx, payload: { controllers: RosterSync[] }): State => {
  if (!isHost(ctx)) return state;
  const players = { ...state.players };
  const seen = new Set<string>();
  for (const c of payload.controllers) {
    seen.add(c.id);
    const existing = players[c.id];
    if (existing) {
      if (existing.name !== c.name || existing.connected !== c.connected) {
        players[c.id] = { ...existing, name: c.name, connected: c.connected };
      }
      continue;
    }
    const slot = freeSlot(players);
    if (slot < 0) continue;
    players[c.id] = {
      id: c.id,
      name: c.name,
      fighterId: leastUsedFighter(players),
      ready: false,
      isBot: false,
      slot,
      team: slot % 2,
      connected: c.connected,
      stageVote: null,
    };
  }
  for (const p of Object.values(players)) {
    if (!p.isBot && !seen.has(p.id)) delete players[p.id];
  }
  const changed =
    Object.keys(players).length !== Object.keys(state.players).length ||
    Object.values(players).some((p) => state.players[p.id] !== p);
  if (!changed) return state;
  return withAutoStart(ensureBots({ ...state, players }));
};

export const reduceSetFighter = (state: State, ctx: Ctx, payload: { fighterId: FighterId }): State => {
  const player = state.players[ctx.actorId];
  if (!player || player.isBot || !FIGHTER_IDS.includes(payload.fighterId)) return state;
  if (state.matchPhase === "countdown" || state.matchPhase === "playing") return state;
  if (state.matchPhase === "lobby" && player.ready) return state;
  if (player.fighterId === payload.fighterId) return state;
  return { ...state, players: { ...state.players, [player.id]: { ...player, fighterId: payload.fighterId } } };
};

export const reduceSetReady = (state: State, ctx: Ctx, payload: { ready: boolean }): State => {
  if (state.matchPhase !== "lobby") return state;
  const player = state.players[ctx.actorId];
  if (!player || player.isBot || player.ready === payload.ready) return state;
  return withAutoStart({ ...state, players: { ...state.players, [player.id]: { ...player, ready: payload.ready } } });
};

export const reduceSetTeam = (state: State, ctx: Ctx, payload: { team: number }): State => {
  if (state.matchPhase !== "lobby") return state;
  const player = state.players[ctx.actorId];
  if (!player || player.isBot || player.ready) return state;
  const team = payload.team === 1 ? 1 : 0;
  if (player.team === team) return state;
  return { ...state, players: { ...state.players, [player.id]: { ...player, team } } };
};

export const reduceVoteStage = (state: State, ctx: Ctx, payload: { stage: StageId | null }): State => {
  const player = state.players[ctx.actorId];
  if (!player || player.isBot) return state;
  if (state.matchPhase === "countdown" || state.matchPhase === "playing") return state;
  const stage = payload.stage && STAGE_IDS.includes(payload.stage) ? payload.stage : null;
  if (player.stageVote === stage) return state;
  return { ...state, players: { ...state.players, [player.id]: { ...player, stageVote: stage } } };
};

/* ---------------------------------------------------------------- SETTINGS */

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;

export const sanitizeSettings = (current: MatchSettings, patch: Partial<MatchSettings>): MatchSettings => {
  const next: MatchSettings = { ...current };
  if (patch.preset && patch.preset in PRESETS) {
    next.preset = patch.preset;
    next.stocks = PRESETS[patch.preset].stocks;
  }
  if (patch.mode === "stock" || patch.mode === "timed") next.mode = patch.mode;
  if (patch.stocks !== undefined) next.stocks = clampInt(patch.stocks, 1, 5, current.stocks);
  if (patch.timeMinutes !== undefined) next.timeMinutes = clampInt(patch.timeMinutes, 1, 5, current.timeMinutes);
  if (patch.stage === "random" || patch.stage === "vote" || (patch.stage && STAGE_IDS.includes(patch.stage))) {
    next.stage = patch.stage;
  }
  if (typeof patch.hazards === "boolean") next.hazards = patch.hazards;
  if (patch.items === "off" || patch.items === "low" || patch.items === "normal" || patch.items === "chaos") {
    next.items = patch.items;
  }
  if (typeof patch.teams === "boolean") next.teams = patch.teams;
  if (typeof patch.friendlyFire === "boolean") next.friendlyFire = patch.friendlyFire;
  if (patch.botCount !== undefined) next.botCount = clampInt(patch.botCount, 0, 7, current.botCount);
  if (patch.botDifficulty === "easy" || patch.botDifficulty === "medium" || patch.botDifficulty === "hard") {
    next.botDifficulty = patch.botDifficulty as BotDifficulty;
  }
  if (typeof patch.eventMode === "boolean") next.eventMode = patch.eventMode;
  return next;
};

export const reduceUpdateSettings = (state: State, ctx: Ctx, payload: { patch: Partial<MatchSettings> }): State => {
  if (state.matchPhase !== "lobby" || !canAdminister(state, ctx)) return state;
  const settings = sanitizeSettings(state.settings, payload.patch ?? {});
  if (JSON.stringify(settings) === JSON.stringify(state.settings)) return state;
  let next: State = { ...state, settings };
  // Switching teams on: balance players alternately; ready flags reset so everyone sees teams.
  if (settings.teams && !state.settings.teams) next = { ...next, players: balanceTeams(next.players) };
  if (settings.botCount !== state.settings.botCount || settings.teams !== state.settings.teams) {
    next = ensureBots(next);
  }
  return withAutoStart(next);
};

export const reduceSetBotCount = (
  state: State,
  ctx: Ctx,
  payload: { count: number; difficulty?: BotDifficulty },
): State => {
  if (state.matchPhase !== "lobby" || !canAdminister(state, ctx)) return state;
  const patch: Partial<MatchSettings> = { botCount: payload.count };
  if (payload.difficulty) patch.botDifficulty = payload.difficulty;
  const settings = sanitizeSettings(state.settings, patch);
  return withAutoStart(ensureBots({ ...state, settings }));
};

const balanceTeams = (players: Record<string, PlayerEntry>): Record<string, PlayerEntry> => {
  const next = { ...players };
  const order = Object.values(players).sort((a, b) => a.slot - b.slot);
  order.forEach((p, i) => {
    next[p.id] = { ...p, team: i % 2 };
  });
  return next;
};

/* ------------------------------------------------------------------ MATCH */

const pickStage = (state: State, seed: number): StageId => {
  const choice = state.settings.stage;
  if (choice !== "random" && choice !== "vote") return choice;
  if (choice === "vote") {
    const tally = new Map<StageId, number>();
    for (const p of participantsOf(state)) if (p.stageVote) tally.set(p.stageVote, (tally.get(p.stageVote) ?? 0) + 1);
    if (tally.size > 0) {
      const best = Math.max(...tally.values());
      const winners = [...tally.entries()].filter(([, n]) => n === best).map(([id]) => id);
      return winners[seed % winners.length];
    }
  }
  return STAGE_IDS[seed % STAGE_IDS.length];
};

const buildMatch = (state: State, now: number): State => {
  const participants = participantsOf(state);
  if (participants.length < 2) return state;
  const counter = state.matchCounter + 1;
  const seed = ((now ^ Math.imul(counter, 2654435761)) >>> 0) || 1;
  let players = state.players;
  if (state.settings.teams) {
    const teams = new Set(participants.map((p) => p.team));
    if (teams.size < 2) players = balanceTeams(players);
  }
  const roster: RosterEntry[] = participantsOf({ players }).map((p, order) => ({
    id: p.id,
    name: p.name,
    fighterId: p.fighterId,
    slot: p.slot,
    team: state.settings.teams ? p.team : order,
  }));
  const preset = PRESETS[state.settings.preset];
  const spec: MatchSpec = {
    matchId: counter,
    stageId: pickStage(state, seed >>> 3),
    seed,
    mode: state.settings.mode,
    stocks: state.settings.stocks,
    timeLimitSec: state.settings.timeMinutes * 60,
    teams: state.settings.teams,
    friendlyFire: state.settings.friendlyFire,
    items: state.settings.items,
    hazards: state.settings.hazards,
    kbScale: preset.kbScale,
    botDifficulty: state.settings.botDifficulty,
    roster,
    botIds: participants.filter((p) => p.isBot).map((p) => p.id),
  };
  const hud: Record<string, HudEntry> = {};
  for (const r of roster) {
    hud[r.id] = { percent: 0, stocks: spec.mode === "timed" ? 0 : spec.stocks, alive: true, status: "ok", score: 0, kos: 0 };
  }
  return {
    ...state,
    players,
    matchPhase: "countdown",
    matchSpec: spec,
    matchCounter: counter,
    hud,
    matchSummary: null,
    autoStartAtMs: null,
    rematchAtMs: null,
  };
};

export const reduceStartMatch = (state: State, ctx: Ctx, payload: { force?: boolean } | undefined): State => {
  if (state.matchPhase !== "lobby") return state;
  const r = getReadiness(state);
  if (!r.canStart) return state;
  const allowed = isHost(ctx) || canAdminister(state, ctx) || r.allReady;
  if (!allowed) return state;
  if (!payload?.force && !isHost(ctx) && !r.allReady && !canAdminister(state, ctx)) return state;
  return buildMatch(state, Date.now());
};

export const reduceBeginFight = (state: State, ctx: Ctx): State => {
  if (!isHost(ctx) || state.matchPhase !== "countdown") return state;
  return { ...state, matchPhase: "playing" };
};

export const reduceUpdateHud = (state: State, ctx: Ctx, payload: { hud: Record<string, HudEntry> }): State => {
  if (!isHost(ctx) || (state.matchPhase !== "playing" && state.matchPhase !== "countdown")) return state;
  if (JSON.stringify(payload.hud) === JSON.stringify(state.hud)) return state;
  return { ...state, hud: payload.hud };
};

export const reduceEndMatch = (state: State, ctx: Ctx, payload: { summary: MatchSummary }): State => {
  if (!isHost(ctx) || (state.matchPhase !== "playing" && state.matchPhase !== "countdown")) return state;
  const scoreboard: Record<string, ScoreboardEntry> = { ...state.scoreboard };
  for (const r of payload.summary.results) {
    if (r.isBot) continue;
    const prev = scoreboard[r.id] ?? {
      name: r.name,
      slot: r.slot,
      wins: 0,
      kos: 0,
      falls: 0,
      damageDealt: 0,
      longestSurvivalSec: 0,
      matches: 0,
    };
    scoreboard[r.id] = {
      name: r.name,
      slot: r.slot,
      wins: prev.wins + (r.winner ? 1 : 0),
      kos: prev.kos + r.kos,
      falls: prev.falls + r.falls,
      damageDealt: prev.damageDealt + r.damageDealt,
      longestSurvivalSec: Math.max(prev.longestSurvivalSec, r.survivalSec),
      matches: prev.matches + 1,
    };
  }
  return {
    ...state,
    matchPhase: "ended",
    matchSummary: payload.summary,
    scoreboard,
    rematchAtMs: state.settings.eventMode ? Date.now() + REMATCH_MS : null,
  };
};

export const reduceRematch = (state: State, ctx: Ctx): State => {
  if (state.matchPhase !== "ended") return state;
  const actor = state.players[ctx.actorId];
  if (!isHost(ctx) && !(actor && !actor.isBot)) return state;
  return buildMatch(ensureBots(state), Date.now());
};

export const reduceReturnToLobby = (state: State, ctx: Ctx): State => {
  if (state.matchPhase === "lobby") return state;
  if (!canAdminister(state, ctx)) return state;
  const players: Record<string, PlayerEntry> = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = p.isBot ? p : { ...p, ready: false };
  }
  return {
    ...state,
    players,
    matchPhase: "lobby",
    matchSpec: null,
    matchSummary: null,
    hud: {},
    autoStartAtMs: null,
    rematchAtMs: null,
  };
};

export const reduceSetTelemetry = (state: State, _ctx: Ctx, payload: { enabled: boolean }): State =>
  state.telemetry === payload.enabled ? state : { ...state, telemetry: payload.enabled };

export const reduceClearScoreboard = (state: State, ctx: Ctx): State =>
  canAdminister(state, ctx) ? { ...state, scoreboard: {} } : state;
