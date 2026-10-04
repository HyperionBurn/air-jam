# Visual gap analysis & overhaul log

Reference study of two 1080p60 platform-fighter videos (a tournament set on a dense town stage and a
waterfall-ruins stage, plus a mod-showcase match), used purely as a **production-quality bar**. Nothing from
them is reused: every character, stage, effect, sound and UI element in Air Brawl is original.

Method: frame sheets (1 frame / 8 s over the whole video), dense 11–15 fps sequences around close-ups, launches,
kills and score transitions, and full-resolution stills. The same shots were then reproduced in the current build
(`/viewer`, `scripts/qa/*`) and compared side by side, plus objective image statistics
(`mean luma`, `p05` black point, `saturation`, edge density) on the establishing frames.

## What the reference actually does (measured)

| Quality axis | Reference | Air Brawl before | Cause |
| --- | --- | --- | --- |
| Value structure | mean luma **0.58–0.72**, black point p05 ≈ **0.32** (no crushed blacks) | luma **0.10–0.17**, p05 ≈ 0 | lighting / composition: dark single-hue stages |
| Colour control | saturation **0.26–0.33**; one dominant hue per layer, aerial perspective | saturation **0.87–0.95** (neon everywhere) | colour hierarchy, no depth haze |
| Scale hierarchy | fighters ≈ 12 % of frame height in wide shots; the stage is the hero | fighters comparable, but stage read as flat dark fields | environmental density, not fighter size |
| Stage density | 5+ readable layers (sky, far landmarks, mid ruins/buildings, platform, foreground props), animated water/foliage/clouds | 1 floor slab + a sparse noise-dot backdrop | modelling + composition |
| Platform silhouette | thick, beveled, ornamented slabs with trim, vines, rubble, supports | flat box on a cone | modelling |
| Character construction | continuous limbs, big readable hands/feet/head, layered costume | stacked capsules + balls (visible seams), shared generic motion | modelling + animation |
| Impact | white-hot jagged starburst, long anamorphic streaks, shockwave ring, debris; clear light/medium/kill tiers | one generic soft star | VFX vocabulary |
| KO | screen-crossing diagonal light beam + sparkles | radial flash | VFX |
| Camera | wide with strong perspective, pushes in on close action, reframes smoothly | telephoto (27° FOV), static padding | camera |

## Where the gap came from (ranked)

1. **Lighting and value structure** – by far the largest. Stages were authored as dark, saturated night scenes.
   The fix was not "more bloom": it was a full redesign of the value ramp (bright sky → hazy far landmarks → mid-tone
   ruins → high-contrast fighting plane) with per-stage fog, exposure, bloom threshold and colour grade.
2. **Environmental density and composition** – rebuilt every stage as a hand-composed 6+ layer scene.
3. **Character modelling** – replaced capsule/ball limbs with continuous skinned, multi-material limbs.
4. **Animation** – replaced one shared angle-based driver with a layered, per-fighter system with spring follow-through.
5. **VFX** – new shape vocabulary and three impact tiers.
6. **Camera** – look-ahead, directional impulses, roll kick, wider FOV for real parallax.

## What changed

### Stages (`src/game/view3d/stage-*.ts`, `proc-tex.ts`)
* Shared toolkit: procedural tileable PBR textures (ashlar stone with moss, cliff strata, turf, concrete, metal plate,
  cracked basalt, façades with per-window emissive), cumulus billboards, ridge silhouettes with baked haze, scrolling
  waterfalls, light shafts, instanced scatter (trees, crystals, vines, petals), sky shader with a gradient compressed
  into the camera's visible elevation band, and a **sky-derived reflection environment** (PMREM) per stage.
* **Proving Ground – "Aether Arena"**: sunlit sky, cloud sea, 13 floating ruin islands with waterfalls, a slowly
  turning landmark ring, ashlar-and-turf hero platform with garden, gate, lantern pylons, hanging cliff with vines,
  crystals and cliff-edge waterfalls; soft platforms are carved slabs with rune inlays and hovering pebbles.
* **Skyline Rush**: golden-hour city. Four haze-graded tower layers with lit façades, monorail, traffic lanes, blimp,
  billboards with scrolling screens, searchlights; rooftop deck with helipad, water tower, antenna beacon, string
  lights and steam vents.
* **The Foundry**: molten cavern. Cellular cracked-crust lava shader, cool basalt walls against warm lava (complementary
  contrast), gears, pistons, a pouring smelter vat, a crane, catwalks; hero platform on a riveted truss over the lava,
  side platforms hung from chains.
* Hazards share one module (`stage-hazards.ts`): aiming laser + ground ring in the warning phase, column + flare + light
  in the active phase, drone model.

### Characters (`fighter-model.ts`, `skin.ts`)
* Continuous **skinned arm/leg tubes** with weight cross-fade at elbow/knee; armor, bracers and cuffs are *material
  bands on the same surface* (bulging radius profile), so there are no bead-like joints.
* Decoupled **pelvis → chest → head** chain (counter-rotation in locomotion and strikes), bigger heads/hands/feet.
* Expressive faces: blink, brow anger/surprise, mouth open on strikes and hits, eyes that track the nearest opponent.
* Wisp redesigned as a bell-robed spirit (flared hem rings, ribbon tails, bell sleeves, orb hands, halo).
* Launch deformation (stretch along the flight vector) and impact squash.

### Animation (`anim.ts`)
* One articulated pose contract; targets authored per state, then smoothed by a per-channel spring layer
  (anticipation lag, overshoot, follow-through). The striking limb **snaps** to the live hitbox so animation and
  collision stay frame-exact; hitlag holds the pose.
* Per-fighter **style sheets** (idle rate/stance, run lean/cadence/knee fold, windup depth, twist, lunge, recoil,
  landing weight, flip, hurt exaggeration, head tracking): Nova = boxer's guard and economy; Volt = toe-bounce, extreme
  lean, whipping arcs, backflip double jump; Bulwark = slow weight transfer, stomp gait, deep coils, heavy landings;
  Wisp = floating hover, flowing arm gestures, eased everything.
* Authored: idle, victory, walk/run (stride, knee fold, arm counter-swing, double-frequency bob), turn, jump squat,
  rise/apex/fall, double jump, fast fall, land, shield/stun/break, roll/spot-dodge/air-dodge, hitstun/tumble, grab/
  grabbed, ledge hang/climb, respawn, and every move class (jabs, tilts, smashes, aerials, specials, throws, slams).

### Presentation (`fx3d.ts`, `camera.ts`, `game-view3d.ts`, `hud.ts`)
* Atlas gained comic burst, crescent smear, anamorphic ray, four-point spark and flame shapes.
* **Three impact tiers**: light flick → medium burst + ring + rays → heavy/kill (radial speed lines, shockwave, debris);
  per-type extras for slash/fire/electric/shock/magic. Smears are soft-edged 3-vertex ribbons with a hot core.
* KO adds a screen-crossing light beam and sparkles; launched fighters trail comet streaks.
* Camera: velocity look-ahead (stronger for launched fighters), tighter duels / looser crowds, impulses along the
  knockback direction, roll kick on heavy hits, FOV 27° → 32° (more real parallax).
* HUD: original vector fighter portraits in the tiles (identity shape moved to the corner as the colour+shape
  redundancy), existing heat-ramped percent and stock pips kept.

## Result (establishing shots, 1600×900)

| Stage | luma | p05 | saturation | notes |
| --- | --- | --- | --- | --- |
| Reference (3 stills) | 0.58–0.72 | 0.32 | 0.26–0.33 | |
| Before – Skyline / Foundry | 0.12 / 0.17 | 0.00 / 0.02 | 0.87 / 0.89 | |
| **Proving Ground** | **0.65** | 0.21 | **0.20** | in range on value, slightly under on saturation |
| **Skyline Rush** | 0.32 | 0.04 | 0.54 | deliberate golden-hour dusk |
| **The Foundry** | 0.27 | 0.05 | 0.72 | fire world; still the most saturated stage |

Edge density (fine detail) rose from 0.04–0.05 to 0.08–0.20 across stages.

## Performance (software GL for QA; **real-GPU numbers still need the checklist**)

Measured with `scripts/qa/perf-stats.mjs` (`?quality=0` pins the adaptive level):

| Scene | draw calls | triangles | note |
| --- | --- | --- | --- |
| 8 fighters, before LOD | ~980 | ~457 k | fighters 226 k |
| 8 fighters, after LOD | ~980 | ~207 k | fighters 87 k (≈9.5 k each) |
| 2 fighters | ~455 | ~178 k | |

Levers in place: geometry segment scaling by roster size (`setSegScale`), baked static fighter parts per material,
instanced scatter for foliage/crystals/props, pooled instanced particles (2 draws), `?quality=` pin, adaptive
quality (resolution → bloom → shadows) that also hides fine stage/fighter detail. Remaining headroom: reduce shadow
casters on small fighter parts, and merge limb material bands.

## Tooling added
* `/viewer?stage=…&cam=x,y,zoom&time=N&spread=1` – establishing shots; `&fx=light|mid|heavy|kill&kind=…` – impact art.
* `scripts/qa/stage-shots.mjs`, `hit-shots.mjs`, `perf-stats.mjs`; `AIRBRAWL_QUERY=?quality=0` for match scripts.
* `tests/anim.test.ts` – animation regression (finite/bounded poses across a full bot match, spring stability,
  snap behaviour). It caught two real bugs: unbounded tumble spin and drifting joints during hitlag.

## Still open (honest list)
* Audio, haptics and real-phone feel are untouched and unverified.
* Real-GPU frame rate unverified; budget above is from counters, not wall-clock on target hardware.
* Characters are procedural primitives with good construction, not sculpted meshes; close-ups (zoom > 3×) show it.
* Foundry is the least refined stage (monochrome heat, boxy cavern rock); Proving Ground vines are still schematic.
* Results/lobby React screens were not redesigned beyond inheriting palette changes.
