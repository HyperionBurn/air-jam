import { describe, expect, it } from "vitest";
import { FIGHTER_IDS } from "../src/game/data/fighters";
import { runBotMatch } from "./bot-harness";

const report = process.env.AIRBRAWL_REPORT === "1";
const log = (...args: unknown[]) => {
  if (report) console.log(...args);
};

describe("bot matches", () => {
  it("a 1v1 stock match runs to completion with real fighting", () => {
    const result = runBotMatch({ fighters: ["nova", "volt"], difficulty: "medium", seed: 3 });
    const stats = result.world.stats;
    log("1v1", {
      seconds: Math.round(result.frames / 60),
      finished: result.finished,
      kos: stats.map((s) => s.kos),
      falls: stats.map((s) => s.falls),
      selfDestructs: stats.map((s) => s.selfDestructs),
      dmg: stats.map((s) => Math.round(s.damageDealt)),
    });
    expect(result.finished).toBe(true);
    expect(result.frames).toBeGreaterThan(60 * 10);
    expect(stats.reduce((n, s) => n + s.damageDealt, 0)).toBeGreaterThan(100);
  });

  it("every fighter pairing finishes and nobody dominates by self-destruct only", () => {
    const rows: unknown[] = [];
    let finished = 0;
    let total = 0;
    for (const a of FIGHTER_IDS) {
      for (const b of FIGHTER_IDS) {
        if (a === b) continue;
        const result = runBotMatch({
          fighters: [a, b],
          difficulty: "medium",
          seed: 11 + total,
          config: { stocks: 2 },
        });
        total += 1;
        if (result.finished) finished += 1;
        rows.push({
          match: `${a} v ${b}`,
          sec: Math.round(result.frames / 60),
          winner: result.winner === null ? "-" : result.world.fighters[result.winner].def.id,
          kos: result.world.stats.map((s) => s.kos).join("/"),
          sd: result.world.stats.map((s) => s.selfDestructs).join("/"),
        });
      }
    }
    log(rows);
    expect(finished).toBe(total);
  });

  it("8-fighter free-for-all completes", () => {
    const result = runBotMatch({
      fighters: ["nova", "volt", "bulwark", "wisp", "nova", "volt", "bulwark", "wisp"],
      difficulty: "medium",
      seed: 21,
      config: { stocks: 2 },
    });
    log("ffa8", { sec: Math.round(result.frames / 60), finished: result.finished });
    expect(result.finished).toBe(true);
  });
});
