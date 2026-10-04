import {
  BTN,
  createWorld,
  stepWorld,
  type FighterId,
  type InputFrame,
  type MatchConfig,
  type RosterEntry,
  type World,
} from "../src/game/sim";

export const input = (partial: Partial<InputFrame> = {}): InputFrame => ({
  mx: 0,
  my: 0,
  held: 0,
  taps: 0,
  ...partial,
});

/** Press = held + tap for one tick. */
export const press = (bits: number, extra: Partial<InputFrame> = {}): InputFrame =>
  input({ held: bits, taps: bits, ...extra });
export const hold = (bits: number, extra: Partial<InputFrame> = {}): InputFrame =>
  input({ held: bits, taps: 0, ...extra });

export const roster = (...fighters: FighterId[]): RosterEntry[] =>
  fighters.map((fighterId, slot) => ({
    id: `p${slot}`,
    name: `P${slot + 1}`,
    fighterId,
    slot,
    team: slot,
  }));

/** World that starts in the fight phase with no countdown. */
export const makeWorld = (
  fighters: FighterId[],
  config: Partial<MatchConfig> = {},
): World => createWorld({ countdownFrames: 0, hazards: false, ...config }, roster(...fighters));

/** Step the world N ticks with the same input provider. */
export const run = (
  world: World,
  frames: number,
  inputs: (frame: number) => (InputFrame | undefined)[] = () => [],
): void => {
  for (let i = 0; i < frames; i += 1) stepWorld(world, inputs(i));
};

export const tick = (world: World, ...inputs: (InputFrame | undefined)[]): void => {
  stepWorld(world, inputs);
};

export { BTN };
