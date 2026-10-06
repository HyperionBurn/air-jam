# Air Brawl

An original party **platform fighter** for Air Jam: one shared screen
(laptop / projector / TV), **2–8 players**, every phone is a controller after a
QR scan. Percent damage, blast zones, stocks, four original fighters, three
stages, CPU fighters, items, hazards, teams, timed mode and a session
leaderboard — built for short, loud, replayable rounds at live events.

Everything here is original: characters, stages, UI, effects, sounds and music
are generated or authored for this game. No third-party game assets or names.

## Run it

```bash
cd games/air-brawl
pnpm run dev          # starts the Air Jam server + Vite (do not use raw `vite`)
```

Open the host URL (normally `http://localhost:5173/`), scan the lobby QR with a
phone (or use the in-host **Controllers** workspace on desktop), pick a fighter
and ready up. The room leader (first player in) runs match setup from their
phone — the host machine never has to be touched.

```bash
pnpm test             # vitest: sim, combat, tuning, net, reducers, bots, balance, perf
pnpm typecheck
pnpm exec eslint .
pnpm build
node scripts/generate-audio.mjs   # re-synthesize every sound + both music loops
```

## Controls (phone)

Hold the phone sideways. Left side: a **floating analog stick** that appears
where your thumb lands. Right side: five large pads.

| Pad | Action |
| --- | --- |
| **Attack** | Neutral = jab chain, tilt the stick = tilts, **flick** the stick while pressing = smash (hold to charge) |
| **Special** | Neutral / side / up (recovery) / down special depending on stick direction |
| **Jump** | Tap = short hop, hold = full hop, again in the air = double jump; release early to cut the jump |
| **Shield** | Hold to block; + stick = roll, + down = spot dodge, in the air = air dodge |
| **Grab** | Grab, then stick + Attack to throw (or Attack to pummel) |

Down on the stick falls faster; tapping down on a thin platform drops through.
Haptics confirm hits, KOs, shield breaks and respawns (can be turned off per phone).

## Skill, not spam

Mashing a button should lose to playing well. These rules are in the sim (`src/game/sim`, tests in `tests/skill.test.ts`):

- **Move staling.** Each landed move goes into your last-9 queue. Every copy of the same move already in it costs 8.5% damage (floor 55%) and a third of that in knockback. Mix moves and they stay fresh; a KO resets the queue. Stale hits show a grey spark, a thin sound and a `STALE` tag, and the attacker's phone stops buzzing.
- **Parry.** A shield raised in the 5 frames before a hit takes no damage and no stun, punishes the attacker with extra hitlag and pushback, and shows `PARRY!` with a distinct sound and haptic.
- **No shield mashing.** After lowering the shield it cannot be raised again for 12 frames, so you cannot hold a permanent parry window by tapping. A refused press gives a short dull haptic tick.
- **Dodge fatigue.** Spot dodges, rolls and air dodges used within 80 frames of each other lose 28% of their invulnerability each time (floor 30%) and recover 5 frames slower. One well-timed dodge is untouched.
- **Projectile recast.** A move that spawns a projectile cannot restart until 16 frames after it ends. A refused press gives the same haptic tick.

## Performance

A fighting game has to hold 60 fps. The host renderer (`src/game/view3d`) therefore:

- steps a quality governor down after 0.8 s above 19.5 ms per frame (and back up after 12 s below 11 ms): MSAA 4x, then 2x, then off, with a pixel budget per level, then bloom, then shadows;
- compiles every shader variant, including ghost/respawn variants, once at match start (`prewarm`) and keeps them alive with anchor meshes, so the first KO or respawn no longer freezes the game for 100-800 ms.

Measure with `AIRBRAWL_GPU=1 AIRBRAWL_CHROME=<chrome.exe> node scripts/qa/perf-frames.mjs` (8 fighters, 1080p; reports fps, percentiles and mid-match shader compiles) and `perf-profile.mjs` (CPU profile). On an integrated GPU this took the 8-fighter match from 42 fps (p99 97 ms, worst 786 ms) to 60 fps (p99 23 ms, worst 34 ms).

## Controls (Xbox / PlayStation / Switch pads)

Any standard-mapping gamepad works. Plug it into (or pair it with) the machine showing the game and
**press any button in the lobby to join** - no phone needed. A pad can also be paired with a phone or
laptop that opened `/controller`.

| Input | Xbox / PlayStation | Action |
| --- | --- | --- |
| Move | Left stick / D-pad | Run, aim tilts, fast-fall, drop through platforms |
| Attack | A / Cross | Jab chain, tilts with the stick |
| Special | B / Circle | Neutral / side / up / down special |
| Jump | X, Y / Square, Triangle | Short hop, full hop (hold), double jump |
| Shield | LT, RT / L2, R2 | Block, roll, spot dodge, air dodge |
| Grab | LB, RB / L1, R1 | Grab |
| Smash | Right stick | Flick for an instant smash attack in that direction |
| Lobby | D-pad left/right fighter, up/down stage vote, A ready, B un-ready, X team | Leader: LB/RB CPU count, Y mode, Select items, Start begins |

Pads rumble on hits, KOs and shield breaks. Chrome exposes at most 4 pads per page; any extra players
join from their phones as usual, and the two can be mixed in one room.

## Fighters

- **Nova** — all-rounder. Pulse shot, dash punch, rising burst, shockwave.
- **Volt** — speedster. Blink slash, static field, skyrocket recovery.
- **Bulwark** — heavy. Boulder toss, armored shoulder charge, quake slam (a spike in the air).
- **Wisp** — floaty trickster. Orb cast, boomerang disc, hex mine, warp-step teleport recovery.

## Stages

- **Proving Ground** — floating arena with three platforms (dusk / crystal islands).
- **Skyline Rush** — neon rooftop, sliding platforms, drone strike lanes (hazard).
- **The Foundry** — vertical lava cavern, rising lift, molten geysers (hazard).

## Match options (leader's phone)

Presets (**Standard** 3 stocks · **Fast Party** 2 stocks, bigger launches, ~90 s), mode
(stocks / timed), stage (vote / random / fixed), items (off / low / normal / chaos),
hazards, teams (+ friendly fire), 0–7 CPU fighters (easy / medium / hard), and **event
mode** (auto-rematch after 14 s, session leaderboard on the results screen).

## Hidden developer tooling

| Tool | How |
| --- | --- |
| Debug overlay (fps, tick/render cost, per-controller packet rate / age / jitter / RTT, adaptive quality level, hitboxes) | `` ` `` on the host, or `?debug=1` |
| Host menu (volume, UI scale, reduced effects/shake, tags) | `Esc` |
| Model & animation viewer — runs the real sim to an exact frame and renders it | `/viewer?fighter=nova&script=fsmash&frame=36&zoom=4.5` |
| Semantic agent actions (MCP): `set_fighter`, `set_ready`, `vote_stage`, `start_match`, `control`, `step`, `setup_fighter`, `update_settings`, `set_bots`, `set_telemetry`, `rematch`, `return_to_lobby` | `src/game/contracts/agent.ts` |

## More

- [docs/architecture.md](docs/architecture.md) — sim, netcode, renderer, state, agent contract
- [docs/art-direction.md](docs/art-direction.md) — visual targets and how they were derived
- [docs/balance.md](docs/balance.md) — tuning method and the measured bot round-robin
- [docs/visual-qa.md](docs/visual-qa.md) — headless screenshot + animation-viewer tooling
- [docs/real-device-checklist.md](docs/real-device-checklist.md) — what still needs real phones / a real GPU
