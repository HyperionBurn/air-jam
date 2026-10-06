import { launch, sleep, startMatch } from "./lib.mjs";

// AIRBRAWL_GPU=1 node scripts/qa/perf-frames.mjs     env: BOTS=7 W=1920 H=1080 SECONDS=15
// Frame pacing of the host while a real match runs: fps, frame-time percentiles, long frames,
// renderer cost and draw-call counters. Needs the real GPU; software GL numbers mean nothing.
const W = Number(process.env.W ?? 1920);
const H = Number(process.env.H ?? 1080);
const SECONDS = Number(process.env.SECONDS ?? 15);
const browser = await launch();
const logs = [];
const { host } = await startMatch(browser, { bots: Number(process.env.BOTS ?? 7), stage: process.env.STAGE, viewport: { width: W, height: H }, logs });
// wait out the lobby/countdown until the sim is actually running
for (let i = 0; i < 60; i += 1) {
  const live = await host.evaluate(() => Boolean(window.__airBrawlStats));
  if (live) break;
  await sleep(1000);
}
await sleep(6000);
await host.evaluate(() => {
  window.__frames = [];
  window.__programsAtStart = new Set(window.__airBrawlPrograms?.() ?? []);
  window.__renderMs = [];
  window.__programEvents = [];
  let lastPrograms = -1;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    window.__frames.push(now - last);
    last = now;
    const s = window.__airBrawlStats?.();
    if (s) {
      window.__renderMs.push(s.renderMs);
      if (lastPrograms >= 0 && s.programs !== lastPrograms) window.__programEvents.push({ frame: window.__frames.length, programs: s.programs, ms: Math.round(now - last) });
      lastPrograms = s.programs;
    }
    window.__frameLoop = requestAnimationFrame(tick);
  };
  window.__frameLoop = requestAnimationFrame(tick);
});
await sleep(SECONDS * 1000);
const out = await host.evaluate(() => {
  cancelAnimationFrame(window.__frameLoop);
  const f = [...window.__frames].slice(5).sort((a, b) => a - b);
  const r = [...window.__renderMs].slice(5);
  const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return {
    frames: f.length,
    fps: Math.round((1000 * f.length) / f.reduce((x, y) => x + y, 0)),
    p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), worst: +f[f.length - 1].toFixed(1),
    over20ms: f.filter((x) => x > 20).length, over33ms: f.filter((x) => x > 33).length, over50ms: f.filter((x) => x > 50).length,
    renderMsMean: +mean(r).toFixed(2), renderMsMax: +Math.max(...r).toFixed(2),
    programEvents: window.__programEvents,
    newPrograms: (window.__airBrawlPrograms?.() ?? []).filter((n) => !window.__programsAtStart.has(n)),
    stats: window.__airBrawlStats?.(),
    dpr: window.devicePixelRatio,
  };
});
const s = out.stats ?? {};
delete out.stats;
console.log(`${W}x${H}`, JSON.stringify(out));
console.log("scene", JSON.stringify({ calls: s.calls, triangles: s.triangles, stageMeshes: s.stageMeshes, stageTris: s.stageTris, dynamicMeshes: s.dynamicMeshes, dynamicTris: s.dynamicTris, textures: s.textures, geometries: s.geometries, programs: s.programs, quality: s.quality }));
if (logs.length) console.log(logs.slice(0, 6).join("\n"));
await browser.close();
