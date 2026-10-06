import { launch, sleep, startMatch } from "./lib.mjs";

// AIRBRAWL_GPU=1 node scripts/qa/perf-profile.mjs     env: BOTS=7 W=1920 H=1080 SECONDS=10
// CPU profile of the host page during live play, grouped by self time per function and per file.
const W = Number(process.env.W ?? 1920);
const H = Number(process.env.H ?? 1080);
const browser = await launch();
const { host, hostCtx } = await startMatch(browser, { bots: Number(process.env.BOTS ?? 7), stage: process.env.STAGE, viewport: { width: W, height: H } });
for (let i = 0; i < 60; i += 1) {
  if (await host.evaluate(() => Boolean(window.__airBrawlStats))) break;
  await sleep(1000);
}
await sleep(8000);
const cdp = await hostCtx.newCDPSession(host);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
await cdp.send("Profiler.start");
await sleep(Number(process.env.SECONDS ?? 10) * 1000);
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const fn = new Map();
const file = new Map();
for (const [id, t] of self) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const url = (cf.url || "(native)").replace(/^.*\/(src\/|node_modules\/)/, "$1").replace(/\?.*$/, "");
  const key = `${cf.functionName || "(anon)"}  ${url}:${cf.lineNumber + 1}`;
  fn.set(key, (fn.get(key) ?? 0) + t);
  file.set(url, (file.get(url) ?? 0) + t);
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
console.log("== by file\n" + top(file, 14).join("\n"));
console.log("\n== by function\n" + top(fn, 24).join("\n"));
await browser.close();
