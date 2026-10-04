/**
 * Replicated match store — the "state lane". Host-authoritative, small, and
 * replayable on reconnect: lobby roster, settings, match phase, a throttled HUD
 * snapshot, results, and the session leaderboard. Hot simulation state never
 * goes through here.
 */
import { createAirJamStore } from "@air-jam/sdk";
import {
  createInitialState,
  reduceBeginFight,
  reduceClearScoreboard,
  reduceEndMatch,
  reduceRematch,
  reduceReturnToLobby,
  reduceSetBotCount,
  reduceSetFighter,
  reduceSetReady,
  reduceSetTeam,
  reduceSetTelemetry,
  reduceStartMatch,
  reduceSyncRoster,
  reduceUpdateHud,
  reduceUpdateSettings,
  reduceVoteStage,
} from "./reducers";
import type { AirBrawlState } from "./types";

export const useMatchStore = createAirJamStore<AirBrawlState>((set) => ({
  ...createInitialState(),
  actions: {
    syncRoster: (ctx, payload) => set((s) => reduceSyncRoster(s, ctx, payload)),
    setFighter: (ctx, payload) => set((s) => reduceSetFighter(s, ctx, payload)),
    setReady: (ctx, payload) => set((s) => reduceSetReady(s, ctx, payload)),
    setTeam: (ctx, payload) => set((s) => reduceSetTeam(s, ctx, payload)),
    voteStage: (ctx, payload) => set((s) => reduceVoteStage(s, ctx, payload)),
    updateSettings: (ctx, payload) => set((s) => reduceUpdateSettings(s, ctx, payload)),
    setBotCount: (ctx, payload) => set((s) => reduceSetBotCount(s, ctx, payload)),
    startMatch: (ctx, payload) => set((s) => reduceStartMatch(s, ctx, payload)),
    beginFight: (ctx) => set((s) => reduceBeginFight(s, ctx)),
    updateHud: (ctx, payload) => set((s) => reduceUpdateHud(s, ctx, payload)),
    endMatch: (ctx, payload) => set((s) => reduceEndMatch(s, ctx, payload)),
    rematch: (ctx) => set((s) => reduceRematch(s, ctx)),
    returnToLobby: (ctx) => set((s) => reduceReturnToLobby(s, ctx)),
    setTelemetry: (ctx, payload) => set((s) => reduceSetTelemetry(s, ctx, payload)),
    clearScoreboard: (ctx) => set((s) => reduceClearScoreboard(s, ctx)),
    // Agent/QA actions carry no replicated state change; the host loop reacts via
    // `useMatchStore.useHostActionListener` (see host/hooks).
    agentControl: () => undefined,
    agentStep: () => undefined,
    agentSetup: () => undefined,
  },
}));
