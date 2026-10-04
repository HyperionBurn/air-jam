import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import type { StageDef } from "../sim/types";
import { fbm, grassTurf, repeated, rockStrata, stoneBlocks } from "./proc-tex";
import {
  assembleStage,
  cloudField,
  compose,
  crystalGeo,
  cylGeo,
  followPlatforms,
  glowCard,
  lumpGeo,
  lightShaft,
  mergeTinted,
  newCtx,
  pbr,
  pineGeo,
  rng,
  ridge,
  rockHull,
  roundTreeGeo,
  Scatter,
  texBox,
  tintGeo,
  waterfall,
  type BuildCtx,
  type Stage3D,
} from "./stage-common";

/* Proving Ground ("Aether Arena"): a sunlit proving ring above a cloud sea.
 * Value structure: bright sky → hazy far islands → mid-tone ruins → saturated, high-contrast arena. */

const HULL_TAPER = 0.8;

/** Point on the front face of a hull (t = 0 top .. 1 bottom, theta in radians; PI/2 is dead-front). */
const hullFront = (w: number, depth: number, height: number, t: number, theta: number): Vector3 => {
  const k = Math.pow(1 - t, HULL_TAPER);
  return new Vector3(Math.cos(theta) * (w / 2) * k, -t * height, Math.sin(theta) * (depth / 2) * k);
};

const vineGeo = (seed: number): BufferGeometry => {
  const r = rng(seed);
  const parts: BufferGeometry[] = [];
  const len = 90 + r() * 150;
  const stem = new CylinderGeometry(1.1, 2.4, len, 5, 1);
  stem.translate(0, -len / 2, 0);
  parts.push(tintGeo(stem, 0x4d7a3a, 0x2c4f2a, -len, 0));
  const leaves = 7 + Math.floor(r() * 5);
  for (let i = 0; i < leaves; i += 1) {
    const l = new IcosahedronGeometry(2.6 + r() * 2.4, 0);
    l.scale(0.7, 1.5, 0.9);
    l.rotateY(r() * 6);
    l.translate((r() - 0.5) * 16, -len * (0.12 + (i / leaves) * 0.85), (r() - 0.5) * 10);
    parts.push(tintGeo(l, 0x2d7a3a, 0x8fd35a));
  }
  return mergeTinted(parts);
};

const islandTop = (radius: number, seed: number): BufferGeometry => {
  const g = new CylinderGeometry(radius, radius * 0.9, radius * 0.16, 28, 3);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const ang = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    const n = 1 + (fbm(ang, 0.5, 6, 3, seed) - 0.5) * 0.35;
    const bump = y > 0 ? (fbm((x / radius) * 0.5 + 0.5, (z / radius) * 0.5 + 0.5, 4, 3, seed + 4) - 0.5) * radius * 0.07 : 0;
    pos.setXYZ(i, x * n, y + bump, z * n);
  }
  g.computeVertexNormals();
  return g;
};

interface ArenaMats {
  stoneMat: MeshStandardMaterial;
  deckTop: MeshStandardMaterial;
  rockMat: MeshStandardMaterial;
  turf: MeshStandardMaterial;
  marble: MeshStandardMaterial;
  foliage: MeshStandardMaterial;
  crystalMat: MeshBasicMaterial;
  glowStone: MeshBasicMaterial;
  roundGeo: BufferGeometry;
  pineG: BufferGeometry;
  crystalG: BufferGeometry;
  bushGeo: BufferGeometry;
  petalGeo: BufferGeometry;
  petalMat: MeshBasicMaterial;
  vines: BufferGeometry[];
}

export const buildProvingGround = (def: StageDef): Stage3D => {
  const ctx = newCtx(def);
  const { group, track, scatter, detail } = ctx;
  const r = rng(11);

  /* ---------------------------------------------------------- materials */
  const stoneMat = track(pbr(stoneBlocks(0xd8d0bd, 0x6f9a4a, 4, 7), { roughness: 0.82, bump: 2.4, env: 0.7 }));
  const deckTop = track(pbr(stoneBlocks(0xe9e2d0, 0x7ca95a, 3, 5), { roughness: 0.78, bump: 1.6, env: 0.8 }));
  const marble = track(pbr(stoneBlocks(0xf0ebe0, 0x90b878, 2, 3), { roughness: 0.55, bump: 1.0, env: 1.0 }));
  const rockMat = track(pbr(repeated(rockStrata(0xa59685, 0x62606f, 5), 3.5, 1.4), { roughness: 0.95, bump: 3.2, env: 0.5 }));
  const farRock = track(pbr(repeated(rockStrata(0x9fa3b8, 0x7e86a6, 9), 2.5, 1), { roughness: 1, bump: 1.5, env: 0.3 }));
  const turf = track(pbr(repeated(grassTurf(0x6dc255, 0x3c8a45), 6, 6), { roughness: 0.95, bump: 1.0, env: 0.4 }));
  const foliage = track(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  const glowStone = track(new MeshBasicMaterial({ color: 0x7fe8ff }));
  const crystalMat = track(new MeshBasicMaterial({ vertexColors: true }));
  const roundGeo = track(roundTreeGeo(0x6b4a32, 0x2f7a40, 0x9be060, 3));
  const pineG = track(pineGeo(0x5a3d2a, 0x1f6a4c, 0x5bbf7a));
  const crystalG = track(crystalGeo(5, 8));

  /* -------------------------------------------------------------- far sky */
  ridge(ctx, { width: 16000, z: -7600, baseY: -520, height: 520, top: 0xb7cde4, bottom: 0xdbe8f2, seed: 4, roughness: 1.1 });
  ridge(ctx, { width: 14000, z: -6400, baseY: -620, height: 420, top: 0x9fb9d4, bottom: 0xc9dcec, seed: 8, roughness: 0.9 });
  cloudField(ctx, { count: 12, x: [-7000, 7000], y: [900, 2600], z: [-7600, -5200], size: [1500, 3000], tint: 0xf4f8ff, opacity: 0.6, speed: 0.25, seed: 3 });
  cloudField(ctx, { count: 46, x: [-5200, 5200], y: [-1500, -950], z: [-4200, -500], size: [700, 1500], tint: 0xfff4e6, opacity: 0.97, speed: 0.55, seed: 7 });
  cloudField(ctx, { count: 9, x: [-4200, 4200], y: [-300, 800], z: [-5600, -3400], size: [700, 1500], tint: 0xf0f6ff, opacity: 0.55, speed: 0.35, seed: 13 });

  /* ------------------------------------------------------- landmark ring */
  const ring = new Group();
  const ringMat = track(pbr(stoneBlocks(0xcfc7b6, 0x7b9a63, 2, 18), { roughness: 0.8, bump: 1.5, env: 0.6 }));
  ring.add(new Mesh(track(new TorusGeometry(640, 38, 14, 96)), ringMat));
  const runeMat = track(new MeshBasicMaterial({ color: 0x9be8ff, fog: true }));
  const runeGeo = track(new BoxGeometry(46, 8, 70));
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    const seg = new Mesh(runeGeo, runeMat);
    seg.position.set(Math.cos(a) * 640, Math.sin(a) * 640, 0);
    seg.rotation.z = a + Math.PI / 2;
    seg.scale.set(1, 1, i % 3 === 0 ? 1.3 : 0.7);
    ring.add(seg);
  }
  for (const s of [-1, 1]) {
    const pylon = new Mesh(track(new BoxGeometry(150, 1400, 130)), stoneMat);
    pylon.position.set(s * 780, -330, -40);
    ring.add(pylon);
    const cap = new Mesh(track(new BoxGeometry(210, 60, 180)), marble);
    cap.position.set(s * 780, 380, -40);
    ring.add(cap);
  }
  ring.position.set(0, 560, -2900);
  group.add(ring);
  const ringGlow = glowCard(0xaee6ff, 2200, 2200, 0.09, true);
  ringGlow.position.set(0, 560, -2940);
  group.add(ringGlow);
  ctx.animators.push((_w, time) => {
    ring.rotation.z = time * 0.0008;
    ringGlow.scale.setScalar(1 + Math.sin(time * 0.01) * 0.04);
  });

  /* ------------------------------------------------------ floating islands */
  const makeIsland = (
    radius: number,
    x: number,
    y: number,
    z: number,
    seed: number,
    opts: { trees?: number; ruins?: boolean; crystals?: number; far?: boolean } = {},
  ): Group => {
    const g = new Group();
    const rr = rng(seed);
    const local = new Scatter();
    g.add(new Mesh(track(islandTop(radius, seed)), turf));
    const hull = new Mesh(
      track(rockHull({ width: radius * 2.05, depth: radius * 1.9, height: radius * 1.9, seed, taper: 0.62, radial: 30, rows: 12 })),
      opts.far ? farRock : rockMat,
    );
    hull.position.y = -radius * 0.05;
    g.add(hull);
    for (let i = 0; i < (opts.trees ?? 4); i += 1) {
      const a = rr() * Math.PI * 2;
      const d = Math.sqrt(rr()) * radius * 0.78;
      const s = (0.35 + rr() * 0.4) * (radius / 260);
      const round = rr() < 0.65;
      local.add(
        round ? "round" : "pine",
        round ? roundGeo : pineG,
        foliage,
        compose(Math.cos(a) * d, radius * 0.08, Math.sin(a) * d * 0.8, 0, rr() * 6, 0, s, s * (0.9 + rr() * 0.4), s),
        new Color().setHSL(0.27 + rr() * 0.08, 0.5, 0.55 + rr() * 0.2),
      );
    }
    if (opts.ruins) {
      const c = new Group();
      for (let i = 0; i < 5; i += 1) {
        const h = 90 + rr() * 140;
        const col = new Mesh(track(cylGeo(13, 15, h, 12)), marble);
        col.position.set((i - 2) * 46, h / 2 + radius * 0.08, -10 + rr() * 20);
        col.rotation.z = (rr() - 0.5) * 0.08;
        c.add(col);
        const cap = new Mesh(track(new BoxGeometry(40, 10, 40)), marble);
        cap.position.set(col.position.x, h + radius * 0.08 + 4, col.position.z);
        c.add(cap);
      }
      const lintel = new Mesh(track(new BoxGeometry(250, 26, 52)), marble);
      lintel.position.set(0, 196 + radius * 0.08, -4);
      lintel.rotation.z = 0.03;
      c.add(lintel);
      const steps = new Mesh(track(new BoxGeometry(300, 18, 120)), marble);
      steps.position.set(0, radius * 0.08 + 9, -6);
      c.add(steps);
      c.scale.setScalar(radius / 300);
      g.add(c);
    }
    for (let i = 0; i < (opts.crystals ?? 0); i += 1) {
      const a = rr() * Math.PI * 2;
      const d = radius * (0.35 + rr() * 0.55);
      const s = (0.7 + rr() * 1.1) * (radius / 300);
      local.add("crystal", crystalG, crystalMat, compose(Math.cos(a) * d, radius * 0.07, Math.sin(a) * d * 0.8, 0, rr() * 6, (rr() - 0.5) * 0.4, s, s * 1.2, s));
    }
    local.flush(g);
    g.position.set(x, y, z);
    g.userData = { base: y, phase: rr() * 6.28, amp: 8 + rr() * 8 };
    return g;
  };

  const islands: Group[] = [];
  const far: [number, number, number, number][] = [
    [-3600, 700, -5200, 780],
    [3400, 1100, -5600, 900],
    [-1500, 1500, -6200, 640],
    [1400, 300, -4700, 520],
    [-2300, -200, -4400, 560],
    [4600, 100, -4600, 600],
    [-4700, 1000, -4900, 500],
  ];
  far.forEach(([x, y, z, rad], i) => {
    const isl = makeIsland(rad, x, y, z, 40 + i, { trees: 7, far: true, crystals: i % 2 ? 3 : 0 });
    group.add(isl);
    islands.push(isl);
    if (i < 3) waterfall(ctx, { x: x + rad * (i % 2 ? -0.55 : 0.55), top: y + rad * 0.1, bottom: -1000, z: z + 40, width: rad * 0.22, opacity: 0.75, speed: 0.01 });
  });
  const mid: [number, number, number, number, boolean][] = [
    [-1500, 120, -1100, 330, true],
    [1560, 330, -1400, 380, false],
    [-1050, 780, -1900, 260, false],
    [1100, -60, -2100, 300, true],
    [-2300, 300, -2600, 420, false],
    [2400, 760, -2700, 360, true],
  ];
  mid.forEach(([x, y, z, rad, ruins], i) => {
    const isl = makeIsland(rad, x, y, z, 70 + i, { trees: 6, ruins, crystals: 4 });
    group.add(isl);
    islands.push(isl);
    if (i === 1 || i === 4) waterfall(ctx, { x: x - rad * 0.5, top: y + rad * 0.05, bottom: -1000, z: z + 30, width: rad * 0.2, opacity: 0.85, speed: 0.016 });
  });
  ctx.animators.push((_w, time) => {
    for (const g of islands) g.position.y = (g.userData.base as number) + Math.sin(time * 0.012 + (g.userData.phase as number)) * (g.userData.amp as number);
  });

  /* ------------------------------------------------------------ platforms */
  const mats: ArenaMats = {
    stoneMat,
    deckTop,
    rockMat,
    turf,
    marble,
    foliage,
    crystalMat,
    glowStone,
    roundGeo,
    pineG,
    crystalG,
    bushGeo: track(tintGeo(new IcosahedronGeometry(16, 1), 0x2b6b34, 0x7fc552)),
    petalGeo: track(new IcosahedronGeometry(3.2, 0)),
    petalMat: track(new MeshBasicMaterial({ color: 0xffffff })),
    vines: [0, 1, 2, 3, 4, 5].map((i) => track(vineGeo(100 + i))),
  };
  const visuals: { group: Group; baseX: number; baseY: number }[] = [];
  def.platforms.forEach((p) => {
    const g = new Group();
    if (p.solid) buildArena(ctx, g, p.w, mats, r);
    else buildSoftPlatform(ctx, g, p.w, p.h, mats);
    group.add(g);
    visuals.push({ group: g, baseX: p.x, baseY: p.y });
  });
  followPlatforms(ctx, visuals);
  scatter.flush(group);

  /* -------------------------------------------------- atmosphere & shafts */
  for (let i = 0; i < 5; i += 1) lightShaft(ctx, { x: -1500 + i * 520, y: 700, z: -900 - i * 220, width: 340, height: 2600, color: 0xfff2cf, opacity: 0.045, tilt: -0.42, sway: 0.02 });
  const birds: Mesh[] = [];
  const birdGeo = track(new BufferGeometry());
  birdGeo.setAttribute("position", new Float32BufferAttribute([0, 0, 0, -26, 8, 0, -9, -2, 0, 0, 0, 0, 26, 8, 0, 9, -2, 0], 3));
  const birdMat = track(new MeshBasicMaterial({ color: 0x3a4766, side: DoubleSide, fog: true }));
  for (let i = 0; i < 7; i += 1) {
    const b = new Mesh(birdGeo, birdMat);
    b.scale.setScalar(2.2 + r() * 1.5);
    b.userData = { x0: -3000 + r() * 6000, y: 300 + r() * 700, z: -1400 - r() * 1800, v: 0.5 + r() * 0.5, ph: r() * 6 };
    detail.add(b);
    birds.push(b);
  }
  ctx.animators.push((_w, time) => {
    for (const b of birds) {
      const u = b.userData as { x0: number; y: number; z: number; v: number; ph: number };
      const x = ((((u.x0 + time * 3.2 * u.v + 3500) % 7000) + 7000) % 7000) - 3500;
      b.position.set(x, u.y + Math.sin(time * 0.03 + u.ph) * 30, u.z);
      b.scale.y = (0.5 + 0.5 * Math.sin(time * 0.35 + u.ph)) * 2.2 + 0.4;
    }
  });

  return assembleStage(ctx, {
    sky: {
      top: "#1f66cf",
      mid: "#5ea6ec",
      horizon: "#bcd9f4",
      bottom: "#9ec3ea",
      sunDir: new Vector3(-0.45, 0.32, -1),
      sunColor: "#fff2c8",
      sunSize: 120,
      clouds: { color: "#ffffff", shade: "#b9c9e6", amount: 0.5, speed: 0.012, height: 0.32 },
      horizonGlow: { color: "#ffe9c2", strength: 0.35, width: 0.2 },
    },
    fog: { color: 0x9cc2ec, near: 5200, far: 24000 },
    background: 0xbfd8ee,
    key: { color: 0xfff1d6, intensity: 2.5, dir: [-520, 900, 650] },
    hemi: { sky: 0xa7cdff, ground: 0x9fb07a, intensity: 1.15 },
    rim: { color: 0xbfe0ff, intensity: 1.1, pos: [700, 420, -800] },
    look: {
      exposure: 0.98,
      bloom: { strength: 0.3, radius: 0.55, threshold: 0.9 },
      grade: { saturation: 1.3, contrast: 1.1, tint: [1.02, 1.0, 0.97], lift: [0.008, 0.01, 0.02], vignette: 0.22 },
      envIntensity: 0.75,
    },
    envCards: [{ color: 0xfff0cf, x: -700, y: 500, z: -700, w: 520, h: 520, intensity: 5 }],
  });
};

/* ------------------------------------------------------------- arena hero */

function buildArena(ctx: BuildCtx, g: Group, W: number, m: ArenaMats, r: () => number): void {
  const { track } = ctx;
  const scatter = new Scatter();
  const DEPTH = 300;
  const cz = -60;
  const deck = new Mesh(track(texBox(W, 30, DEPTH, 190)), m.deckTop);
  deck.position.set(W / 2, -15, cz);
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  const plinth = new Mesh(track(texBox(W * 0.975, 46, DEPTH - 24, 190)), m.stoneMat);
  plinth.position.set(W / 2, -53, cz);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  g.add(plinth);
  const cornice = new Mesh(track(new BoxGeometry(W + 14, 9, DEPTH + 12)), m.marble);
  cornice.position.set(W / 2, -4, cz);
  cornice.castShadow = true;
  g.add(cornice);
  const inlay = new Mesh(track(new BoxGeometry(W - 70, 3, 3)), m.glowStone);
  inlay.position.set(W / 2, -26, cz + DEPTH / 2 + 2.2);
  g.add(inlay);
  const runeGeo = track(new OctahedronGeometry(7, 0));
  for (let i = 0; i < 9; i += 1) {
    const rune = new Mesh(runeGeo, m.glowStone);
    rune.scale.set(1, 1.6, 0.35);
    rune.position.set(W * (0.1 + i * 0.1), -44, cz + DEPTH / 2 - 10);
    g.add(rune);
  }
  const sigil = new Mesh(track(new TorusGeometry(160, 3, 6, 64)), m.glowStone);
  sigil.rotation.x = Math.PI / 2;
  sigil.position.set(W / 2, 0.8, cz + 10);
  g.add(sigil);
  const sigil2 = new Mesh(track(new TorusGeometry(96, 2, 6, 48)), m.glowStone);
  sigil2.rotation.x = Math.PI / 2;
  sigil2.position.set(W / 2, 0.8, cz + 10);
  g.add(sigil2);

  // Garden strip behind the fighting line.
  const garden = new Mesh(track(new BoxGeometry(W - 30, 7, 130)), m.turf);
  garden.position.set(W / 2, 3.5, cz - 82);
  garden.receiveShadow = true;
  g.add(garden);
  for (let i = 0; i < 16; i += 1) {
    const s = 0.5 + r() * 0.55;
    scatter.add("round", m.roundGeo, m.foliage, compose(W * (0.04 + r() * 0.92), 6, cz - 128 - r() * 24, 0, r() * 6, 0, s, s * (0.9 + r() * 0.4), s), new Color().setHSL(0.26 + r() * 0.07, 0.5, 0.58 + r() * 0.16), true);
  }
  for (let i = 0; i < 6; i += 1) {
    const s = 0.55 + r() * 0.4;
    scatter.add("pine", m.pineG, m.foliage, compose(W * (0.08 + r() * 0.84), 6, cz - 140 - r() * 8, 0, r() * 6, 0, s, s, s), new Color().setHSL(0.35, 0.45, 0.6), true);
  }
  for (let i = 0; i < 40; i += 1) {
    const s = 0.7 + r() * 1.0;
    scatter.add("bush", m.bushGeo, m.foliage, compose(W * (0.03 + r() * 0.94), 8, cz - 70 - r() * 80, 0, r() * 6, 0, s * 1.2, s * 0.8, s), new Color().setHSL(0.25 + r() * 0.08, 0.5, 0.6 + r() * 0.15));
  }
  const petalColors = [0xffd0e6, 0xfff3a8, 0xffffff, 0xffb4a8];
  for (let i = 0; i < 90; i += 1) {
    scatter.add("petal", m.petalGeo, m.petalMat, compose(W * (0.03 + r() * 0.94), 8 + r() * 3, cz - 50 - r() * 100, 0, 0, 0, 1, 1, 1), petalColors[i % 4]);
  }

  // Marble gate and lantern pylons.
  const gate = new Group();
  for (const s of [-1, 1]) {
    const post = new Mesh(track(cylGeo(22, 26, 300, 14)), m.marble);
    post.position.set(s * 230, 150, 0);
    post.castShadow = true;
    gate.add(post);
    const base = new Mesh(track(new BoxGeometry(80, 24, 80)), m.stoneMat);
    base.position.set(s * 230, 12, 0);
    gate.add(base);
    const cap = new Mesh(track(new BoxGeometry(70, 20, 70)), m.marble);
    cap.position.set(s * 230, 310, 0);
    gate.add(cap);
  }
  const lintel = new Mesh(track(new BoxGeometry(560, 34, 62)), m.marble);
  lintel.position.set(0, 342, 0);
  lintel.castShadow = true;
  gate.add(lintel);
  const keystone = new Mesh(track(new OctahedronGeometry(26, 0)), m.glowStone);
  keystone.position.set(0, 345, 36);
  keystone.scale.set(1, 1.5, 0.5);
  gate.add(keystone);
  const keyGlow = glowCard(0x9be8ff, 220, 220, 0.6, false);
  keyGlow.position.set(0, 345, 44);
  gate.add(keyGlow);
  gate.position.set(W / 2, 0, cz - 140);
  g.add(gate);
  for (const s of [-1, 1]) {
    const pylon = new Group();
    const shaft = new Mesh(track(cylGeo(10, 14, 170, 10)), m.marble);
    shaft.position.y = 85;
    shaft.castShadow = true;
    pylon.add(shaft);
    const orb = new Mesh(track(new IcosahedronGeometry(17, 1)), m.glowStone);
    orb.position.y = 196;
    pylon.add(orb);
    const halo = glowCard(0x9be8ff, 300, 300, 0.75, false);
    halo.position.set(0, 196, 8);
    pylon.add(halo);
    pylon.position.set(W / 2 + s * (W / 2 - 34), 0, cz + 70);
    g.add(pylon);
    ctx.animators.push((_w, time) => {
      orb.position.y = 196 + Math.sin(time * 0.05 + s) * 5;
      orb.rotation.y = time * 0.03;
      (halo.material as MeshBasicMaterial).opacity = 0.62 + 0.14 * Math.sin(time * 0.08 + s);
    });
  }

  // Cliff mass under the plinth.
  const HH = 800;
  const hull = new Mesh(track(rockHull({ width: W * 0.93, depth: 258, height: HH, seed: 21, taper: HULL_TAPER, radial: 64, rows: 20, roughness: 1.1 })), m.rockMat);
  hull.position.set(W / 2, -74, cz);
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);
  for (let i = 0; i < 16; i += 1) {
    const t = 0.15 + r() * 0.65;
    const th = Math.PI * (0.08 + r() * 0.84);
    const p = hullFront(W * 0.93, 258, HH, t, th);
    const s = 26 + r() * 62;
    const lump = new Mesh(track(lumpGeo(s, 200 + i)), m.rockMat);
    lump.position.set(W / 2 + p.x * 1.02, -74 + p.y, cz + p.z + s * 0.2);
    lump.castShadow = true;
    g.add(lump);
  }
  for (let i = 0; i < 24; i += 1) {
    const t = r() * 0.16;
    const th = Math.PI * (0.05 + r() * 0.9);
    const p = hullFront(W * 0.93, 258, HH, t, th);
    scatter.add(`vine${i % 6}`, m.vines[i % 6], m.foliage, compose(W / 2 + p.x, -74 + p.y + 8, cz + p.z + 6, 0, r() * 0.6 - 0.3, 0, 0.8 + r() * 0.8), new Color(0xffffff));
  }
  for (let i = 0; i < 14; i += 1) {
    const t = 0.2 + r() * 0.5;
    const th = Math.PI * (0.1 + r() * 0.8);
    const p = hullFront(W * 0.93, 258, HH, t, th);
    const s = 0.9 + r() * 1.4;
    scatter.add("hullcrystal", m.crystalG, m.crystalMat, compose(W / 2 + p.x + Math.cos(th) * 8, -74 + p.y, cz + p.z + Math.sin(th) * 8, Math.PI * 0.5 + (r() - 0.5) * 0.4, -th + Math.PI / 2, (r() - 0.5) * 0.3, s, s, s));
  }
  for (const s of [-1, 1]) {
    const p = hullFront(W * 0.93, 258, HH, 0.02, Math.PI / 2 - s * 0.72);
    waterfall(ctx, { x: W / 2 + p.x * 0.97, top: -78, bottom: -1000, z: cz + p.z + 14, width: 58, opacity: 0.92, fog: true, speed: 0.02, parent: g });
  }
  scatter.flush(g);
}

function buildSoftPlatform(ctx: BuildCtx, g: Group, w: number, h: number, m: ArenaMats): void {
  const { track } = ctx;
  const slab = new Mesh(track(texBox(w, 14, 124, 150)), m.marble);
  slab.position.set(w / 2, -7, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  g.add(slab);
  const under = new Mesh(track(texBox(w * 0.9, 12, 104, 150)), m.stoneMat);
  under.position.set(w / 2, -20, 0);
  under.castShadow = true;
  g.add(under);
  const hull = new Mesh(track(rockHull({ width: w * 0.84, depth: 90, height: 44, seed: 5, taper: 0.5, radial: 26, rows: 6 })), m.rockMat);
  hull.position.set(w / 2, -26, 0);
  hull.castShadow = true;
  g.add(hull);
  const trim = new Mesh(track(new BoxGeometry(w - 26, 3, 3)), m.glowStone);
  trim.position.set(w / 2, -4, 63);
  g.add(trim);
  const runeGeo = track(new OctahedronGeometry(4.5, 0));
  for (let i = 0; i < 5; i += 1) {
    const rune = new Mesh(runeGeo, m.glowStone);
    rune.scale.set(1, 1.7, 0.3);
    rune.position.set(w * (0.12 + i * 0.19), -14, 54);
    g.add(rune);
  }
  const glow = glowCard(0x7fe0ff, w * 0.95, 90, 0.5, false);
  glow.position.set(w / 2, -h - 54, 6);
  g.add(glow);
  const pebbles: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const pb = new Mesh(track(new IcosahedronGeometry(5 + i * 1.6, 0)), m.rockMat);
    pb.position.set(w * (0.2 + i * 0.2), -70 - (i % 2) * 24, (i - 1.5) * 14);
    pb.userData = { y: pb.position.y, ph: i * 1.7 };
    g.add(pb);
    pebbles.push(pb);
  }
  ctx.animators.push((_wd, time) => {
    for (const pb of pebbles) {
      pb.position.y = (pb.userData.y as number) + Math.sin(time * 0.04 + (pb.userData.ph as number)) * 5;
      pb.rotation.y = time * 0.02 + (pb.userData.ph as number);
    }
    (glow.material as MeshBasicMaterial).opacity = 0.44 + 0.08 * Math.sin(time * 0.06);
  });
}
