import { BASE, launch, shot, sleep } from "./lib.mjs";

// node scripts/qa/viewer-shots.mjs "nova,fsmash,36,4.2;volt,run,50;wisp,special,32"
// each spec: fighter,script,frame[,zoom[,stage]]  (see src/host/viewer.tsx for scripts)
const specs = (process.argv[2] ?? "nova,idle,40").split(";").map((s) => s.split(","));
const browser = await launch();
for (const [fighter, script, frame, zoom = "4.2", stage = "proving-ground"] of specs) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 300)));
  await page.goto(`${BASE}/viewer?fighter=${fighter}&script=${script}&frame=${frame}&zoom=${zoom}&stage=${stage}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 40000 }).catch(() => console.log("not ready:", fighter));
  await sleep(400);
  console.log(await shot(ctx, page, `viewer-${fighter}-${script}-${frame}`));
  await ctx.close();
}
await browser.close();
