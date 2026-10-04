import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StageDef } from "../sim/types";
import { roundedBox } from "./geo";
import { concrete, facade, metalPlate, softGlow } from "./proc-tex";
import {
  assembleStage,
  cloudField,
  followPlatforms,
  glowCard,
  lightShaft,
  newCtx,
  pbr,
  rng,
  texBox,
  type BuildCtx,
  type Stage3D,
} from "./stage-common";
import { buildHazards } from "./stage-hazards";

/* Skyline Rush: a rooftop arena at golden hour. Warm low sun, layered hazy towers with lit windows,
 * a monorail, traffic, a blimp and searchlights. Deck is cool concrete so warm light rakes across it. */

const stripeTexture = (): CanvasTexture => {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 16;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#f2c230";
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = "#1a1722";
    for (let i = -2; i < 8; i += 1) {
      g.beginPath();
      g.moveTo(i * 20, 16);
      g.lineTo(i * 20 + 10, 16);
      g.lineTo(i * 20 + 26, 0);
      g.lineTo(i * 20 + 16, 0);
      g.closePath();
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
};

const screenTexture = (seed: number, hueA: string, hueB: string): CanvasTexture => {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, hueA);
    grad.addColorStop(1, hueB);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 9; i += 1) {
      g.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.3})`;
      g.fillRect(r() * 220, 8 + i * 13, 20 + r() * 110, 6 + r() * 6);
    }
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 256, 1);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
};

interface TowerLayer {
  seed: number;
  count: number;
  z: [number, number];
  x: [number, number];
  top: [number, number];
  width: [number, number];
  wall: number;
  lit: number[];
  litRatio: number;
  emissive: number;
  /** Keep this half-width clear directly behind the fighting plane. */
  gap?: number;
  tint?: number;
}

const towerLayer = (ctx: BuildCtx, o: TowerLayer): void => {
  const r = rng(o.seed);
  const tex = facade(o.seed, o.lit, o.wall, 14, 36, o.litRatio);
  const mat = ctx.track(
    new MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissive,
      emissive: 0xffffff,
      emissiveIntensity: o.emissive,
      color: o.tint ?? 0xffffff,
      roughness: 0.85,
      metalness: 0.15,
      envMapIntensity: 0.4,
    }),
  );
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, repeat = true): void => {
    const g = new BoxGeometry(w, h, d);
    if (repeat) {
      const uv = g.getAttribute("uv");
      const rx = Math.max(1, Math.round(w / 260));
      const ry = Math.max(1, Math.round(h / 650));
      for (let k = 0; k < uv.count; k += 1) uv.setXY(k, uv.getX(k) * rx, uv.getY(k) * ry);
    }
    g.translate(x, y, z);
    parts.push(g);
  };
  for (let i = 0; i < o.count; i += 1) {
    const w = o.width[0] + r() * (o.width[1] - o.width[0]);
    const roof = o.top[0] + r() * (o.top[1] - o.top[0]);
    const h = roof + 2200;
    const d = 180 + r() * 220;
    let x = o.x[0] + r() * (o.x[1] - o.x[0]);
    if (o.gap && Math.abs(x) < o.gap) x = Math.sign(x || 1) * (o.gap + r() * 400);
    const z = o.z[0] + r() * (o.z[1] - o.z[0]);
    box(w, h, d, x, roof - h / 2, z);
    if (r() < 0.6) {
      const tier = 0.55 + r() * 0.2;
      box(w * tier, 70 + r() * 90, d * tier, x + (r() - 0.5) * w * 0.2, roof + 35 + r() * 40, z, false);
    }
    if (r() < 0.55) {
      const ah = 90 + r() * 220;
      box(5, ah, 5, x + (r() - 0.5) * w * 0.5, roof + ah / 2 + 40, z, false);
    }
    if (r() < 0.3) {
      box(w * 0.34, 46, d * 0.34, x - w * 0.2, roof + 23, z + d * 0.18, false);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return;
  ctx.track(merged);
  const mesh = new Mesh(merged, mat);
  mesh.frustumCulled = false;
  ctx.group.add(mesh);
};

const billboard = (ctx: BuildCtx, x: number, y: number, z: number, w: number, h: number, a: string, b: string, seed: number): void => {
  const tex = screenTexture(seed, a, b);
  const frameMat = ctx.track(new MeshStandardMaterial({ color: 0x24202f, roughness: 0.5, metalness: 0.7 }));
  const frame = new Mesh(ctx.track(new BoxGeometry(w + 24, h + 24, 16)), frameMat);
  const screen = new Mesh(ctx.track(new BoxGeometry(w, h, 6)), ctx.track(new MeshBasicMaterial({ map: tex })));
  screen.position.z = 10;
  const glow = glowCard(new Color(a).getHex(), w * 2.1, h * 2.1, 0.32, false);
  glow.position.z = 18;
  const g = new Group();
  g.add(frame, screen, glow);
  for (const s of [-1, 1]) {
    const leg = new Mesh(ctx.track(new BoxGeometry(12, 520, 12)), frameMat);
    leg.position.set(s * w * 0.32, -h / 2 - 260, -4);
    g.add(leg);
  }
  g.position.set(x, y, z);
  ctx.group.add(g);
  ctx.animators.push((_w, time) => {
    tex.offset.x = time * 0.0016;
    tex.offset.y = Math.sin(time * 0.01) * 0.02;
  });
};

export const buildSkyline = (def: StageDef): Stage3D => {
  const ctx = newCtx(def);
  const { group, track, detail } = ctx;
  const r = rng(29);

  /* --------------------------------------------------------------- sky+city */
  const warmLit = [0xffd48a, 0xffa860, 0xff9fc4, 0x8ff0ff];
  cloudField(ctx, { count: 18, x: [-7000, 7000], y: [900, 2600], z: [-7500, -5200], size: [1800, 3600], tint: 0xffc9a8, opacity: 0.55, speed: 0.2, seed: 5 });
  towerLayer(ctx, { seed: 101, count: 26, z: [-5600, -4600], x: [-7000, 7000], top: [-200, 900], width: [260, 520], wall: 0xb08aa8, lit: warmLit, litRatio: 0.3, emissive: 0.9, tint: 0xffe2d0 });
  towerLayer(ctx, { seed: 102, count: 26, z: [-3800, -2800], x: [-5200, 5200], top: [-100, 1000], width: [240, 440], wall: 0x7a5f8c, lit: warmLit, litRatio: 0.34, emissive: 0.95, tint: 0xf0d2d8 });
  towerLayer(ctx, { seed: 103, count: 22, z: [-2400, -1600], x: [-3600, 3600], top: [-250, 640], width: [200, 340], wall: 0x4f4272, lit: warmLit, litRatio: 0.3, emissive: 0.85, gap: 420, tint: 0xe6d0e0 });
  towerLayer(ctx, { seed: 104, count: 14, z: [-1250, -900], x: [-2800, 2800], top: [-300, 380], width: [160, 280], wall: 0x362f55, lit: warmLit, litRatio: 0.22, emissive: 0.7, gap: 760, tint: 0xdccfe0 });

  /* --------------------------------------------------------------- monorail */
  const railMat = track(new MeshStandardMaterial({ color: 0x3d3856, roughness: 0.5, metalness: 0.7 }));
  const rail = new Mesh(track(new BoxGeometry(9000, 26, 60)), railMat);
  rail.position.set(0, 820, -900);
  group.add(rail);
  const train = new Group();
  const carMat = track(new MeshStandardMaterial({ color: 0xe8e2f2, roughness: 0.35, metalness: 0.5, envMapIntensity: 1.2 }));
  const winMat = track(new MeshBasicMaterial({ color: 0xffe2a0 }));
  const carGeo = track(roundedBox(170, 46, 52, 14));
  const stripGeo = track(new BoxGeometry(150, 14, 3));
  for (let i = 0; i < 6; i += 1) {
    const car = new Mesh(carGeo, carMat);
    car.position.x = i * 178;
    car.castShadow = false;
    train.add(car);
    const strip = new Mesh(stripGeo, winMat);
    strip.position.set(i * 178, 6, 27);
    train.add(strip);
  }
  const headlight = glowCard(0xfff2c0, 120, 120, 0.9, false);
  headlight.position.set(-100, 0, 30);
  train.add(headlight);
  train.position.set(0, 850, -900);
  group.add(train);
  ctx.animators.push((_w, time) => {
    train.position.x = ((time * 6.2 + 4200) % 9600) - 5000;
  });

  /* ---------------------------------------------------- billboards/blimp/air */
  billboard(ctx, -1180, 360, -980, 520, 260, "#ff7aa8", "#ffc46b", 3);
  billboard(ctx, 1260, 520, -1320, 460, 240, "#52e6ff", "#a07bff", 5);
  const blimp = new Group();
  const hullMat = track(new MeshStandardMaterial({ color: 0xf4e6df, roughness: 0.5, metalness: 0.15 }));
  const hull = new Mesh(track(new SphereGeometry(1, 28, 18)), hullMat);
  hull.scale.set(300, 96, 96);
  blimp.add(hull);
  const stripe = new Mesh(track(new TorusGeometry(1, 0.035, 8, 40)), track(new MeshBasicMaterial({ color: 0xff6f91 })));
  stripe.scale.set(96, 96, 300);
  stripe.rotation.y = Math.PI / 2;
  blimp.add(stripe);
  const gondola = new Mesh(track(new BoxGeometry(80, 24, 34)), railMat);
  gondola.position.y = -104;
  blimp.add(gondola);
  const finGeo = track(new BoxGeometry(60, 70, 6));
  for (const [fx, fy, rz] of [[-290, 52, 0.3], [-290, -52, -0.3]] as const) {
    const fin = new Mesh(finGeo, hullMat);
    fin.position.set(fx, fy, 0);
    fin.rotation.z = rz;
    blimp.add(fin);
  }
  const blimpScreen = new Mesh(track(new BoxGeometry(170, 50, 4)), track(new MeshBasicMaterial({ map: screenTexture(8, "#ff4d8d", "#ffd36b") })));
  blimpScreen.position.set(10, 0, 96);
  blimp.add(blimpScreen);
  blimp.position.set(-400, 1050, -2700);
  group.add(blimp);
  ctx.animators.push((_w, time) => {
    blimp.position.x = ((time * 0.9 + 4000) % 9000) - 4500;
    blimp.position.y = 1050 + Math.sin(time * 0.01) * 18;
  });

  const cars: { m: Group; v: number; x: number; y: number; z: number }[] = [];
  const carBody = track(new BoxGeometry(34, 8, 12));
  const lightCols = [0xff8fb0, 0x8ff0ff, 0xffd48a, 0xffffff];
  for (let i = 0; i < 18; i += 1) {
    const g = new Group();
    const col = lightCols[i % 4];
    g.add(new Mesh(carBody, track(new MeshBasicMaterial({ color: col, fog: true }))));
    const trail = glowCard(col, 120, 24, 0.6, true);
    trail.position.x = -60;
    g.add(trail);
    const z = -260 - r() * 2600;
    const lane = { m: g, v: (r() < 0.5 ? -1 : 1) * (1.4 + r() * 1.6), x: -3500 + r() * 7000, y: 180 + r() * 980, z };
    g.scale.setScalar(1 + (-z / 1400));
    g.rotation.y = lane.v < 0 ? Math.PI : 0;
    detail.add(g);
    cars.push(lane);
  }
  ctx.animators.push((_w, time) => {
    for (const c of cars) {
      const x = ((((c.x + time * c.v * 2.6 + 4000) % 8000) + 8000) % 8000) - 4000;
      c.m.position.set(x, c.y + Math.sin(time * 0.02 + c.x) * 6, c.z);
    }
  });
  const beams: Mesh[] = [];
  const beamGeo = track(new ConeGeometry(130, 2600, 20, 1, true));
  beamGeo.translate(0, 1300, 0);
  for (const [bx, ph] of [[-2000, 0], [1900, 2]] as const) {
    const m = new Mesh(
      beamGeo,
      track(new MeshBasicMaterial({ color: 0xffe8c0, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false })),
    );
    m.position.set(bx, -300, -1800);
    m.userData.ph = ph;
    detail.add(m);
    beams.push(m);
  }
  ctx.animators.push((_w, time) => {
    for (const b of beams) b.rotation.z = Math.sin(time * 0.006 + (b.userData.ph as number)) * 0.45;
  });
  for (let i = 0; i < 4; i += 1) lightShaft(ctx, { x: -1700 + i * 1100, y: 500, z: -1300 - i * 120, width: 380, height: 2400, color: 0xffc58a, opacity: 0.07, tilt: -0.5, sway: 0.03 });

  /* ------------------------------------------------------------ platforms */
  const visuals: { group: Group; baseX: number; baseY: number }[] = [];
  const concreteMat = track(pbr(concrete(0x9a95a8, 0x2c2a3a, 3), { roughness: 0.82, bump: 1.8, env: 0.5 }));
  const wallMat = track(pbr(concrete(0x6e6a85, 0x23202f, 2), { roughness: 0.9, bump: 1.4, env: 0.4 }));
  const steel = track(pbr(metalPlate(0x7b7f99, 0x1a1a26, 3), { roughness: 0.38, metalness: 0.75, bump: 1.0, env: 1.2 }));
  const stripeTex = stripeTexture();
  stripeTex.repeat.set(16, 1);
  const hazardMat = track(new MeshBasicMaterial({ map: stripeTex }));
  const neonCyan = track(new MeshBasicMaterial({ color: 0x6ff0ff }));
  const neonPink = track(new MeshBasicMaterial({ color: 0xff7ab8 }));
  const warmBulb = track(new MeshBasicMaterial({ color: 0xffd9a0 }));
  const bodyTex = facade(900, warmLit, 0x3b3358, 16, 40, 0.3);
  const bodyMat = track(
    new MeshStandardMaterial({ map: bodyTex.map, emissiveMap: bodyTex.emissive, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.8, metalness: 0.2, envMapIntensity: 0.5 }),
  );
  def.platforms.forEach((p) => {
    const g = new Group();
    if (p.solid) {
      const W = p.w;
      const DEPTH = 300;
      const cz = -60;
      const deck = new Mesh(track(texBox(W, 24, DEPTH, 200)), concreteMat);
      deck.position.set(W / 2, -12, cz);
      deck.castShadow = true;
      deck.receiveShadow = true;
      g.add(deck);
      const lip = new Mesh(track(new BoxGeometry(W + 12, 10, 14)), hazardMat);
      lip.position.set(W / 2, -4, cz + DEPTH / 2 + 3);
      g.add(lip);
      const fascia = new Mesh(track(texBox(W + 10, 30, DEPTH + 8, 160)), wallMat);
      fascia.position.set(W / 2, -39, cz);
      fascia.castShadow = true;
      g.add(fascia);
      for (const [y, mat] of [[-26, neonCyan], [-56, neonPink]] as const) {
        const strip = new Mesh(track(new BoxGeometry(W + 6, 3.6, 3)), mat);
        strip.position.set(W / 2, y, cz + DEPTH / 2 + 6);
        g.add(strip);
        const gl = glowCard(mat === neonCyan ? 0x6ff0ff : 0xff7ab8, W * 1.1, 60, 0.4, false);
        gl.position.set(W / 2, y, cz + DEPTH / 2 + 10);
        g.add(gl);
      }
      // Building body with lit windows and setback ledges.
      const bodyH = 1700;
      const bg = new BoxGeometry(W * 0.88, bodyH, DEPTH * 0.82);
      const uv = bg.getAttribute("uv");
      for (let k = 0; k < uv.count; k += 1) uv.setXY(k, uv.getX(k) * 2.2, uv.getY(k) * 2.1);
      const body = new Mesh(track(bg), bodyMat);
      body.position.set(W / 2, -62 - bodyH / 2, cz);
      body.castShadow = true;
      g.add(body);
      for (let i = 0; i < 3; i += 1) {
        const ledge = new Mesh(track(new BoxGeometry(W * 0.96, 14, DEPTH * 0.9)), wallMat);
        ledge.position.set(W / 2, -330 - i * 380, cz);
        ledge.castShadow = true;
        g.add(ledge);
        const ls = new Mesh(track(new BoxGeometry(W * 0.94, 3, 3)), i % 2 ? neonPink : neonCyan);
        ls.position.set(W / 2, -338 - i * 380, cz + DEPTH * 0.45 + 2);
        g.add(ls);
      }
      for (const s of [-1, 1]) {
        const sign = new Mesh(track(new BoxGeometry(10, 760, 10)), track(new MeshBasicMaterial({ color: s < 0 ? 0xff7ab8 : 0x6ff0ff })));
        sign.position.set(W / 2 + s * (W * 0.44 + 6), -520, cz + DEPTH * 0.41);
        g.add(sign);
        const gl = glowCard(s < 0 ? 0xff7ab8 : 0x6ff0ff, 180, 900, 0.35, false);
        gl.position.set(sign.position.x, -520, cz + DEPTH * 0.41 + 8);
        g.add(gl);
      }
      // Parapet, helipad, rooftop furniture.
      const parapet = new Mesh(track(texBox(W - 24, 52, 16, 160)), wallMat);
      parapet.position.set(W / 2, 26, cz - 142);
      parapet.castShadow = true;
      g.add(parapet);
      const padRing = new Mesh(track(new TorusGeometry(120, 2.6, 4, 64)), track(new MeshBasicMaterial({ color: 0xf2c230 })));
      padRing.rotation.x = Math.PI / 2;
      padRing.position.set(W / 2, 0.8, cz - 4);
      g.add(padRing);
      for (const [bw, bd] of [[110, 10], [10, 110]] as const) {
        const h = new Mesh(track(new BoxGeometry(bw, 1.4, bd)), track(new MeshBasicMaterial({ color: 0xf2c230 })));
        h.position.set(W / 2, 0.8, cz - 4);
        g.add(h);
      }
      const acMat = steel;
      for (const [fx, fz] of [[0.16, -168], [0.84, -176]] as const) {
        const ac = new Mesh(track(roundedBox(96, 54, 60, 6)), acMat);
        ac.position.set(W * fx, 27, cz + fz + 60);
        ac.castShadow = true;
        g.add(ac);
        const fan = new Mesh(track(new CylinderGeometry(20, 20, 4, 18)), track(new MeshStandardMaterial({ color: 0x14131c, roughness: 0.6, metalness: 0.4 })));
        fan.position.set(W * fx, 55, cz + fz + 60);
        g.add(fan);
      }
      // Water tower.
      const tower = new Group();
      const legGeo = track(new CylinderGeometry(3, 3, 120, 6));
      for (const [lx, lz] of [[-22, -16], [22, -16], [-22, 16], [22, 16]] as const) {
        const leg = new Mesh(legGeo, railMat);
        leg.position.set(lx, 60, lz);
        tower.add(leg);
      }
      const tank = new Mesh(track(new CylinderGeometry(34, 34, 80, 18)), track(pbr(metalPlate(0x8a5a40, 0x2a1810, 3), { roughness: 0.6, metalness: 0.5 })));
      tank.position.y = 160;
      tank.castShadow = true;
      tower.add(tank);
      const roof = new Mesh(track(new ConeGeometry(38, 36, 18)), railMat);
      roof.position.y = 218;
      tower.add(roof);
      tower.position.set(W * 0.07, 0, cz - 156);
      g.add(tower);
      // Antenna mast + blinking beacon.
      const mast = new Mesh(track(new CylinderGeometry(2.4, 4, 260, 6)), railMat);
      mast.position.set(W * 0.93, 130, cz - 150);
      g.add(mast);
      const beacon = new Mesh(track(new SphereGeometry(5, 10, 8)), track(new MeshBasicMaterial({ color: 0xff3b3b })));
      beacon.position.set(W * 0.93, 262, cz - 150);
      g.add(beacon);
      const beaconGlow = glowCard(0xff3b3b, 70, 70, 0.9, false);
      beaconGlow.position.copy(beacon.position);
      g.add(beaconGlow);
      ctx.animators.push((_w, time) => {
        const on = Math.sin(time * 0.09) > 0.2;
        beacon.visible = on;
        beaconGlow.visible = on;
      });
      // Stair hut with a lit door.
      const hut = new Mesh(track(texBox(110, 84, 80, 120)), wallMat);
      hut.position.set(W * 0.72, 42, cz - 158);
      hut.castShadow = true;
      g.add(hut);
      const door = new Mesh(track(new BoxGeometry(26, 48, 3)), track(new MeshBasicMaterial({ color: 0xffd9a0 })));
      door.position.set(W * 0.72, 26, cz - 117);
      g.add(door);
      // String lights from the hut to the tower.
      const bulbGeo = track(new SphereGeometry(3.2, 8, 6));
      const x0 = W * 0.07 + 20;
      const x1 = W * 0.72 - 55;
      for (let i = 0; i <= 18; i += 1) {
        const t = i / 18;
        const sag = Math.sin(t * Math.PI) * 26;
        const b = new Mesh(bulbGeo, warmBulb);
        b.position.set(x0 + (x1 - x0) * t, 150 - sag - t * 40, cz - 128);
        g.add(b);
        if (i % 3 === 0) {
          const gl = glowCard(0xffc27a, 54, 54, 0.55, false);
          gl.position.copy(b.position);
          gl.position.z += 4;
          g.add(gl);
        }
      }
      // Steam vents.
      for (const fx of [0.3, 0.57]) {
        const vent = new Mesh(track(new CylinderGeometry(9, 12, 22, 10)), steel);
        vent.position.set(W * fx, 11, cz - 128);
        g.add(vent);
        const puffs: Mesh[] = [];
        for (let i = 0; i < 5; i += 1) {
          const puff = new Mesh(track(new PlaneGeometry(1, 1)), track(new MeshBasicMaterial({ map: softGlow(), transparent: true, depthWrite: false, opacity: 0.25, color: 0xfff1e4 })));
          puff.userData.ph = i / 5;
          detail.add(puff);
          puffs.push(puff);
        }
        ctx.animators.push((_w, time) => {
          for (const pf of puffs) {
            const t = (((time * 0.012 + (pf.userData.ph as number)) % 1) + 1) % 1;
            pf.position.set(p.x + W * fx + Math.sin(t * 7) * 6, 22 + t * 150, cz - 120);
            pf.scale.setScalar(26 + t * 90);
            (pf.material as MeshBasicMaterial).opacity = 0.3 * (1 - t);
          }
        });
      }
    } else {
      const slab = new Mesh(track(texBox(p.w, 12, 118, 120)), steel);
      slab.position.set(p.w / 2, -6, 0);
      slab.castShadow = true;
      slab.receiveShadow = true;
      g.add(slab);
      const core = new Mesh(track(texBox(p.w * 0.92, 10, 96, 120)), wallMat);
      core.position.set(p.w / 2, -17, 0);
      g.add(core);
      for (const z of [-58, 58]) {
        const e = new Mesh(track(new BoxGeometry(p.w - 10, 3.4, 3)), neonCyan);
        e.position.set(p.w / 2, -4, z);
        g.add(e);
      }
      const holo = glowCard(0x6ff0ff, p.w * 1.05, 96, 0.5, false);
      holo.position.set(p.w / 2, -p.h - 44, 6);
      g.add(holo);
      for (const fx of [0.2, 0.8]) {
        const thr = new Mesh(track(new ConeGeometry(11, 16, 10)), steel);
        thr.position.set(p.w * fx, -28, 0);
        thr.rotation.x = Math.PI;
        g.add(thr);
        const flame = glowCard(0x8ff0ff, 64, 64, 0.8, false);
        flame.position.set(p.w * fx, -42, 8);
        g.add(flame);
      }
    }
    group.add(g);
    visuals.push({ group: g, baseX: p.x, baseY: p.y });
  });
  followPlatforms(ctx, visuals);

  buildHazards(ctx, { beam: 0xff6aa8, geyser: 0xff7a2d });

  return assembleStage(ctx, {
    sky: {
      top: "#3b3f95",
      mid: "#c4608f",
      horizon: "#ffb98a",
      bottom: "#8e4a7a",
      sunDir: new Vector3(-0.5, 0.05, -1),
      sunColor: "#ffe2b0",
      sunSize: 70,
      stars: 0.5,
      clouds: { color: "#ffd2b8", shade: "#9c5a86", amount: 0.55, speed: 0.01, height: 0.3 },
      horizonGlow: { color: "#ff9a62", strength: 0.9, width: 0.07 },
    },
    fog: { color: 0xe3987f, near: 3600, far: 15000 },
    background: 0xc9788a,
    key: { color: 0xffbe84, intensity: 2.4, dir: [-780, 420, 620] },
    hemi: { sky: 0xa28ce0, ground: 0x6a3f58, intensity: 1.0 },
    rim: { color: 0xff7ab8, intensity: 1.3, pos: [800, 380, -700] },
    look: {
      exposure: 1.12,
      bloom: { strength: 0.34, radius: 0.55, threshold: 0.86 },
      grade: { saturation: 0.9, contrast: 1.08, tint: [1.04, 1.0, 0.96], lift: [0.03, 0.012, 0.045], vignette: 0.3 },
      envIntensity: 0.7,
    },
    envCards: [
      { color: 0xffc896, x: -800, y: 120, z: -700, w: 600, h: 400, intensity: 5 },
      { color: 0xff7ab8, x: 700, y: 300, z: -500, w: 500, h: 120, intensity: 3 },
    ],
  });
};

