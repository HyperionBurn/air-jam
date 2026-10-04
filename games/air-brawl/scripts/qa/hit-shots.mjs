import { BASE, launch, shot, sleep } from "./lib.mjs";
// node scripts/qa/_hitshots.mjs  -> impact art at several strengths/ages
const browser = await launch();
for (const [fx, t, kind] of [["light", 3, "impact"], ["mid", 4, "impact"], ["heavy", 4, "fire"], ["heavy", 9, "slash"], ["kill", 5, "impact"]]) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/viewer?fighter=nova&stage=proving-ground&script=idle&frame=30&zoom=2.2&time=${t}&fx=${fx}&kind=${kind}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 90000 }).catch(() => console.log("not ready"));
  await sleep(120);
  console.log(await shot(ctx, page, `hitfx-${fx}-${kind}-${t}`));
  await ctx.close();
}
await browser.close();
