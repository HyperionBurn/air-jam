import { BASE, launch, shot, sleep } from "./lib.mjs";

// node scripts/qa/stage-shots.mjs "proving-ground,0,-120,0.55;foundry,0,-200,0.5"
// each spec: stage,camX,camY(sim y, down=+),zoom[,time][,tag]     -> establishing shots, no HUD
const specs = (process.argv[2] ?? "proving-ground,0,-120,0.55").split(";").map((s) => s.split(","));
const browser = await launch();
for (const [stage, x, y, zoom, time = "60", tag = ""] of specs) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 300)));
  await page.goto(`${BASE}/viewer?fighter=nova&stage=${stage}&script=idle&frame=30&cam=${x},${y},${zoom}&time=${time}&spread=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 90000 }).catch(() => console.log("not ready:", stage));
  await sleep(500);
  console.log(await shot(ctx, page, `stage-${stage}-${x}_${y}_${zoom}${tag}`));
  await ctx.close();
}
await browser.close();
