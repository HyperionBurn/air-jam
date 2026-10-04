import type { AirJamActionContext } from "@air-jam/sdk";
import type { BotDifficulty } from "../ai/bot-brain";
import type { FighterId, ItemSetting, MatchMode, RosterEntry, StageId } from "../sim/types";

export type MatchPhase = "lobby" | "countdown" | "playing" | "ended";
export type StageChoice = StageId | "random" | "vote";
export type MatchPreset = "standard" | "fastParty";

export interface MatchSettings {
  mode: MatchMode;
  stocks: number;
  timeMinutes: number;
  preset: MatchPreset;
  stage: StageChoice;
  hazards: boolean;
  items: ItemSetting;
  teams: boolean;
  friendlyFire: boolean;
  botCount: number;
  botDifficulty: BotDifficulty;
  /** Event mode: auto-rematch, short rounds, session leaderboard emphasis. */
  eventMode: boolean;
}

export interface PlayerEntry {
  id: string;
  name: string;
  fighterId: FighterId;
  ready: boolean;
  isBot: boolean;
  slot: number;
  team: number;
  connected: boolean;
  stageVote: StageId | null;
  /** A gamepad plugged into the host machine (no phone involved). */
  local?: boolean;
}

export interface HudEntry {
  percent: number;
  stocks: number;
  alive: boolean;
  /** ok | respawning | out */
  status: "ok" | "respawning" | "out";
  score: number;
  kos: number;
  /** Extended fields, only populated when agent/debug telemetry is enabled. */
  debug?: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    state: string;
    move: string | null;
    grounded: boolean;
    invuln: number;
    hitlag: number;
    hitstun: number;
    shield: number;
  };
}

export interface ResultEntry {
  id: string;
  name: string;
  fighterId: FighterId;
  slot: number;
  team: number;
  place: number;
  winner: boolean;
  stocks: number;
  score: number;
  kos: number;
  falls: number;
  selfDestructs: number;
  damageDealt: number;
  damageTaken: number;
  survivalSec: number;
  isBot: boolean;
}

export interface MatchSummary {
  matchId: number;
  winnerIds: string[];
  winnerLabel: string;
  winnerTeam: number;
  reason: "stocks" | "time" | "draw";
  durationSec: number;
  mode: MatchMode;
  teams: boolean;
  stageId: StageId;
  results: ResultEntry[];
}

export interface ScoreboardEntry {
  name: string;
  slot: number;
  wins: number;
  kos: number;
  falls: number;
  damageDealt: number;
  longestSurvivalSec: number;
  matches: number;
}

/** Everything the host needs to build a world; written once at match start. */
export interface MatchSpec {
  matchId: number;
  stageId: StageId;
  seed: number;
  mode: MatchMode;
  stocks: number;
  timeLimitSec: number;
  teams: boolean;
  friendlyFire: boolean;
  items: ItemSetting;
  hazards: boolean;
  kbScale: number;
  botDifficulty: BotDifficulty;
  roster: RosterEntry[];
  botIds: string[];
}

export interface AirBrawlState {
  matchPhase: MatchPhase;
  settings: MatchSettings;
  players: Record<string, PlayerEntry>;
  /** When all humans are ready, the match auto-starts at this wall-clock time. */
  autoStartAtMs: number | null;
  matchSpec: MatchSpec | null;
  matchCounter: number;
  hud: Record<string, HudEntry>;
  matchSummary: MatchSummary | null;
  scoreboard: Record<string, ScoreboardEntry>;
  /** Event mode: wall-clock time of the automatic rematch. */
  rematchAtMs: number | null;
  /** Agent / QA telemetry toggle (adds debug fields to HUD entries). */
  telemetry: boolean;

  actions: {
    syncRoster: (ctx: AirJamActionContext, payload: { controllers: RosterSync[] }) => void;
    /** `playerId` lets the host act for a local gamepad player; ignored for everyone else. */
    setFighter: (ctx: AirJamActionContext, payload: { fighterId: FighterId; playerId?: string }) => void;
    setReady: (ctx: AirJamActionContext, payload: { ready: boolean; playerId?: string }) => void;
    setTeam: (ctx: AirJamActionContext, payload: { team: number; playerId?: string }) => void;
    voteStage: (ctx: AirJamActionContext, payload: { stage: StageId | null; playerId?: string }) => void;
    updateSettings: (ctx: AirJamActionContext, payload: { patch: Partial<MatchSettings> }) => void;
    setBotCount: (ctx: AirJamActionContext, payload: { count: number; difficulty?: BotDifficulty }) => void;
    startMatch: (ctx: AirJamActionContext, payload: { force?: boolean }) => void;
    beginFight: (ctx: AirJamActionContext, payload: undefined) => void;
    updateHud: (ctx: AirJamActionContext, payload: { hud: Record<string, HudEntry> }) => void;
    endMatch: (ctx: AirJamActionContext, payload: { summary: MatchSummary }) => void;
    rematch: (ctx: AirJamActionContext, payload: undefined) => void;
    returnToLobby: (ctx: AirJamActionContext, payload: undefined) => void;
    setTelemetry: (ctx: AirJamActionContext, payload: { enabled: boolean }) => void;
    clearScoreboard: (ctx: AirJamActionContext, payload: undefined) => void;
    /** Agent/QA only: queue deterministic control of a participant (handled by the host loop). */
    agentControl: (ctx: AirJamActionContext, payload: AgentControlPayload) => void;
    /** Agent/QA only: advance the simulation by N ticks synchronously. */
    agentStep: (ctx: AirJamActionContext, payload: { frames: number }) => void;
    /** Agent/QA only: place a fighter / set damage for deterministic scenarios. */
    agentSetup: (ctx: AirJamActionContext, payload: AgentSetupPayload) => void;
  };
}

export interface RosterSync {
  id: string;
  name: string;
  connected: boolean;
  local?: boolean;
}

export interface AgentControlPayload {
  /** Participant to control (defaults to the acting controller). */
  targetId?: string;
  mx?: number;
  my?: number;
  /** Buttons to hold: jump | attack | special | shield. */
  hold?: string[];
  /** Buttons to tap once this tick. */
  tap?: string[];
  /** Ticks to apply (0 = until replaced). */
  frames?: number;
  /** Return to neutral. */
  release?: boolean;
}

export interface AgentSetupPayload {
  targetId?: string;
  percent?: number;
  x?: number;
  y?: number;
  stocks?: number;
  invuln?: number;
}
