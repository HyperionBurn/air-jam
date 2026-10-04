import { launch, shot, sleep, startMatch } from "./lib.mjs";

// node scripts/qa/match-shots.mjs [tag]    env: BOTS=3 STAGE="The Foundry" W=1600 H=900 GAP=3000 SHOTS=6
const tag = process.argv[2] ?? "match";
const browser = await launch();
const logs = [];
const { hostCtx, host } = await startMatch(browser, {
  bots: Number(process.env.BOTS ?? 3),
  stage: process.env.STAGE,
  preset: process.env.PRESET,
  viewport: { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 900) },
  logs,
});
await sleep(9500); // lobby auto-start + countdown
for (let k = 0; k < Number(process.env.SHOTS ?? 6); k += 1) {
  await sleep(Number(process.env.GAP ?? 3000));
  console.log(await shot(hostCtx, host, `${tag}-${k}`));
}
console.log(logs.filter((l) => !/AudioContext|404|SESSION_NOT_READY/.test(l)).join("\n") || "no console errors");
await browser.close();
