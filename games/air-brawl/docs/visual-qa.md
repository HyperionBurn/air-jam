# Visual QA

Headless Chromium with software GL drives the real game: one host page plus phone-sized
contexts that use the real controller UI (no synthetic events into iframes).

```bash
pnpm run dev                                   # in one terminal
node scripts/qa/match-shots.mjs pg             # 1 human + 3 CPUs, 6 host screenshots
STAGE="The Foundry" BOTS=7 W=1280 H=720 node scripts/qa/match-shots.mjs ffa8
node scripts/qa/viewer-shots.mjs "nova,fsmash,36,4.2;wisp,special,32"
```

Needs `@playwright/test` (resolved from the repo root) and a Chromium build
(`pnpm exec playwright install chromium`, or set `AIRBRAWL_CHROME`). Screenshots land in
`$AIRBRAWL_OUT` (default `<tmp>/air-brawl-shots`).

* Software GL is slow (single-digit fps with 8 fighters), so these runs verify **layout, art,
  animation poses and flow** — never frame rate. Real-GPU performance is on the
  [real-device checklist](real-device-checklist.md).
* The `/viewer` route runs the real simulation with scripted inputs to an exact frame, so any
  pose can be reviewed deterministically (`script=` idle, run, dash, jab, ftilt, fsmash, usmash,
  jump, fair, special, shield, hit).
