import { BotBrain, type BotDifficulty } from "../src/game/ai/bot-brain";
import {
  createWorld,
  rankFighters,
  stepWorld,
  type FighterId,
  type InputFrame,
  type MatchConfig,
  type World,
} from "../src/game/sim";
import { roster } from "./helpers";

export interface BotMatchResult {
  world: World;
  frames: number;
  finished: boolean;
  winner: number | null;
  ranking: number[];
}

export interface BotMatchOptions {
  fighters: FighterId[];
  difficulty?: BotDifficulty;
  config?: Partial<MatchConfig>;
  maxFrames?: number;
  seed?: number;
  teams?: number[];
  onTick?: (world: World) => void;
}

export const runBotMatch = (options: BotMatchOptions): BotMatchResult => {
  const entries = roster(...options.fighters);
  if (options.teams) entries.forEach((e, i) => (e.team = options.teams![i]));
  const world = createWorld(
    { countdownFrames: 0, hazards: true, seed: options.seed ?? 7, ...options.config },
    entries,
  );
  const brain = new BotBrain(options.difficulty ?? "medium", options.seed ?? 7);
  const maxFrames = options.maxFrames ?? 60 * 60 * 5;
  let frames = 0;
  const inputs: InputFrame[] = [];
  while (world.phase !== "over" && frames < maxFrames) {
    for (let i = 0; i < world.fighters.length; i += 1) inputs[i] = brain.think(world, i);
    stepWorld(world, inputs);
    options.onTick?.(world);
    frames += 1;
  }
  return {
    world,
    frames,
    finished: world.phase === "over",
    winner: world.winners[0] ?? null,
    ranking: rankFighters(world),
  };
};
