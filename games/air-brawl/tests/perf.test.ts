import { describe, expect, it } from "vitest";
import { BotBrain } from "../src/game/ai/bot-brain";
import { createWorld, stepWorld, type InputFrame } from "../src/game/sim";
import { roster } from "./helpers";

/**
 * Simulation cost (Node, single thread). These numbers are for the simulation
 * only; they say nothing about GPU/render cost. Printed with AIRBRAWL_REPORT=1.
 */
const report = process.env.AIRBRAWL_REPORT === "1";

const measure = (count: number, items: "off" | "chaos", frames = 3600) => {
  const ids = (["nova", "volt", "bulwark", "wisp"] as const);
  const entries = roster(...Array.from({ length: count }, (_, i) => ids[i % 4]));
  const world = createWorld({ countdownFrames: 0, stocks: 99, hazards: true, items, seed: 5 }, entries);
  const brain = new BotBrain("hard", 5);
  const inputs: InputFrame[] = [];
  const samples: number[] = [];
  // Warm-up so JIT cost is not attributed to the sim.
  for (let i = 0; i < 300; i += 1) {
    for (let k = 0; k < count; k += 1) inputs[k] = brain.think(world, k);
    stepWorld(world, inputs);
  }
  for (let i = 0; i < frames; i += 1) {
    const t0 = performance.now();
    for (let k = 0; k < count; k += 1) inputs[k] = brain.think(world, k);
    stepWorld(world, inputs);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { count, items, meanMs: mean, p99Ms: samples[Math.floor(samples.length * 0.99)], maxMs: samples[samples.length - 1] };
};

describe("simulation performance", () => {
  it("8 fighters + bots + items stays far below the 16.7 ms frame budget", () => {
    const rows = [measure(2, "off"), measure(4, "off"), measure(8, "off"), measure(8, "chaos")];
    if (report) console.table(rows.map((r) => ({ ...r, meanMs: +r.meanMs.toFixed(3), p99Ms: +r.p99Ms.toFixed(3), maxMs: +r.maxMs.toFixed(3) })));
    const worst = rows[3];
    expect(worst.meanMs).toBeLessThan(2);
    expect(worst.p99Ms).toBeLessThan(6);
  });
});
