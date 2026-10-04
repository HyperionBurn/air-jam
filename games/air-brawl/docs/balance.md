# Balance notes

## Method

`tests/balance.test.ts` plays deterministic bot round-robins (every fighter pairing,
sides alternated, 3 stocks, hazards on) at **medium** and **hard** bot skill and prints
win rate, KOs, falls, self-destructs, damage and match length per fighter plus the KO and
move-usage breakdown:

```bash
AIRBRAWL_REPORT=1 AIRBRAWL_SEEDS=24 pnpm exec vitest run tests/balance.test.ts
```

Kill-power calibration lives in `tests/tuning.test.ts` (smallest damage percent at which a
move KOs a centred victim, jump heights, run-speed ordering). The CI guard rails are loose:
no fighter below 12 % or above 88 % win rate, every match finishes, no single move
accounts for more than 55 % of KOs.

## What the harness found (and what changed)

First complete run (24 games per pairing, medium bots): Nova 86 %, Bulwark 58 %,
Volt 44 %, **Wisp 11 %** (hard bots: Wisp 6 %). Wisp's normals were too weak and slow to
punish; Nova's pulse shot was spammable.

Changes: Wisp move profile faster and stronger (speed 1 → 0.95, lag 1 → 0.96, power 0.8 → 0.95,
kb 0.92 → 1.02, growth 0.9 → 1.0); Bulwark startup/endlag trimmed (speed 1.25 → 1.18,
lag 1.18 → 1.12); Nova pulse shot slower (34 → 38 frames) and slightly weaker (5.5 → 5 damage,
growth 34 → 32).

## Current numbers (bots, 24 games per pairing, 6 pairings)

| Fighter | Win rate · medium | Win rate · hard |
| --- | --- | --- |
| Nova | 44 % | 51 % |
| Volt | 50 % | 51 % |
| Bulwark | 51 % | 47 % |
| Wisp | 54 % | 50 % |

Average match length 142–174 s. These are **bot** results: they validate that no archetype is
broken and that the data is internally consistent. They do not predict human meta — expect
human play to favour Volt's mobility and Bulwark's armor differently. Re-run the harness after
any frame-data change and treat >65 % / <35 % as a regression.

## Known soft spots

* Volt self-destructs more than the others at medium skill (≈0.15 per game vs ≤0.07) — a bot
  recovery weakness (blink slash off stage), not a stat problem.
* Bots rarely use grabs, shield-grabs and ledge options, so the harness under-reports shield/grab-heavy play.
