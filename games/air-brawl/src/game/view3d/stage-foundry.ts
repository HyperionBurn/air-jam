import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StageDef } from "../sim/types";
import { roundedBox } from "./geo";
import { basalt, metalPlate, softGlow } from "./proc-tex";
import {
  assembleStage,
  compose,
  cylGeo,
  followPlatforms,
  glowCard,
  lumpGeo,
  newCtx,
  pbr,
  rng,
  ridge,
  Scatter,
  texBox,
  waterfall,
  type BuildCtx,
  type Stage3D,
} from "./stage-common";
import { buildHazards } from "./stage-hazards";

/* The Foundry: a molten cavern. Lava is the light source - warm light from below, cool dark rock above,
 * a clear orange value ramp from the glowing floor up to the cavern ceiling. */

const gearGeo = (radius: number, teeth: number, thick: number): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const body = new CylinderGeometry(radius, radius, thick, 36);
  body.rotateX(Math.PI / 2);
  parts.push(body);
  for (let i = 0; i < teeth; i += 1) {
    const a = (i / teeth) * Math.PI * 2;
    const t = new BoxGeometry(radius * 0.22, radius * 0.2, thick);
    t.translate(radius * 1.04, 0, 0);
    t.rotateZ(a);
    parts.push(t);
  }
  const hub = new CylinderGeometry(radius * 0.25, radius * 0.25, thick * 1.6, 14);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  for (const p of parts) p.dispose();
  return merged ?? new BufferGeometry();
};

export const buildFoundry = (def: StageDef): Stage3D => {
  const ctx = newCtx(def);
  const { group, track, detail } = ctx;
  const r = rng(53);

  const rockMat = track(pbr(basalt(0x3a3038, 0xff6a1f), { color: 0x8e8aa6, roughness: 0.92, bump: 3.0, env: 0.4, emissive: 0xffffff, emissiveIntensity: 0.85 }));
  const rockFar = track(new MeshStandardMaterial({ color: 0x40283a, roughness: 1, metalness: 0, emissive: 0x1a0a0a, emissiveIntensity: 1 }));
  const iron = track(pbr(metalPlate(0x5b5560, 0x14111a, 4), { roughness: 0.5, metalness: 0.75, bump: 1.4, env: 1.0 }));
  const ironDark = track(pbr(metalPlate(0x3a3540, 0x0e0c12, 3), { roughness: 0.6, metalness: 0.7, bump: 1.4, env: 0.8 }));
  const brass = track(new MeshStandardMaterial({ color: 0xb4783a, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.2 }));
  const hot = track(new MeshBasicMaterial({ color: 0xff8a2a }));
  const hotter = track(new MeshBasicMaterial({ color: 0xffd27a }));

  /* ---------------------------------------------------------------- lava */
  const lavaMat = track(
    new ShaderMaterial({
      uniforms: { time: { value: 0 } },
      fog: false,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float time; varying vec3 vW;
        vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
        // Cellular edge distance: small near plate borders.
        vec2 cells(vec2 p){
          vec2 g = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0;
          for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
            vec2 o = vec2(float(i), float(j));
            vec2 r = o + h2(g+o) - f;
            float d = dot(r,r);
            if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return vec2(sqrt(d2)-sqrt(d1), d1);
        }
        void main(){
          vec2 base = vW.xz*0.0011;
          vec2 warp = vec2(fbm(base*1.6 + time*0.004), fbm(base*1.6 + 7.0 - time*0.003)) - 0.5;
          vec2 p = base*3.2 + warp*0.9 + vec2(time*0.006, -time*0.003);
          vec2 c = cells(p);
          float seam = 1.0 - smoothstep(0.0, 0.16, c.x);
          float molten = smoothstep(0.52, 0.78, fbm(base*2.4 - time*0.004));
          vec3 plate = vec3(0.075,0.03,0.03) + vec3(0.07,0.03,0.0)*fbm(p*5.0) + vec3(0.04,0.01,0.0)*c.y;
          vec3 glow = mix(vec3(0.95,0.26,0.04), vec3(1.0,0.62,0.18), seam);
          float pulse = 0.78 + 0.22*sin(time*0.5 + h(floor(p))*6.28);
          vec3 col = plate + glow * (seam*1.15*pulse + molten*0.55);
          gl_FragColor = vec4(col*0.9, 1.0);
        }`,
    }),
  );
  const lava = new Mesh(track(new PlaneGeometry(14000, 7000, 1, 1)), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(0, -800, -2200);
  lava.frustumCulled = false;
  group.add(lava);
  const lavaGlow = glowCard(0xff7a2d, 9000, 1300, 0.14, false);
  lavaGlow.position.set(0, -690, -900);
  group.add(lavaGlow);
  const lavaLight = new PointLight(0xff6a22, 1.3e5, 3200, 1.3);
  lavaLight.position.set(0, -520, 260);
  group.add(lavaLight);

  /* -------------------------------------------------------------- cavern */
  ridge(ctx, { width: 16000, z: -6500, baseY: -400, height: 1200, top: 0x6a2a18, bottom: 0xc4551f, seed: 31, roughness: 1.0, jag: 0.25 });
  ridge(ctx, { width: 15000, z: -5000, baseY: -460, height: 1000, top: 0x4a1d12, bottom: 0x9a3c18, seed: 37, roughness: 1.1, jag: 0.3 });
  const furnaceGlow = glowCard(0xff9a40, 7000, 2800, 0.3, false);
  furnaceGlow.position.set(0, 120, -6300);
  group.add(furnaceGlow);

  // Wall masses.
  const wallSet = new Scatter();
  for (let i = 0; i < 26; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const s = 300 + r() * 560;
    const g = lumpGeo(s, 300 + i);
    g.scale(1, 1 + r() * 0.8, 0.9);
    const near = i < 10;
    wallSet.add(near ? "wallNear" : "wallFar", g, near ? rockMat : rockFar, compose(side * (1300 + r() * 1500) + (r() - 0.5) * 300, (r() - 0.35) * 2000 + 200, near ? -500 - r() * 900 : -1400 - r() * 2200, r() * 6, r() * 6, r() * 6, 1, 1, 1));
  }
  wallSet.flush(group);
  // Stalactites.
  const stalGeo = track(new ConeGeometry(120, 760, 7, 1));
  stalGeo.rotateX(Math.PI);
  const stalSet = new Scatter();
  for (let i = 0; i < 34; i += 1) {
    const s = 0.5 + r() * 1.4;
    stalSet.add("stal", stalGeo, rockMat, compose((r() - 0.5) * 6500, 2100 + r() * 300, -600 - r() * 2800, 0, r() * 6, 0, s, s * (0.8 + r() * 0.8), s));
  }
  stalSet.flush(group);

  // Lava falls from the ceiling openings.
  for (let i = 0; i < 5; i += 1) {
    const x = -2600 + i * 1300 + (r() - 0.5) * 300;
    waterfall(ctx, { x, top: 1700, bottom: -800, z: -2600 - r() * 900, width: 130 + r() * 90, tint: 0xff8a2a, opacity: 0.85, fog: false, speed: 0.012, additive: true });
  }

  /* ----------------------------------------------------------- machinery */
  const gears: { m: Mesh; v: number }[] = [];
  const gearMat = track(pbr(metalPlate(0x6a5c58, 0x1a1210, 3), { roughness: 0.55, metalness: 0.7, bump: 1.2, env: 0.8 }));
  for (const [gx, gy, gz, gr, gv] of [[-1700, 900, -1900, 330, 1], [1750, 760, -2100, 420, -1], [-300, 1300, -3000, 560, 1], [900, 1500, -2800, 260, -1.6]] as const) {
    const m = new Mesh(track(gearGeo(gr, 14, 70)), gearMat);
    m.position.set(gx, gy, gz);
    group.add(m);
    gears.push({ m, v: gv / gr });
  }
  ctx.animators.push((_w, time) => {
    for (const g of gears) g.m.rotation.z = time * g.v * 0.5;
  });
  // Pistons.
  const pistons: { rod: Mesh; base: number }[] = [];
  for (const [px, pz] of [[-2300, -1100], [2400, -1250]] as const) {
    const housing = new Mesh(track(cylGeo(60, 60, 700, 14)), ironDark);
    housing.position.set(px, 450, pz);
    group.add(housing);
    const rod = new Mesh(track(cylGeo(34, 34, 700, 12)), brass);
    rod.position.set(px, 950, pz);
    group.add(rod);
    pistons.push({ rod, base: 950 });
  }
  ctx.animators.push((_w, time) => {
    pistons.forEach((p, i) => {
      p.rod.position.y = p.base + Math.sin(time * 0.03 + i * 2) * 170;
    });
  });
  // Smelter vat pouring into the lake.
  const vat = new Group();
  const tank = new Mesh(track(new CylinderGeometry(150, 120, 230, 24, 1, true)), iron);
  vat.add(tank);
  const lip = new Mesh(track(new TorusGeometry(150, 10, 8, 32)), brass);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 115;
  vat.add(lip);
  const molten = new Mesh(track(new CylinderGeometry(138, 138, 6, 24)), hotter);
  molten.position.y = 98;
  vat.add(molten);
  vat.rotation.z = -0.5;
  vat.position.set(-1250, 1050, -950);
  group.add(vat);
  const armMat = ironDark;
  const arm = new Mesh(track(new BoxGeometry(22, 1100, 22)), armMat);
  arm.position.set(-1250 - 160, 1520, -950);
  group.add(arm);
  waterfall(ctx, { x: -1250 + 130, top: 1000, bottom: -800, z: -930, width: 70, tint: 0xffb84a, opacity: 0.95, fog: false, speed: 0.03, additive: true });
  // Crane + hook.
  const crane = new Group();
  const mast = new Mesh(track(new BoxGeometry(60, 1900, 60)), ironDark);
  mast.position.y = 400;
  crane.add(mast);
  const jib = new Mesh(track(new BoxGeometry(1100, 44, 44)), ironDark);
  jib.position.set(-480, 1330, 0);
  crane.add(jib);
  const hookChain = new Group();
  const chainRod = new Mesh(track(cylGeo(5, 5, 520, 6)), ironDark);
  chainRod.position.y = -260;
  hookChain.add(chainRod);
  const hook = new Mesh(track(new TorusGeometry(26, 8, 8, 16, Math.PI * 1.5)), brass);
  hook.position.y = -540;
  hookChain.add(hook);
  hookChain.position.set(-900, 1310, 0);
  crane.add(hookChain);
  crane.position.set(1500, -100, -1350);
  group.add(crane);
  ctx.animators.push((_w, time) => {
    hookChain.rotation.z = Math.sin(time * 0.012) * 0.07;
  });
  // Catwalks and smokestacks.
  const walkSet = new Scatter();
  const railGeo = track(new BoxGeometry(1, 1, 1));
  for (const [cy, cz, cx, len] of [[320, -1550, -300, 3600], [980, -2300, 400, 4200]] as const) {
    walkSet.add("walk", railGeo, ironDark, compose(cx, cy, cz, 0, 0, 0, len, 16, 90));
    walkSet.add("walk", railGeo, ironDark, compose(cx, cy + 64, cz - 40, 0, 0, 0, len, 6, 6));
    for (let i = 0; i < Math.floor(len / 160); i += 1) walkSet.add("post", railGeo, ironDark, compose(cx - len / 2 + i * 160, cy + 32, cz - 40, 0, 0, 0, 6, 64, 6));
  }
  walkSet.flush(group);
  for (const [sx, sz, sh] of [[-3000, -2500, 2400], [3100, -2900, 2900]] as const) {
    const stack = new Mesh(track(new CylinderGeometry(120, 170, sh, 14)), rockFar);
    stack.position.set(sx, sh / 2 - 700, sz);
    group.add(stack);
    const glow = glowCard(0xff7a2d, 700, 700, 0.7, false);
    glow.position.set(sx, sh - 700, sz + 40);
    group.add(glow);
  }

  /* ------------------------------------------------------------ platforms */
  const visuals: { group: Group; baseX: number; baseY: number }[] = [];
  const stripeHot = track(new MeshBasicMaterial({ color: 0xff7a1d }));
  def.platforms.forEach((p) => {
    const g = new Group();
    if (p.solid) {
      const W = p.w;
      const DEPTH = 300;
      const cz = -60;
      const deck = new Mesh(track(texBox(W, 26, DEPTH, 200)), iron);
      deck.position.set(W / 2, -13, cz);
      deck.castShadow = true;
      deck.receiveShadow = true;
      g.add(deck);
      // Hot grating strips glowing from below.
      for (let i = 0; i < 7; i += 1) {
        const strip = new Mesh(track(new BoxGeometry(W * 0.075, 1.2, DEPTH * 0.82)), hot);
        strip.position.set(W * (0.14 + i * 0.12), 0.9, cz);
        g.add(strip);
      }
      const edge = new Mesh(track(new BoxGeometry(W + 20, 20, 22)), brass);
      edge.position.set(W / 2, -6, cz + DEPTH / 2 + 6);
      edge.castShadow = true;
      g.add(edge);
      const trim = new Mesh(track(new BoxGeometry(W + 4, 3.5, 3)), stripeHot);
      trim.position.set(W / 2, -22, cz + DEPTH / 2 + 18);
      g.add(trim);
      for (let i = 0; i < 12; i += 1) {
        const rivet = new Mesh(track(new SphereGeometry(5, 8, 6)), brass);
        rivet.position.set(W * (0.04 + i * 0.083), -6, cz + DEPTH / 2 + 18);
        g.add(rivet);
      }
      const front = new Mesh(track(texBox(W, 64, DEPTH - 20, 180)), ironDark);
      front.position.set(W / 2, -56, cz);
      front.castShadow = true;
      g.add(front);
      // Truss lattice under the deck, down to heavy pylons into the lava.
      const beamGeo = track(new BoxGeometry(1, 1, 1));
      const truss = new Scatter();
      const trussH = 560;
      for (let i = 0; i < 6; i += 1) {
        const x0 = W * (0.1 + i * 0.16);
        const x1 = W * (0.18 + i * 0.16);
        const len = Math.hypot(x1 - x0, trussH * 0.36);
        const ang = Math.atan2(trussH * 0.36, x1 - x0);
        truss.add("diag", beamGeo, ironDark, compose((x0 + x1) / 2, -100 - trussH * 0.18, cz + 80, 0, 0, ang * (i % 2 ? 1 : -1), len, 14, 16));
      }
      for (const fx of [0.08, 0.36, 0.64, 0.92]) truss.add("pylon", beamGeo, iron, compose(W * fx, -100 - trussH / 2, cz, 0, 0, 0, 44, trussH, 70));
      for (const fy of [0.3, 0.62, 0.9]) truss.add("girder", beamGeo, ironDark, compose(W / 2, -100 - trussH * fy, cz + 40, 0, 0, 0, W * 0.86, 18, 24));
      truss.flush(g);
      // Furnace mouth glowing under the centre.
      const mouthGlow = glowCard(0xff8a2a, 520, 380, 0.5, false);
      mouthGlow.position.set(W / 2, -230, cz + 130);
      g.add(mouthGlow);
      ctx.animators.push((_w, time) => {
        (mouthGlow.material as MeshBasicMaterial).opacity = 0.42 + 0.1 * Math.sin(time * 0.1);
      });
      // Back-deck props: furnace stacks, console, barrels, pipe run, gantry lamp.
      for (const fx of [0.1, 0.9]) {
        const stack = new Mesh(track(new CylinderGeometry(30, 38, 220, 14)), ironDark);
        stack.position.set(W * fx, 110, cz - 140);
        stack.castShadow = true;
        g.add(stack);
        const rimM = new Mesh(track(new TorusGeometry(31, 5, 6, 18)), brass);
        rimM.rotation.x = Math.PI / 2;
        rimM.position.set(W * fx, 222, cz - 140);
        g.add(rimM);
        const flame = glowCard(0xffa24d, 200, 260, 0.95, false);
        flame.position.set(W * fx, 270, cz - 128);
        g.add(flame);
        ctx.animators.push((_w, time) => {
          flame.scale.set(1 + 0.08 * Math.sin(time * 0.37 + fx * 9), 1 + 0.16 * Math.sin(time * 0.29 + fx * 5), 1);
        });
      }
      const console_ = new Mesh(track(roundedBox(130, 70, 60, 6)), iron);
      console_.position.set(W * 0.3, 35, cz - 150);
      console_.castShadow = true;
      g.add(console_);
      for (let i = 0; i < 5; i += 1) {
        const led = new Mesh(track(new SphereGeometry(3.4, 8, 6)), i % 2 ? hot : track(new MeshBasicMaterial({ color: 0x58ff9a })));
        led.position.set(W * 0.3 - 42 + i * 21, 56, cz - 119);
        g.add(led);
      }
      const barrelGeo = track(new CylinderGeometry(22, 22, 50, 14));
      for (let i = 0; i < 4; i += 1) {
        const b = new Mesh(barrelGeo, i % 2 ? brass : ironDark);
        b.position.set(W * (0.62 + (i % 2) * 0.05), 25 + (i > 1 ? 50 : 0), cz - 150 + (i % 2) * 20);
        b.castShadow = true;
        g.add(b);
      }
      const pipe = new Mesh(track(cylGeo(9, 9, W * 0.8, 10)), brass);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(W / 2, 56, cz - 168);
      g.add(pipe);
      for (const fx of [0.2, 0.5, 0.8]) {
        const valve = new Mesh(track(new TorusGeometry(14, 3, 6, 14)), hot);
        valve.position.set(W * fx, 72, cz - 160);
        g.add(valve);
      }
      const gantry = new Group();
      for (const s of [-1, 1]) {
        const post = new Mesh(track(new BoxGeometry(18, 300, 18)), ironDark);
        post.position.set(s * 250, 150, 0);
        gantry.add(post);
      }
      const beam = new Mesh(track(new BoxGeometry(540, 22, 22)), ironDark);
      beam.position.y = 300;
      gantry.add(beam);
      const lamp = new Group();
      const lampWire = new Mesh(track(cylGeo(2, 2, 70, 5)), ironDark);
      lampWire.position.y = -35;
      lamp.add(lampWire);
      const lampBulb = new Mesh(track(new SphereGeometry(13, 12, 8)), hotter);
      lampBulb.position.y = -80;
      lamp.add(lampBulb);
      const lampGlow = glowCard(0xffc27a, 280, 280, 0.8, false);
      lampGlow.position.set(0, -80, 6);
      lamp.add(lampGlow);
      lamp.position.set(0, 300, 0);
      gantry.add(lamp);
      gantry.position.set(W / 2, 0, cz - 120);
      g.add(gantry);
      ctx.animators.push((_w, time) => {
        lamp.rotation.z = Math.sin(time * 0.02) * 0.06;
      });
      void softGlow;
    } else {
      const slab = new Mesh(track(texBox(p.w, 12, 118, 120)), iron);
      slab.position.set(p.w / 2, -6, 0);
      slab.castShadow = true;
      slab.receiveShadow = true;
      g.add(slab);
      const mesh = new Mesh(track(texBox(p.w * 0.94, 8, 100, 120)), ironDark);
      mesh.position.set(p.w / 2, -16, 0);
      g.add(mesh);
      const e = new Mesh(track(new BoxGeometry(p.w, 5, 5)), stripeHot);
      e.position.set(p.w / 2, -5, 59);
      g.add(e);
      const heat = glowCard(0xff7a2d, p.w * 1.1, 90, 0.55, false);
      heat.position.set(p.w / 2, -p.h - 40, 6);
      g.add(heat);
      // Hanging chains up into the dark.
      for (const fx of [0.1, 0.9]) {
        const chain = new Mesh(track(cylGeo(3.4, 3.4, 2400, 6)), ironDark);
        chain.position.set(p.w * fx, 1200, -10);
        g.add(chain);
        const lug = new Mesh(track(new TorusGeometry(10, 3, 6, 12)), brass);
        lug.position.set(p.w * fx, 6, -10);
        g.add(lug);
      }
    }
    group.add(g);
    visuals.push({ group: g, baseX: p.x, baseY: p.y });
  });
  followPlatforms(ctx, visuals);

  buildHazards(ctx, { beam: 0xff6aa8, geyser: 0xff8a2d });

  // Slow-drifting smoke banks add depth between the lake and the machinery.
  const smoke: Mesh[] = [];
  for (let i = 0; i < 9; i += 1) {
    const m = new Mesh(
      track(new PlaneGeometry(1900, 520)),
      track(new MeshBasicMaterial({ map: softGlow(), color: i % 2 ? 0x5a2a1a : 0x8a3a18, transparent: true, opacity: 0.4, depthWrite: false, fog: false, blending: i % 3 === 0 ? AdditiveBlending : 1 })),
    );
    m.position.set(-3000 + i * 780, -420 + (i % 3) * 260, -700 - i * 360);
    detail.add(m);
    smoke.push(m);
  }
  ctx.animators.push((_w, time, focus) => {
    lavaMat.uniforms.time.value = time;
    lava.position.x = focus.x;
    lavaLight.position.x = focus.x;
    lavaLight.intensity = 1.3e5 * (0.92 + 0.08 * Math.sin(time * 0.2));
    smoke.forEach((m, i) => {
      m.position.x += Math.sin(time * 0.004 + i) * 0.4;
    });
  });
  void Color;
  void Vector3;

  return assembleStage(ctx, {
    sky: {
      top: "#1e0c0a",
      mid: "#5e2614",
      horizon: "#d96a2a",
      bottom: "#9a3a14",
      horizonGlow: { color: "#ff9a4a", strength: 0.75, width: 0.18 },
    },
    fog: { color: 0x6a2c1a, near: 4200, far: 16000 },
    background: 0x6a2a14,
    key: { color: 0xffe2c4, intensity: 2.3, dir: [-420, 900, 700] },
    hemi: { sky: 0x9a8aa8, ground: 0xff6a28, intensity: 0.5 },
    rim: { color: 0x8fb4ff, intensity: 1.6, pos: [-700, 500, -600] },
    look: {
      exposure: 0.9,
      bloom: { strength: 0.36, radius: 0.6, threshold: 0.85 },
      grade: { saturation: 0.8, contrast: 1.12, tint: [1.04, 1.0, 0.95], lift: [0.04, 0.02, 0.02], vignette: 0.34 },
      envIntensity: 0.55,
    },
    envCards: [{ color: 0xff8a3a, x: 0, y: -600, z: -300, w: 1500, h: 500, intensity: 4 }],
  });
};

export type { BuildCtx };
