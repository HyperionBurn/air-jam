import { describe, expect, it } from "vitest";
import type { BotDifficulty } from "../src/game/ai/bot-brain";
import { FIGHTER_IDS } from "../src/game/data/fighters";
import { runBotMatch } from "./bot-harness";

/**
 * Balance harness. Bots play deterministic round-robins; the numbers below are
 * what the tuning notes in docs/balance.md quote. Run with AIRBRAWL_REPORT=1 to
 * print the tables. The assertions are deliberately loose guard rails (no
 * archetype is hopeless or unbeatable, no move dominates all KOs), not a claim
 * that the matchups are perfectly even.
 */
const report = process.env.AIRBRAWL_REPORT === "1";
const SEEDS = Number(process.env.AIRBRAWL_SEEDS ?? 12);

interface Tally {
  wins: number;
  games: number;
  kos: number;
  falls: number;
  selfDestructs: number;
  dmg: number;
  seconds: number;
}

const run = (difficulty: BotDifficulty) => {
  const tally: Record<string, Tally> = {};
  const matchups: Record<string, number> = {};
  const koMoves: Record<string, number> = {};
  const moveUse: Record<string, number> = {};
  const mk = (): Tally => ({ wins: 0, games: 0, kos: 0, falls: 0, selfDestructs: 0, dmg: 0, seconds: 0 });
  for (const id of FIGHTER_IDS) tally[id] = mk();
  let unfinished = 0;
  let seed = 100;
  for (const a of FIGHTER_IDS) {
    for (const b of FIGHTER_IDS) {
      if (a >= b) continue;
      let aWins = 0;
      for (let s = 0; s < SEEDS; s += 1) {
        // Alternate sides so spawn position never biases a pairing.
        const order = s % 2 === 0 ? [a, b] : [b, a];
        const result = runBotMatch({ fighters: order, difficulty, seed: (seed += 7), config: { stocks: 3 } });
        if (!result.finished) unfinished += 1;
        const w = result.winner;
        result.world.fighters.forEach((f, i) => {
          const t = tally[f.def.id];
          const st = result.world.stats[i];
          t.games += 1;
          t.kos += st.kos;
          t.falls += st.falls;
          t.selfDestructs += st.selfDestructs;
          t.dmg += st.damageDealt;
          t.seconds += result.frames / 60;
          if (w === i) t.wins += 1;
          for (const [m, n] of Object.entries(st.koMoves)) koMoves[`${f.def.id}.${m}`] = (koMoves[`${f.def.id}.${m}`] ?? 0) + n;
          for (const [m, n] of Object.entries(st.moveHits)) moveUse[`${f.def.id}.${m}`] = (moveUse[`${f.def.id}.${m}`] ?? 0) + n;
        });
        if (w !== null && result.world.fighters[w].def.id === a) aWins += 1;
      }
      matchups[`${a} v ${b}`] = aWins / SEEDS;
    }
  }
  return { tally, matchups, koMoves, moveUse, unfinished };
};

describe("balance (bot round-robin)", () => {
  for (const difficulty of ["medium", "hard"] as const) {
    it(`${difficulty}: no archetype is hopeless or unbeatable, every match finishes`, () => {
      const { tally, matchups, koMoves, moveUse, unfinished } = run(difficulty);
      const rows = FIGHTER_IDS.map((id) => {
        const t = tally[id];
        return {
          fighter: id,
          winRate: `${Math.round((t.wins / t.games) * 100)}%`,
          koPerGame: (t.kos / t.games).toFixed(2),
          fallsPerGame: (t.falls / t.games).toFixed(2),
          selfDestructs: (t.selfDestructs / t.games).toFixed(2),
          dmgPerGame: Math.round(t.dmg / t.games),
          avgSec: Math.round(t.seconds / t.games),
        };
      });
      if (report) {
        console.log(`\n=== ${difficulty} (${SEEDS} games per pairing) ===`);
        console.table(rows);
        console.log("pairing win-rate of first-named:", JSON.stringify(matchups, null, 1));
        const top = (m: Record<string, number>, n: number) =>
          Object.entries(m)
            .sort((x, y) => y[1] - x[1])
            .slice(0, n)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
        console.log("top KO moves:", top(koMoves, 10));
        console.log("most-used moves:", top(moveUse, 12));
      }
      expect(unfinished).toBe(0);
      for (const id of FIGHTER_IDS) {
        const rate = tally[id].wins / tally[id].games;
        expect(rate, `${id} win rate`).toBeGreaterThan(0.12);
        expect(rate, `${id} win rate`).toBeLessThan(0.88);
      }
      const totalKos = Object.values(koMoves).reduce((a, b) => a + b, 0);
      const topKo = Math.max(...Object.values(koMoves));
      if (totalKos > 20) expect(topKo / totalKos, "one move produces most KOs").toBeLessThan(0.55);
    });
  }
});
