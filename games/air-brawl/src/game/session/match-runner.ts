import { BotBrain } from "../ai/bot-brain";
import { InputDecoder, type WireInput } from "../net/input-codec";
import { BTN, type InputFrame, type MatchConfig, type SimEvent, type World } from "../sim/types";
import { createWorld, rankFighters, stepWorld } from "../sim/world";
import { TEAM_STYLES } from "../view/palette";
import type { AgentControlPayload, AgentSetupPayload, HudEntry, MatchSpec, MatchSummary, ResultEntry } from "./types";

interface AgentControl {
  mx: number;
  my: number;
  held: number;
  tapOnce: number;
  /** Ticks remaining (-1 = until replaced). */
  frames: number;
}

const BUTTON_NAMES: Record<string, number> = {
  jump: BTN.JUMP,
  attack: BTN.ATTACK,
  special: BTN.SPECIAL,
  shield: BTN.SHIELD,
};

const bitsOf = (names: string[] | undefined): number =>
  (names ?? []).reduce((acc, n) => acc | (BUTTON_NAMES[n.toLowerCase()] ?? 0), 0);

/**
 * Owns one match: the sim world, bot brains, per-controller input decoders and
 * agent overrides. Framework-free so the host hook, the semantic agent surface
 * and the headless tests all drive the very same code path.
 */
export class MatchRunner {
  readonly world: World;
  readonly spec: MatchSpec;
  private readonly brain: BotBrain;
  private readonly decoders = new Map<string, InputDecoder>();
  private readonly idToIndex = new Map<string, number>();
  private readonly agent = new Map<string, AgentControl>();
  private readonly inputs: InputFrame[] = [];
  private slowAcc = 0;
  private readonly bots: Set<string>;

  constructor(spec: MatchSpec, options: { countdownFrames?: number } = {}) {
    this.spec = spec;
    const config: Partial<MatchConfig> = {
      stageId: spec.stageId,
      mode: spec.mode,
      stocks: spec.stocks,
      timeLimitSec: spec.timeLimitSec,
      teams: spec.teams,
      friendlyFire: spec.friendlyFire,
      items: spec.items,
      hazards: spec.hazards,
      kbScale: spec.kbScale,
      seed: spec.seed,
      ...(options.countdownFrames !== undefined ? { countdownFrames: options.countdownFrames } : {}),
    };
    this.world = createWorld(config, spec.roster);
    this.brain = new BotBrain(spec.botDifficulty, spec.seed);
    this.bots = new Set(spec.botIds);
    spec.roster.forEach((entry, index) => {
      this.idToIndex.set(entry.id, index);
      this.decoders.set(entry.id, new InputDecoder());
      this.inputs.push({ mx: 0, my: 0, held: 0, taps: 0 });
    });
  }

  indexOf(id: string): number | undefined {
    return this.idToIndex.get(id);
  }

  decoder(id: string): InputDecoder | undefined {
    return this.decoders.get(id);
  }

  /** Ids of human participants (controllers). */
  get humanIds(): string[] {
    return this.spec.roster.filter((r) => !this.bots.has(r.id)).map((r) => r.id);
  }

  resetDecoder(id: string): void {
    this.decoders.get(id)?.reset();
  }

  /** Build this tick's inputs: humans from the wire, bots from brains, agent overrides on top. */
  buildInputs(read: (id: string) => WireInput | undefined, nowMs: number, offline: ReadonlySet<string>): InputFrame[] {
    const world = this.world;
    for (let i = 0; i < world.fighters.length; i += 1) {
      const id = world.fighters[i].id;
      const out = this.inputs[i];
      const override = this.agent.get(id);
      if (override) {
        out.mx = override.mx;
        out.my = override.my;
        out.held = override.held | override.tapOnce;
        out.taps = override.tapOnce;
        out.flick = 0;
        override.tapOnce = 0;
        if (override.frames > 0) {
          override.frames -= 1;
          if (override.frames === 0) this.agent.delete(id);
        }
        continue;
      }
      if (this.bots.has(id)) {
        const b = this.brain.think(world, i);
        out.mx = b.mx;
        out.my = b.my;
        out.held = b.held;
        out.taps = b.taps;
        out.flick = 0;
        continue;
      }
      const decoder = this.decoders.get(id);
      if (!decoder || offline.has(id)) {
        out.mx = 0;
        out.my = 0;
        out.held = 0;
        out.taps = 0;
        out.flick = 0;
        decoder?.reset();
        continue;
      }
      const frame = decoder.read(read(id), nowMs);
      out.mx = frame.mx;
      out.my = frame.my;
      out.held = frame.held;
      out.taps = frame.taps;
      out.flick = frame.flick ?? 0;
    }
    return this.inputs;
  }

  /**
   * Advance with time dilation: sim slow-motion is implemented by stepping on a
   * fraction of host ticks. Returns the events of the tick actually simulated.
   */
  advance(inputs: InputFrame[]): SimEvent[] | null {
    this.slowAcc += this.world.timeScale;
    if (this.slowAcc < 1) return null;
    this.slowAcc -= 1;
    stepWorld(this.world, inputs);
    return this.world.events;
  }

  /** Deterministic step (agents / tests): ignores time dilation. */
  stepOnce(inputs: InputFrame[]): SimEvent[] {
    stepWorld(this.world, inputs);
    return this.world.events;
  }

  /* ------------------------------------------------------------------ AGENT */

  control(actorId: string, payload: AgentControlPayload): void {
    const id = payload.targetId ?? actorId;
    if (!this.idToIndex.has(id)) return;
    if (payload.release) {
      this.agent.delete(id);
      return;
    }
    const prev = this.agent.get(id);
    this.agent.set(id, {
      mx: payload.mx ?? prev?.mx ?? 0,
      my: payload.my ?? prev?.my ?? 0,
      held: payload.hold ? bitsOf(payload.hold) : (prev?.held ?? 0),
      tapOnce: (prev?.tapOnce ?? 0) | bitsOf(payload.tap),
      frames: payload.frames ?? -1,
    });
  }

  setup(actorId: string, payload: AgentSetupPayload): void {
    const id = payload.targetId ?? actorId;
    const index = this.idToIndex.get(id);
    if (index === undefined) return;
    const f = this.world.fighters[index];
    if (payload.percent !== undefined) f.percent = Math.max(0, payload.percent);
    if (payload.x !== undefined) {
      f.x = payload.x;
      f.px = payload.x;
    }
    if (payload.y !== undefined) {
      f.y = payload.y;
      f.py = payload.y;
      f.grounded = false;
      f.platform = -1;
    }
    if (payload.stocks !== undefined) f.stocks = Math.max(1, Math.round(payload.stocks));
    if (payload.invuln !== undefined) f.invuln = Math.max(0, Math.round(payload.invuln));
  }

  /* -------------------------------------------------------------- SNAPSHOTS */

  hud(telemetry: boolean): Record<string, HudEntry> {
    const out: Record<string, HudEntry> = {};
    const timed = this.spec.mode === "timed";
    for (const f of this.world.fighters) {
      const stats = this.world.stats[f.index];
      const entry: HudEntry = {
        percent: Math.round(f.percent),
        stocks: timed ? 0 : f.stocks,
        alive: f.alive,
        status: !f.alive ? "out" : f.state === "respawn" ? "respawning" : "ok",
        score: this.world.scores[f.index],
        kos: stats.kos,
      };
      if (telemetry) {
        entry.debug = {
          x: Math.round(f.x),
          y: Math.round(f.y),
          vx: Math.round(f.vx * 10) / 10,
          vy: Math.round(f.vy * 10) / 10,
          state: f.state,
          move: f.moveId,
          grounded: f.grounded,
          invuln: f.invuln,
          hitlag: f.hitlag,
          hitstun: f.hitstun,
          shield: Math.round(f.shield),
        };
      }
      out[f.id] = entry;
    }
    return out;
  }

  summary(): MatchSummary {
    const world = this.world;
    const ranking = rankFighters(world);
    const results: ResultEntry[] = ranking.map((index, i) => {
      const f = world.fighters[index];
      const stats = world.stats[index];
      return {
        id: f.id,
        name: f.name,
        fighterId: f.def.id,
        slot: f.slot,
        team: f.team,
        place: i + 1,
        winner: world.winners.includes(index),
        stocks: Math.max(0, f.stocks),
        score: world.scores[index],
        kos: stats.kos,
        falls: stats.falls,
        selfDestructs: stats.selfDestructs,
        damageDealt: Math.round(stats.damageDealt),
        damageTaken: Math.round(stats.damageTaken),
        survivalSec: Math.round(Math.max(stats.longestSurvival, f.alive ? f.lifeFrames : 0) / 60),
        isBot: this.bots.has(f.id),
      };
    });
    const winnerNames = world.winners.map((i) => world.fighters[i].name);
    const label = this.spec.teams
      ? (TEAM_STYLES[world.winnerTeam % TEAM_STYLES.length]?.name ?? "Team")
      : winnerNames.length
        ? winnerNames.join(" & ")
        : "Nobody";
    return {
      matchId: this.spec.matchId,
      winnerIds: world.winners.map((i) => world.fighters[i].id),
      winnerLabel: world.endReason === "draw" || world.winners.length === 0 ? "Draw" : label,
      winnerTeam: world.winnerTeam,
      reason: world.endReason ?? "stocks",
      durationSec: Math.round(world.matchFrame / 60),
      mode: this.spec.mode,
      teams: this.spec.teams,
      stageId: this.spec.stageId,
      results,
    };
  }
}
