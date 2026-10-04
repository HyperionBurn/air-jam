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
