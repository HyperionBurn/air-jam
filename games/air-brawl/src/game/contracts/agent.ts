/**
 * Semantic agent contract. Lets MCP game sessions (and tests) drive Air Brawl
 * through meaningful actions — pick a fighter, ready up, start, steer a fighter,
 * advance the simulation, set damage — and assert on authoritative state without
 * brittle DOM automation. Everything routes through the same store and match
 * runner the real phones use.
 */
import {
  agentAction,
  agentActionInput,
  agentStore,
  defineAirJamAgentContract,
  defineAirJamAgentStores,
} from "@air-jam/sdk";
import { z } from "zod";
import { FIGHTER_IDS } from "../data/fighters";
import { STAGE_IDS } from "../data/stages";
import { getReadiness, leaderIdOf } from "../session/reducers";
import type { AirBrawlState } from "../session/types";

const stores = defineAirJamAgentStores({
  default: agentStore<AirBrawlState>(),
});

const FIGHTER_VALUES = FIGHTER_IDS as unknown as readonly [string, ...string[]];

const controlSchema = z.object({
  targetId: z.string().optional(),
  mx: z.number().min(-1).max(1).optional(),
  my: z.number().min(-1).max(1).optional(),
  hold: z.array(z.enum(["jump", "attack", "special", "shield"])).optional(),
  tap: z.array(z.enum(["jump", "attack", "special", "shield"])).optional(),
  frames: z.number().int().min(0).max(3600).optional(),
  release: z.boolean().optional(),
});

const settingsSchema = z
  .object({
    mode: z.enum(["stock", "timed"]),
    stocks: z.number().int(),
    timeMinutes: z.number().int(),
    preset: z.enum(["standard", "fastParty"]),
    stage: z.enum(["vote", "random", ...(STAGE_IDS as [string, ...string[]])]),
    hazards: z.boolean(),
    items: z.enum(["off", "low", "normal", "chaos"]),
    teams: z.boolean(),
    friendlyFire: z.boolean(),
    botCount: z.number().int(),
    botDifficulty: z.enum(["easy", "medium", "hard"]),
    eventMode: z.boolean(),
  })
  .partial();

const botsSchema = z.object({
  count: z.number().int().min(0).max(7),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
});

const setupSchema = z.object({
  targetId: z.string().optional(),
  percent: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  stocks: z.number().int().optional(),
  invuln: z.number().int().optional(),
});

export const agentContract = defineAirJamAgentContract({
  stores,
  snapshotDescription:
    "Air Brawl state: match phase, lobby roster (fighter / ready / team / bot), settings, per-fighter HUD (percent, stocks, status; plus position/velocity/state/move when telemetry is enabled), results and the session leaderboard.",
  projectSnapshot: (context) => {
    const state = context.stores.default;
    if (!state) return { matchPhase: "unavailable", summary: "Replicated Air Brawl store is not available yet." };
    const players = Object.values(state.players)
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        id: p.id,
        name: p.name,
        fighter: p.fighterId,
        ready: p.ready,
        isBot: p.isBot,
        connected: p.connected,
        slot: p.slot,
        team: p.team,
        stageVote: p.stageVote,
      }));
    const readiness = getReadiness(state);
    return {
      matchPhase: state.matchPhase,
      selfId: context.controllerId,
      leaderId: leaderIdOf(state),
      settings: { ...state.settings },
      players,
      readiness,
      autoStartInMs: state.autoStartAtMs ? Math.max(0, state.autoStartAtMs - Date.now()) : null,
      match: state.matchSpec
        ? {
            matchId: state.matchSpec.matchId,
            stage: state.matchSpec.stageId,
            mode: state.matchSpec.mode,
            stocks: state.matchSpec.stocks,
            teams: state.matchSpec.teams,
            fighters: state.matchSpec.roster.map((r) => ({ id: r.id, fighter: r.fighterId, team: r.team, slot: r.slot })),
          }
        : null,
      hud: state.hud,
      matchSummary: state.matchSummary,
      scoreboard: state.scoreboard,
      rematchInMs: state.rematchAtMs ? Math.max(0, state.rematchAtMs - Date.now()) : null,
      telemetry: state.telemetry,
    };
  },
  actions: {
    set_fighter: agentAction.participant(
      { actionName: "setFighter" },
      {
        input: agentActionInput.enum(FIGHTER_VALUES, { payloadDescription: `Fighter id: ${FIGHTER_IDS.join(" | ")}` }),
        toPayload: (fighterId) => ({ fighterId }),
        description: "Choose this player's fighter (unlocked fighters only; clears nothing else).",
        resultDescription: "Fighter selection updated.",
      },
    ),
    set_ready: agentAction.participant(
      { actionName: "setReady" },
      {
        input: agentActionInput.boolean({ payloadDescription: "Ready flag" }),
        toPayload: (ready) => ({ ready }),
        description: "Ready / un-ready this player. When every human is ready the match auto-starts after a short grace period.",
        resultDescription: "Ready state updated.",
      },
    ),
    set_team: agentAction.participant(
      { actionName: "setTeam" },
      {
        input: agentActionInput.number({ payloadDescription: "Team index 0 or 1" }),
        toPayload: (team) => ({ team }),
        description: "Choose a team (team battle only).",
      },
    ),
    vote_stage: agentAction.participant(
      { actionName: "voteStage" },
      {
        input: agentActionInput.string({ payloadDescription: `Stage id (${STAGE_IDS.join(" | ")}) or empty to clear` }),
        toPayload: (stage) => ({ stage: STAGE_IDS.includes(stage as never) ? stage : null }),
        description: "Vote for the next stage (when stage selection is 'vote').",
      },
    ),
    start_match: agentAction.participant(
      { actionName: "startMatch" },
      {
        input: agentActionInput.none({ description: "Start immediately (leader only)." }),
        toPayload: () => ({ force: true }),
        description: "Start the match now. Requires the room leader and at least two fighters (humans + bots).",
        resultDescription: "Match enters countdown.",
      },
    ),
    rematch: agentAction.participant(
      { actionName: "rematch" },
      {
        input: agentActionInput.none(),
        toPayload: () => ({}),
        description: "Start another match with the same roster (ended phase).",
      },
    ),
    return_to_lobby: agentAction.participant(
      { actionName: "returnToLobby" },
      {
        input: agentActionInput.none(),
        toPayload: () => ({}),
        description: "Return everyone to the lobby (leader only).",
      },
    ),
    control: agentAction.participant(
      { actionName: "agentControl" },
      {
        input: agentActionInput.zod(controlSchema, {
          payloadDescription:
            "{ targetId?, mx?, my? (-1..1, +y is down), hold?: ['jump'|'attack'|'special'|'shield'], tap?: [...], frames?: ticks to apply (0 = until replaced), release?: true }",
        }),
        description:
          "Steer a fighter deterministically: set stick, hold buttons, tap buttons for one tick. Overrides the real controller until released.",
        resultDescription: "Control override queued for the host loop.",
      },
    ),
    update_settings: agentAction.host(
      { actionName: "updateSettings" },
      {
        input: agentActionInput.zod(settingsSchema, { payloadDescription: "Partial match settings object" }),
        toPayload: (patch) => ({ patch }),
        description: "Change match settings in the lobby.",
      },
    ),
    set_bots: agentAction.host(
      { actionName: "setBotCount" },
      {
        input: agentActionInput.zod(botsSchema, { payloadDescription: "{ count: 0-7, difficulty?: easy|medium|hard }" }),
        description: "Add or remove CPU fighters.",
      },
    ),
    set_telemetry: agentAction.host(
      { actionName: "setTelemetry" },
      {
        input: agentActionInput.boolean({ payloadDescription: "Include position / velocity / state in the HUD snapshot" }),
        toPayload: (enabled) => ({ enabled }),
        description: "Toggle verbose per-fighter telemetry in the snapshot (for agent assertions).",
      },
    ),
    step: agentAction.host(
      { actionName: "agentStep" },
      {
        input: agentActionInput.number({ payloadDescription: "Simulation ticks to advance (60 = one second, max 1200)" }),
        toPayload: (frames) => ({ frames }),
        description: "Advance the authoritative simulation by N fixed ticks right now, then refresh the HUD snapshot.",
        resultDescription: "Simulation advanced; read the snapshot for damage / stocks / phase.",
      },
    ),
    setup_fighter: agentAction.host(
      { actionName: "agentSetup" },
      {
        input: agentActionInput.zod(setupSchema, { payloadDescription: "{ targetId?, percent?, x?, y?, stocks?, invuln? }" }),
        description: "Place a fighter / set damage percent / stocks for a deterministic scenario.",
      },
    ),
  },
});
