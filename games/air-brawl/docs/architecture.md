# Air Brawl — architecture

```
phone ── InputPipe ── Air Jam input lane ──┐
                                           ▼
                    host: InputDecoder → MatchRunner(sim world, bot brains, agent overrides)
                                           │  60 Hz fixed step (useHostTick)
                                           ├── SimEvents → FeedbackRouter (audio, haptics) + GameView3D (fx, camera)
                                           └── HUD / results snapshots → createAirJamStore → every phone + agents
```

## Layers (and what may import what)

| Layer | Path | Rules |
| --- | --- | --- |
| Simulation | `src/game/sim` | Pure TypeScript. No DOM, SDK, React, wall-clock or `Math.random` (seeded xorshift in the world). Fully deterministic for identical inputs. |
| Data | `src/game/data` | Fighters, moves (frame windows, hitboxes), stages, projectiles, items. Moves are data, not code. |
| AI | `src/game/ai` | `BotBrain` produces the same `InputFrame` a human would. |
| Net | `src/game/net` | Wire schema, `InputEncoder` (phone), `InputDecoder` (host), diagnostics. |
| Session | `src/game/session` | Replicated store + pure reducers, `MatchRunner`. |
| Contracts | `src/game/contracts` | Sound manifest, semantic agent contract. |
| View | `src/game/view3d`, `src/game/view` (HUD, palette, camera springs) | three.js scene + transparent Pixi overlay for HUD/announcer. Reads the world, never mutates it. |
| Host UI | `src/host` | Lobby, results, menu, debug overlay, the runtime hook that wires everything together. |
| Controller UI | `src/controller` | Touch surface, `InputPipe`, lobby/setup/results panels. |

## Simulation

* **Fixed 60 Hz.** `useHostTick({ mode: "fixed", intervalMs: 1000/60, maxStepsPerFrame: 4 })`; rendering interpolates with `fixedStepAlpha`. Sim slow-motion (final KO) is a time-scale accumulator on top of the fixed step, so determinism is preserved.
* **State machine per fighter** (`fighter-states.ts`): idle, walk, run, turn, jumpsquat, airborne, land, attack, airAttack, special, airSpecial, shield, shieldStun, shieldBreak, roll, spotDodge, airDodge, hitstun, grab, grabbing, grabbed, throw, ledgeHang/Climb/Roll/Attack, respawn, dead, victory. Each state has one handler; transitions are explicit.
* **Movement.** Gravity, fast fall, short/full hop with variable-jump cut window, double jump, drop-through soft platforms, moving platforms that carry fighters, ledges with grab/climb/roll/attack and cooldown, helpless states after recoveries.
* **Combat.** One `applyHit` path for melee, projectiles, hazards, throws and blast damage: percent damage, Smash-style knockback (damage, weight, base/growth), launch angles, DI, hitlag (attacker and victim freeze, victim shakes), hitstun, tumble, bounce/wall-bounce, shield damage/pushback/break, armor, aegis, priority clanks, spike reflect, rebound.
* **Hitboxes** are capsules/circles with frame windows (`from..to`), group tokens (one hit per group per target), and per-hit overrides. Poses in the renderer aim limbs at the *live* hitbox so visuals match collisions.
* **Win conditions.** Stock mode (last team standing, tie → lowest damage), timed mode (KOs minus self-destructs), team and free-for-all. The final KO triggers a freeze + slow-motion before `matchEnd`.

## Input and latency

Phones never decide gameplay; they send *intent* (stick percent, held bitmask, per-button press counters, seq, controller clock, optional probe echo).

* Air Jam input is latest-wins per controller, so edges are carried by **press counters**: the host derives taps from counter deltas, so a press+release that both land between two host reads is never lost.
* `InputPipe` flushes button edges synchronously, coalesces stick moves to ≥ 8 ms or the next frame, heartbeats at 80 ms (active) / 250 ms (idle), and on blur / cancel / disable sends one neutral packet.
* `InputDecoder` treats a controller silent for > 700 ms as neutral (no stuck run or shield) and the HUD marks it OFFLINE after 2 s.
* **Latency instrumentation** (debug overlay): per-controller packet rate, input age, relative jitter, and true RTT via echoed probes on the state lane; render/tick cost; dropped frames; adaptive-quality level.
* Reconnect: the SDK keeps a 30 s controller lease; the same phone resumes the same fighter. The server does not push a presence change during the lease, so the host relies on the stale-input watchdog (above).

## Replicated state

One `createAirJamStore` (`src/game/session/store.ts`), kept small: phase, settings, roster, ready/team/vote flags, HUD snapshot (percent/stocks/status, ~4 Hz), match spec, results, session scoreboard. Hot sim state never leaves the host. Reducers are pure functions (`reducers.ts`) so they are unit tested without the SDK.

## Renderer

* **three.js** scene: perspective camera (32° FOV, slight pitch and parallax drift), per-stage procedural 3D scenery
  (`stage-proving.ts`, `stage-skyline.ts`, `stage-foundry.ts` on the shared `stage-common.ts` / `proc-tex.ts` toolkit),
  a shadow-mapped key light that follows the action, ACES tone-mapping, per-stage `StageLook` (exposure, bloom,
  colour grade) and a sky-derived PMREM reflection environment, plus a bloom + grade + impact aberration/zoom-blur
  post stack and instanced billboard particles (two draws).
* **Fighters** are articulated procedural models: continuous two-bone **skinned limbs** with material bands for armor,
  a decoupled pelvis/chest/head chain, spring chains for scarves/tails/capes, expressive faces. Pose logic (`anim.ts`)
  is pure and driven by sim state: authored targets per state → per-channel spring layer → pose; the striking limb
  snaps to the live hitbox. Per-fighter `StyleProfile`s give each character its own motion language.
* **Overlay**: a transparent Pixi canvas draws the HUD (with vector fighter portraits), tags, off-screen markers,
  announcer and debug overlay, projected through the 3D camera.
* **Adaptive quality** steps down (resolution → bloom → shadows → lower res, hiding fine detail) when frames stay over
  budget; geometry detail also scales with roster size. `?quality=N` pins a level; `window.__airBrawlStats()` returns
  draw calls / triangles for profiling.

## Agents

`src/game/contracts/agent.ts` exposes the lifecycle (fighter, ready, team, stage vote, start, rematch, lobby, settings, bots) plus deterministic gameplay control (`control`, `step`, `setup_fighter`, `set_telemetry`). They run through the same store and `MatchRunner` as phones, so an MCP session can drive a match without DOM automation and assert on authoritative HUD telemetry (position, velocity, state, move, hitlag, hitstun).
