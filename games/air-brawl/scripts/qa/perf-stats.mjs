import { launch, sleep, startMatch } from "./lib.mjs";

// node scripts/qa/perf-stats.mjs   env: BOTS=7 STAGE="The Foundry"
// Prints renderer counters from the host page (draw calls, triangles, textures) during live play.
const browser = await launch();
const logs = [];
const { host } = await startMatch(browser, { bots: Number(process.env.BOTS ?? 7), stage: process.env.STAGE, viewport: { width: 1280, height: 720 }, logs });
await sleep(12000);
for (let i = 0; i < 3; i += 1) {
  const s = await host.evaluate(() => (window.__airBrawlStats ? window.__airBrawlStats() : null));
  console.log(JSON.stringify(s));
  await sleep(2500);
}
await browser.close();
