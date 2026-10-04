import type { AirJamActionContext } from "@air-jam/sdk";
import { describe, expect, it } from "vitest";
import { InputEncoder } from "../src/game/net/input-codec";
import {
  AUTO_START_MS,
  createInitialState,
  getReadiness,
  leaderIdOf,
  participantsOf,
  reduceBeginFight,
  reduceEndMatch,
  reduceRematch,
  reduceReturnToLobby,
  reduceSetBotCount,
  reduceSetFighter,
  reduceSetReady,
  reduceStartMatch,
  reduceSyncRoster,
  reduceUpdateSettings,
  reduceVoteStage,
  sanitizeSettings,
  defaultSettings,
} from "../src/game/session/reducers";
import { MatchRunner } from "../src/game/session/match-runner";
import type { AirBrawlState, MatchSpec, RosterSync } from "../src/game/session/types";
import { BTN } from "../src/game/sim";

const base = (): AirBrawlState => ({ ...createInitialState(), actions: {} as AirBrawlState["actions"] });
const host = { role: "host", actorId: "host" } as unknown as AirJamActionContext;
const as = (id: string) => ({ role: "controller", actorId: id }) as unknown as AirJamActionContext;
const roster = (...ids: string[]): RosterSync[] => ids.map((id) => ({ id, name: id.toUpperCase(), connected: true }));

const lobbyWith = (...ids: string[]): AirBrawlState => reduceSyncRoster(base(), host, { controllers: roster(...ids) });

describe("roster", () => {
  it("assigns stable slots, varied fighters, and a leader", () => {
    const s = lobbyWith("a", "b", "c");
    expect(Object.values(s.players).map((p) => p.slot).sort()).toEqual([0, 1, 2]);
    expect(new Set(Object.values(s.players).map((p) => p.fighterId)).size).toBe(3);
    expect(leaderIdOf(s)).toBe("a");
  });

  it("only the host may sync the roster", () => {
    const s = reduceSyncRoster(base(), as("a"), { controllers: roster("a") });
    expect(Object.keys(s.players)).toHaveLength(0);
  });

  it("keeps a disconnected player's slot until they are dropped, and passes leadership on", () => {
    let s = lobbyWith("a", "b");
    s = reduceSyncRoster(s, host, { controllers: [{ id: "a", name: "A", connected: false }, ...roster("b")] });
    expect(s.players.a.connected).toBe(false);
    expect(s.players.a.slot).toBe(0);
    expect(leaderIdOf(s)).toBe("b");
    expect(getReadiness(s).humans).toBe(1);
    s = reduceSyncRoster(s, host, { controllers: roster("b") });
    expect(s.players.a).toBeUndefined();
  });

  it("caps at 8 participants", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const s = lobbyWith(...ids);
    expect(Object.keys(s.players)).toHaveLength(8);
  });
});

describe("lobby flow", () => {
  it("auto-starts only when every connected human is ready and there are ≥ 2 participants", () => {
    let s = lobbyWith("a");
    s = reduceSetReady(s, as("a"), { ready: true });
    expect(s.autoStartAtMs).toBeNull(); // solo human, no opponent
    s = reduceSetBotCount(s, as("a"), { count: 1 });
    expect(s.autoStartAtMs).not.toBeNull();
    expect((s.autoStartAtMs ?? 0) - Date.now()).toBeGreaterThan(AUTO_START_MS - 500);
    s = reduceSetReady(s, as("a"), { ready: false });
    expect(s.autoStartAtMs).toBeNull();
  });

  it("locks the fighter while ready and lets the player change it when un-ready", () => {
    let s = lobbyWith("a", "b");
    const before = s.players.a.fighterId;
    const other = before === "nova" ? "volt" : "nova";
    s = reduceSetReady(s, as("a"), { ready: true });
    expect(reduceSetFighter(s, as("a"), { fighterId: other }).players.a.fighterId).toBe(before);
    s = reduceSetReady(s, as("a"), { ready: false });
    expect(reduceSetFighter(s, as("a"), { fighterId: other }).players.a.fighterId).toBe(other);
  });

  it("only the leader may change settings; values are sanitised", () => {
    let s = lobbyWith("a", "b");
    expect(reduceUpdateSettings(s, as("b"), { patch: { stocks: 5 } }).settings.stocks).toBe(3);
    s = reduceUpdateSettings(s, as("a"), { patch: { stocks: 99, botCount: -3, items: "chaos" } });
    expect(s.settings.stocks).toBe(5);
    expect(s.settings.botCount).toBe(0);
    expect(s.settings.items).toBe("chaos");
    expect(sanitizeSettings(defaultSettings(), { stage: "nonsense" as never }).stage).toBe("vote");
  });

  it("fast-party preset applies its stock count", () => {
    const s = sanitizeSettings(defaultSettings(), { preset: "fastParty" });
    expect(s.stocks).toBe(2);
  });

  it("bots fill empty slots but never evict humans", () => {
    let s = lobbyWith("a", "b", "c", "d", "e");
    s = reduceSetBotCount(s, host, { count: 7 });
    expect(participantsOf(s)).toHaveLength(8);
    expect(Object.values(s.players).filter((p) => !p.isBot)).toHaveLength(5);
  });

  it("stage voting tallies and breaks ties deterministically", () => {
    let s = lobbyWith("a", "b", "c");
    s = reduceVoteStage(s, as("a"), { stage: "foundry" });
    s = reduceVoteStage(s, as("b"), { stage: "foundry" });
    s = reduceVoteStage(s, as("c"), { stage: "skyline-rush" });
    const started = reduceStartMatch(s, host, { force: true });
    expect(started.matchSpec?.stageId).toBe("foundry");
    expect(started.matchPhase).toBe("countdown");
  });

  it("teams: balances alternately and keeps team ids in the spec", () => {
    let s = lobbyWith("a", "b", "c", "d");
    s = reduceUpdateSettings(s, as("a"), { patch: { teams: true } });
    expect(Object.values(s.players).map((p) => p.team).sort()).toEqual([0, 0, 1, 1]);
    const m = reduceStartMatch(s, host, { force: true });
    expect(m.matchSpec?.teams).toBe(true);
    expect(new Set(m.matchSpec?.roster.map((r) => r.team))).toEqual(new Set([0, 1]));
  });

  it("cannot start with fewer than two fighters", () => {
    const s = lobbyWith("a");
    expect(reduceStartMatch(s, host, { force: true }).matchPhase).toBe("lobby");
  });
});

describe("match lifecycle", () => {
  const started = (): AirBrawlState => {
    let s = lobbyWith("a", "b");
    s = reduceUpdateSettings(s, as("a"), { patch: { eventMode: true } });
    return reduceStartMatch(s, host, { force: true });
  };
  const summary = (s: AirBrawlState) => ({
    matchId: s.matchCounter,
    winnerIds: ["a"],
    winnerLabel: "A",
    winnerTeam: 0,
    reason: "stocks" as const,
    durationSec: 61,
    mode: "stock" as const,
    teams: false,
    stageId: "proving-ground" as const,
    results: [
      { id: "a", name: "A", fighterId: "nova" as const, slot: 0, team: 0, place: 1, winner: true, stocks: 2, score: 0, kos: 2, falls: 1, selfDestructs: 0, damageDealt: 180, damageTaken: 90, survivalSec: 61, isBot: false },
      { id: "b", name: "B", fighterId: "volt" as const, slot: 1, team: 1, place: 2, winner: false, stocks: 0, score: 0, kos: 1, falls: 3, selfDestructs: 1, damageDealt: 90, damageTaken: 180, survivalSec: 44, isBot: false },
    ],
  });

  it("countdown → playing → ended with the session leaderboard accumulating", () => {
    let s = started();
    expect(s.matchPhase).toBe("countdown");
    expect(reduceBeginFight(s, as("a")).matchPhase).toBe("countdown"); // only the host
    s = reduceBeginFight(s, host);
    expect(s.matchPhase).toBe("playing");
    s = reduceEndMatch(s, host, { summary: summary(s) });
    expect(s.matchPhase).toBe("ended");
    expect(s.scoreboard.a.wins).toBe(1);
    expect(s.scoreboard.b.wins).toBe(0);
    expect(s.rematchAtMs).not.toBeNull();
    // Rematch keeps accumulating.
    s = reduceRematch(s, as("a"));
    expect(s.matchPhase).toBe("countdown");
    expect(s.matchSpec?.matchId).toBe(2);
    s = reduceBeginFight(s, host);
    s = reduceEndMatch(s, host, { summary: summary(s) });
    expect(s.scoreboard.a.wins).toBe(2);
    expect(s.scoreboard.a.matches).toBe(2);
  });

  it("bots never appear on the human leaderboard", () => {
    let s = reduceSetBotCount(lobbyWith("a"), as("a"), { count: 1 });
    s = reduceStartMatch(s, host, { force: true });
    s = reduceBeginFight(s, host);
    const sum = summary(s);
    sum.results[1] = { ...sum.results[1], id: "bot-1", isBot: true };
    s = reduceEndMatch(s, host, { summary: sum });
    expect(Object.keys(s.scoreboard)).toEqual(["a"]);
  });

  it("returning to the lobby resets ready flags but keeps the scoreboard", () => {
    let s = started();
    s = reduceBeginFight(s, host);
    s = reduceEndMatch(s, host, { summary: summary(s) });
    s = reduceReturnToLobby(s, as("a"));
    expect(s.matchPhase).toBe("lobby");
    expect(Object.values(s.players).every((p) => !p.ready)).toBe(true);
    expect(s.scoreboard.a.wins).toBe(1);
    expect(s.matchSpec).toBeNull();
  });

  it("non-leaders cannot return everyone to the lobby", () => {
    let s = started();
    s = reduceBeginFight(s, host);
    s = reduceEndMatch(s, host, { summary: summary(s) });
    expect(reduceReturnToLobby(s, as("b")).matchPhase).toBe("ended");
  });

  it("ignores stray actions in the wrong phase", () => {
    const s = started();
    expect(reduceSetReady(s, as("a"), { ready: true })).toBe(s);
    expect(reduceUpdateSettings(s, as("a"), { patch: { stocks: 1 } })).toBe(s);
    expect(reduceRematch(s, as("a"))).toBe(s);
  });
});

describe("MatchRunner", () => {
  const spec = (): MatchSpec => {
    let s = lobbyWith("a");
    s = reduceSetBotCount(s, as("a"), { count: 1 });
    return reduceStartMatch(s, host, { force: true }).matchSpec as MatchSpec;
  };
  const noInput = () => undefined;

  it("a human with no packets is neutral; a bot acts on its own", () => {
    const runner = new MatchRunner(spec(), { countdownFrames: 0 });
    for (let i = 0; i < 120; i += 1) {
      const inputs = runner.buildInputs(noInput, i * 16.7, new Set());
      expect(inputs[0]).toMatchObject({ mx: 0, held: 0, taps: 0 });
      runner.stepOnce(inputs);
    }
    expect(runner.humanIds).toEqual(["a"]);
  });

  it("clears input for a disconnected controller immediately", () => {
    const runner = new MatchRunner(spec(), { countdownFrames: 0 });
    const enc = new InputEncoder();
    enc.setStick(1, 0);
    enc.press(BTN.SHIELD);
    let now = 0;
    const wire = enc.snapshot(0);
    runner.buildInputs(() => wire, now, new Set());
    expect(runner.buildInputs(() => wire, (now += 16), new Set())[0].mx).toBe(1);
    expect(runner.buildInputs(() => wire, (now += 16), new Set(["a"]))[0]).toMatchObject({ mx: 0, held: 0 });
  });

  it("agent control drives a fighter deterministically, then releases", () => {
    const runner = new MatchRunner(spec(), { countdownFrames: 0 });
    runner.control("a", { mx: 1, frames: 30 });
    const startX = runner.world.fighters[0].x;
    for (let i = 0; i < 30; i += 1) runner.stepOnce(runner.buildInputs(noInput, i * 16, new Set()));
    expect(runner.world.fighters[0].x).toBeGreaterThan(startX + 40);
    const after = runner.buildInputs(noInput, 1000, new Set());
    expect(after[0].mx).toBe(0);
  });

  it("agent setup places fighters and damage for scenarios", () => {
    const runner = new MatchRunner(spec(), { countdownFrames: 0 });
    runner.setup("a", { percent: 120, x: 200, stocks: 1 });
    const f = runner.world.fighters[0];
    expect(f.percent).toBe(120);
    expect(f.x).toBe(200);
    expect(f.stocks).toBe(1);
    expect(runner.hud(true).a.percent).toBe(120);
    expect(runner.hud(true).a.debug).toBeDefined();
    expect(runner.hud(false).a.debug).toBeUndefined();
  });

  it("simulates to a result and produces a ranked summary", () => {
    const runner = new MatchRunner({ ...spec(), stocks: 1 }, { countdownFrames: 0 });
    runner.control("a", { mx: 1 });
    for (let i = 0; i < 60 * 150 && runner.world.phase !== "over"; i += 1) runner.stepOnce(runner.buildInputs(noInput, i * 16, new Set()));
    expect(runner.world.phase).toBe("over");
    const sum = runner.summary();
    expect(sum.results).toHaveLength(2);
    expect(sum.results[0].place).toBe(1);
    expect(sum.results.filter((r) => r.winner).length).toBeGreaterThanOrEqual(1);
  });
});
