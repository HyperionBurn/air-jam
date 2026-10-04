# Air Brawl — art direction

Findings from studying a 13-minute 4K platform-fighter gameplay reference (frames extracted
at 12 timestamps plus two 16-frame animation contact sheets). The reference is used only to
calibrate **style, lighting, camera, HUD structure and effect timing**. No characters, stages,
logos or other assets are reproduced; every fighter, stage and effect here is original.

## What the reference does (and what the first Air Brawl build got wrong)

| Area | Reference | First build (rejected) | Now |
| --- | --- | --- | --- |
| Rendering | Real 3D, perspective camera, depth in every stage | Flat 2D vector sprites | three.js scene, perspective camera (≈30° FOV), real parallax |
| Characters | Smooth-shaded 3D bodies, specular + rim light, **no thick outlines**, soft contact shadows | Thick black outlines, flat fills ("paper mache") | Articulated 3D models, PBR-ish materials, rim light, shadow maps |
| Scale | Fighters are small (≈12–22 % of screen height); the *stage* is the star | Fighters filled ≈40 % of the screen | Camera framing min box ≈1250×700 world units |
| Stages | Lit, layered, atmospheric (sunset glow, lava bloom, volumetric shafts) | Painted gradients | Procedural 3D scenery, emissive accents, fog, bloom |
| Effects | White billowy puffs, hot starbursts, speed streaks, glowing shield sphere, radial flash on KO | Round blobs | Pooled billboard sprites with the same vocabulary |
| HUD | Bottom row, slanted portrait tile, big italic outlined percent (white → yellow → orange → red) with small decimal, thin name plate, small stock icons, small "P1/CPU" chevron tags | Large boxy cards | Rebuilt around the same structure with original colours/shapes |
| Animation | Anticipation → strike → recovery, weight shifts, squash on jump/land, secondary motion on cloth/hair | Single-limb swing | 2-bone limbs, lunge/lean on strikes, squash/stretch, spring chains |

## Pillars

1. **Readable first.** Eight players on a projector: slot colour *and* shape on every identity element.
2. **Light does the work.** Key (warm) + rim (cool) + hemisphere fill, ACES tone-mapping, selective bloom on emissive trims.
3. **Impact has a vocabulary.** Hitlag freeze → white-hot starburst → debris/streaks → camera punch. KO adds a radial flash and slow-mo.
4. **Stage is a character.** Each stage has a distinct light colour, silhouette and hazard language.

## Performance budget

* Host target 60 fps at 1080p on integrated GPUs: ≤ 40 draw calls for stages, ≤ 25 meshes per fighter, one shadow cascade (2048²), one bloom pass at half resolution.
* "Reduced effects" halves particles and disables bloom/shadow softening.
