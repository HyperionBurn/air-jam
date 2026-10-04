import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StageDef, World } from "../sim/types";
import { cone, mesh, stdMat } from "./geo";

export interface CameraFocus {
  x: number;
  y: number;
  visibleW: number;
  visibleH: number;
}

export interface Stage3D {
  group: Group;
  fog: Fog;
  background: Color;
  update(world: World, time: number, focus: CameraFocus): void;
  setShadows(on: boolean): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ helpers */

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const skyMaterial = (top: string, mid: string, bottom: string, opts: { stars?: number; sunDir?: Vector3; sunColor?: string; sunSize?: number } = {}): ShaderMaterial =>
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color(top) },
      mid: { value: new Color(mid) },
      bottom: { value: new Color(bottom) },
      stars: { value: opts.stars ?? 0 },
      sunDir: { value: (opts.sunDir ?? new Vector3(0.4, 0.15, -1)).clone().normalize() },
      sunColor: { value: new Color(opts.sunColor ?? "#ffffff") },
      sunSize: { value: opts.sunSize ?? 0 },
      time: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform float stars; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; uniform float time;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(mid, top, pow(clamp(h*1.4,0.0,1.0), 0.7)) : mix(mid, bottom, clamp(-h*2.5,0.0,1.0));
        if (stars > 0.0 && h > -0.05) {
          vec3 g = floor(vDir*180.0);
          float s = step(0.9965, hash(g));
          float tw = 0.6 + 0.4*sin(time*2.0 + hash(g)*40.0);
          col += vec3(s*tw*stars);
        }
        if (sunSize > 0.0) {
          float d = max(dot(normalize(vDir), sunDir), 0.0);
          col += sunColor * (pow(d, 1600.0/sunSize)*1.2 + pow(d, 40.0)*0.22 + pow(d, 8.0)*0.05);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

const glowTexture = (() => {
  let tex: CanvasTexture | null = null;
  return (): CanvasTexture => {
    if (tex) return tex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.3, "rgba(255,255,255,0.4)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  };
})();

const glowCard = (color: number, w: number, h: number, opacity = 0.8): Mesh => {
  const m = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false }),
  );
  m.renderOrder = 2;
  return m;
};

const windowTexture = (seed: number, palette: string[]): CanvasTexture => {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#0b0a1a";
    g.fillRect(0, 0, 128, 256);
    const cols = 8;
    const rows = 16;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const lit = r() < 0.17;
        g.fillStyle = lit ? palette[Math.floor(r() * palette.length)] : "#0c0a1e";
        g.globalAlpha = lit ? 0.45 + r() * 0.35 : 1;
        g.fillRect(x * 16 + 4, y * 16 + 5, 8, 6);
      }
    }
    g.globalAlpha = 1;
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
};

/** Platform slab shared by all stages. Origin at the top-front-centre so it can be placed from the 2D def. */
const slabGeometry = (w: number, h: number, depth: number, bevel: number): BufferGeometry => {
  const shape = new Shape();
  const r = Math.min(bevel * 2, h * 0.4);
  shape.moveTo(-w / 2 + r, h / 2);
  shape.lineTo(w / 2 - r, h / 2);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2, h / 2 - r);
  shape.lineTo(w / 2, -h / 2 + r);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2 - r, -h / 2);
  shape.lineTo(-w / 2 + r, -h / 2);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2, -h / 2 + r);
  shape.lineTo(-w / 2, h / 2 - r);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2 + r, h / 2);
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
};


/** Procedural panel/rock texture used as colour + bump so decks read as material, not flat colour. */
const surfaceTexture = (seed: number, base: string, seam: string, kind: "panels" | "rock" | "grate"): CanvasTexture => {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    // Mottling.
    for (let i = 0; i < 900; i += 1) {
      g.globalAlpha = 0.04 + r() * 0.08;
      g.fillStyle = r() < 0.5 ? "#000" : "#fff";
      const s = 2 + r() * 14;
      g.fillRect(r() * 256, r() * 256, s, s * (0.4 + r()));
    }
    g.globalAlpha = 1;
    g.strokeStyle = seam;
    g.lineWidth = 2;
    if (kind === "panels") {
      for (let i = 0; i <= 256; i += 64) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 256);
        g.moveTo(0, i);
        g.lineTo(256, i);
        g.stroke();
      }
      g.globalAlpha = 0.5;
      for (let i = 0; i < 16; i += 1) g.fillRect(((i % 4) * 64) + 6, Math.floor(i / 4) * 64 + 6, 4, 4);
    } else if (kind === "grate") {
      for (let i = 0; i < 256; i += 16) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 256);
        g.stroke();
      }
      g.globalAlpha = 0.6;
      for (let i = 0; i < 256; i += 64) g.fillRect(0, i, 256, 5);
    } else {
      for (let i = 0; i < 22; i += 1) {
        g.beginPath();
        g.moveTo(r() * 256, r() * 256);
        for (let k = 0; k < 4; k += 1) g.lineTo(r() * 256, r() * 256);
        g.globalAlpha = 0.25;
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** Smooth tapering hull / rock mass hanging under a solid platform. */
const hullGeometry = (w: number, depth: number, height: number, seed: number, radial = 36): BufferGeometry => {
  const r = rng(seed);
  const rows = 10;
  const geo = new CylinderGeometry(1, 0.0, 1, radial, rows, true);
  const pos = geo.getAttribute("position");
  const phase = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = 0.5 - y; // 0 top .. 1 bottom
    const taper = Math.pow(1 - t, 0.7);
    const n = 1 + (Math.sin(x * 5 + phase[0] + t * 3) * 0.1 + Math.cos(z * 6 + phase[1]) * 0.08 + Math.sin((x + z) * 9 + phase[2]) * 0.05) * (0.4 + t);
    pos.setXYZ(i, x * taper * n * (w / 2), -t * height, z * taper * n * (depth / 2));
  }
  geo.computeVertexNormals();
  return geo;
};

interface PlatformVisual {
  group: Group;
  baseX: number;
  baseY: number;
}

interface HazardVisual {
  group: Group;
  beam: Mesh;
  beamMat: MeshBasicMaterial;
  warn: Mesh;
  warnMat: MeshBasicMaterial;
  glow: PointLight;
  kind: "beam" | "geyser";
}

const makeKeyLight = (color: number, intensity: number): DirectionalLight => {
  const light = new DirectionalLight(color, intensity);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 1.2;
  light.shadow.camera.near = 10;
  light.shadow.camera.far = 3000;
  return light;
};

/* ------------------------------------------------------------------ stages */

interface StageKit {
  hullKind: "rock" | "building" | "hex";
  /** Platform top/underside look. */
  deck: MeshStandardMaterial;
  deckSide: MeshStandardMaterial;
  trimColor: number;
  softDeck: MeshStandardMaterial;
  underGlow: number;
}

export const buildStage = (def: StageDef): Stage3D => {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const animators: ((world: World, time: number, focus: CameraFocus) => void)[] = [];

  let key: DirectionalLight;
  let fog: Fog;
  let background: Color;
  let kit: StageKit;
  let sky: ShaderMaterial;

  switch (def.theme.decor) {
    case "skyline": {
      background = new Color("#12062a");
      fog = new Fog(0x2a0c48, 900, 6200);
      sky = track(skyMaterial("#06021a", "#7a1d8c", "#1a0836", { stars: 0.9, sunDir: new Vector3(-0.2, 0.08, -1), sunColor: "#ff7ad9", sunSize: 90 }));
      kit = {
        deck: track(stdMat(0x2a2142, { roughness: 0.55, metalness: 0.35, rim: 0xff9cf2, rimStrength: 0.3 })),
        deckSide: track(stdMat(0x1a1330, { roughness: 0.7, metalness: 0.3, rimStrength: 0.1 })),
        trimColor: 0xff7ad9,
        softDeck: track(stdMat(0x2b2650, { roughness: 0.4, metalness: 0.6 })),
        underGlow: 0x37f2d0,
        hullKind: "building",
      };
      key = makeKeyLight(0xffb5ec, 1.5);
      group.add(new HemisphereLight(0x8a5cff, 0x1a0836, 0.5));
      break;
    }
    case "foundry": {
      background = new Color("#1a0805");
      fog = new Fog(0x4a160a, 1400, 6500);
      sky = track(skyMaterial("#0b0302", "#4a1608", "#7a2a10", { stars: 0 }));
      kit = {
        deck: track(stdMat(0x4a3a34, { roughness: 0.75, metalness: 0.5, rim: 0xffb870, rimStrength: 0.25 })),
        deckSide: track(stdMat(0x1c1312, { roughness: 0.9, metalness: 0.3, rimStrength: 0.08, envMapIntensity: 0.4 })),
        trimColor: 0xff8a3a,
        softDeck: track(stdMat(0x4a3a36, { roughness: 0.55, metalness: 0.7 })),
        underGlow: 0xff6a22,
        hullKind: "hex",
      };
      key = makeKeyLight(0xffc090, 1.6);
      group.add(new HemisphereLight(0xb8b0c0, 0x2a0c06, 0.55));
      break;
    }
    default: {
      background = new Color("#0a1230");
      fog = new Fog(0x3a2456, 2200, 9000);
      sky = track(skyMaterial("#05081c", "#53306e", "#140f34", { stars: 0.8, sunDir: new Vector3(0.55, 0.12, -1), sunColor: "#ffb48a", sunSize: 140 }));
      kit = {
        deck: track(stdMat(0x3c4670, { roughness: 0.66, metalness: 0.25, rim: 0xcfe6ff, rimStrength: 0.35 })),
        deckSide: track(stdMat(0x262c4c, { roughness: 0.85, metalness: 0.2, rimStrength: 0.12 })),
        trimColor: 0x5ad7ff,
        softDeck: track(stdMat(0x4c5e96, { roughness: 0.4, metalness: 0.5 })),
        underGlow: 0x5ad7ff,
        hullKind: "rock",
      };
      key = makeKeyLight(0xffd0a0, 1.7);
      group.add(new HemisphereLight(0x7a8cff, 0x2a1a44, 0.5));
      break;
    }
  }

  {
    const kind = def.theme.decor === "foundry" ? "grate" : def.theme.decor === "skyline" ? "panels" : "panels";
    const tex = track(surfaceTexture(7, def.theme.decor === "foundry" ? "#6a5a52" : def.theme.decor === "skyline" ? "#5b4f86" : "#8b96bd", def.theme.decor === "foundry" ? "#1a0f0c" : "#1a1838", kind));
    tex.repeat.set(1 / 200, 1 / 200);
    kit.deck.map = tex;
    kit.deck.bumpMap = tex;
    kit.deck.bumpScale = 1.6;
    kit.deck.needsUpdate = true;
    const side = track(surfaceTexture(13, def.theme.decor === "foundry" ? "#4a3a36" : "#4a5278", "#0a0818", "rock"));
    side.repeat.set(1 / 260, 1 / 260);
    kit.deckSide.map = side;
    kit.deckSide.bumpMap = side;
    kit.deckSide.bumpScale = 2;
    kit.deckSide.needsUpdate = true;
  }

  // Sky dome follows the camera in x so it never shows an edge.
  const skyMesh = new Mesh(new SphereGeometry(9000, 32, 20), sky);
  skyMesh.renderOrder = -10;
  skyMesh.frustumCulled = false;
  group.add(skyMesh);
  track(skyMesh.geometry);
  animators.push((_w, time, focus) => {
    skyMesh.position.set(focus.x, 0, 0);
    sky.uniforms.time.value = time * 0.016;
  });

  // Rim light from behind-left: separates fighters from the backdrop.
  const rim = new DirectionalLight(def.theme.accent === "#ff5c33" ? 0xff7a40 : 0x9fd8ff, 1.5);
  rim.position.set(-500, 400, -800);
  group.add(rim);

  key.position.set(500, 900, 700);
  group.add(key, key.target);

  /* ---- platforms ---- */
  const platformVisuals: PlatformVisual[] = [];
  def.platforms.forEach((p) => {
    const g = new Group();
    const depth = p.solid ? 300 : 120;
    // Visual slab is thinner than the collision box: a lit lip over a tapering hull.
    const topH = p.solid ? Math.min(p.h, 52) : p.h;
    const slab = new Mesh(slabGeometry(p.w, topH, depth, p.solid ? 6 : 3), p.solid ? kit.deck : kit.softDeck);
    track(slab.geometry);
    slab.castShadow = true;
    slab.receiveShadow = true;
    slab.position.set(p.w / 2, -topH / 2, p.solid ? -60 : 0);
    g.add(slab);

    // Emissive edge strip along the front-top lip (the readable "floor line").
    const strip = new Mesh(new BoxGeometry(p.w - 24, 3.2, 3), track(new MeshBasicMaterial({ color: kit.trimColor })));
    track(strip.geometry);
    strip.position.set(p.w / 2, -2.2, (p.solid ? -60 : 0) + depth / 2 + 3);
    g.add(strip);
    const stripGlow = glowCard(kit.trimColor, p.w + 80, 56, 0.35);
    stripGlow.position.set(p.w / 2, -4, (p.solid ? -60 : 0) + depth / 2 + 6);
    g.add(stripGlow);

    if (p.solid) {
      // Underside mass: a smooth tapering hull so the stage reads as an object, not stacked blocks.
      if (kit.hullKind === "building") {
        const bodyH = 1400;
        const bg = new BoxGeometry(p.w * 0.8, bodyH, depth * 0.8);
        const uv = bg.getAttribute("uv");
        for (let k = 0; k < uv.count; k += 1) uv.setXY(k, uv.getX(k) * 7, uv.getY(k) * 24);
        const tex = track(windowTexture(404, ["#ffd36e", "#ff7ad9", "#6ee7ff"]));
        const bm = track(new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.45, color: 0x1d1738, roughness: 0.85, metalness: 0.2 }));
        const body = new Mesh(track(bg), bm);
        body.position.set(p.w / 2, -topH - bodyH / 2 + 8, -60);
        body.castShadow = true;
        g.add(body);
        const cornice = mesh(track(new BoxGeometry(p.w * 0.9, 16, depth * 0.9)), kit.deckSide);
        cornice.position.set(p.w / 2, -topH - 8, -60);
        g.add(cornice);
      } else {
        const hull = new Mesh(track(hullGeometry(p.w * 0.94, depth * 0.9, def.theme.decor === "foundry" ? 520 : 640, 21, kit.hullKind === "hex" ? 8 : 40)), kit.deckSide);
        hull.position.set(p.w / 2, -topH + 6, -60);
        hull.castShadow = true;
        hull.receiveShadow = true;
        g.add(hull);
        if (kit.hullKind === "rock") {
          // Glowing crystal veins on the underside.
          const crystalMat = track(stdMat(0x9ef0ff, { roughness: 0.15, metalness: 0.1, emissive: 0x4ac8ff, emissiveIntensity: 1.2, rim: 0xffffff, rimStrength: 0.5 }));
          const rr = rng(77);
          for (let i = 0; i < 9; i += 1) {
            const c = mesh(cone(10 + rr() * 12, 60 + rr() * 90, 6), crystalMat, false);
            track(c.geometry);
            c.position.set(p.w * (0.15 + rr() * 0.7), -topH - 60 - rr() * 260, -60 + (rr() - 0.5) * depth * 0.5);
            c.rotation.set(Math.PI + (rr() - 0.5) * 0.5, 0, (rr() - 0.5) * 0.6);
            g.add(c);
          }
        }
      }
      // Ledge lamps at both corners.
      for (const x of [0, p.w]) {
        const lamp = mesh(new SphereGeometry(7, 12, 8), track(new MeshBasicMaterial({ color: kit.trimColor })), false);
        track(lamp.geometry);
        lamp.position.set(x, 4, depth / 2 - 60);
        g.add(lamp);
        const lg = glowCard(kit.trimColor, 90, 90, 0.7);
        lg.position.copy(lamp.position);
        lg.position.z += 4;
        g.add(lg);
      }
    } else {
      // Under-glow and support fins for floating platforms.
      const under = glowCard(kit.underGlow, p.w * 1.1, 80, 0.55);
      under.position.set(p.w / 2, -p.h - 36, 8);
      g.add(under);
      for (const fx of [0.18, 0.82]) {
        const fin = mesh(new BoxGeometry(8, 22, 60), kit.deckSide);
        track(fin.geometry);
        fin.position.set(p.w * fx, -p.h - 11, 0);
        g.add(fin);
      }
    }
    group.add(g);
    platformVisuals.push({ group: g, baseX: p.x, baseY: p.y });
  });
  animators.push((world) => {
    platformVisuals.forEach((pv, i) => {
      const rp = world.platforms[i];
      if (rp) pv.group.position.set(rp.x, -rp.y, 0);
      else pv.group.position.set(pv.baseX, -pv.baseY, 0);
    });
  });

  /* ---- scenery ---- */
  if (def.theme.decor === "skyline") buildSkyline(group, def, track, animators);
  else if (def.theme.decor === "foundry") buildFoundry(group, def, track, animators);
  else buildProving(group, def, track, animators);

  /* ---- hazards ---- */
  const hazardVisuals: HazardVisual[] = def.hazards.map((h) => {
    const hg = new Group();
    const color = h.kind === "beam" ? 0xff5ad8 : 0xff7a2d;
    const beamMat = track(new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    const height = h.bottom - h.top;
    const beamGeo = track(new CylinderGeometry(h.w * 0.5, h.w * 0.5, height, 24, 1, true));
    const beam = new Mesh(beamGeo, beamMat);
    beam.position.y = -(h.top + h.bottom) / 2;
    beam.visible = false;
    const core = new Mesh(track(new CylinderGeometry(h.w * 0.22, h.w * 0.22, height, 16, 1, true)), track(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })));
    beam.add(core);
    const warnMat = track(new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    const warn = new Mesh(track(new TorusGeometry(h.w * 0.55, 3, 6, 40)), warnMat);
    warn.rotation.x = Math.PI / 2;
    warn.visible = false;
    const glow = new PointLight(color, 0, 600, 1.6);
    hg.add(beam, warn, glow);
    // A drone / vent housing to explain where the hazard comes from.
    if (h.kind === "beam") {
      const drone = new Group();
      const body = mesh(new SphereGeometry(26, 20, 14), track(stdMat(0x2b2650, { roughness: 0.3, metalness: 0.8 })));
      track(body.geometry);
      body.scale.set(1.5, 0.7, 1);
      drone.add(body);
      const eye = mesh(new SphereGeometry(9, 12, 8), track(new MeshBasicMaterial({ color })), false);
      track(eye.geometry);
      eye.position.set(0, -10, 18);
      drone.add(eye);
      drone.position.y = -h.top - 20;
      hg.add(drone);
    }
    hg.visible = false;
    group.add(hg);
    return { group: hg, beam, beamMat, warn, warnMat, glow, kind: h.kind };
  });
  animators.push((world, time) => {
    def.hazards.forEach((h, i) => {
      const hv = hazardVisuals[i];
      const hs = world.hazardState[i];
      if (!hv || !hs) return;
      if (hs.phase === "idle") {
        hv.group.visible = false;
        hv.glow.intensity = 0;
        return;
      }
      hv.group.visible = true;
      const x = h.xs[hs.lane % h.xs.length];
      const groundY = h.kind === "beam" ? 0 : -h.bottom * 0.2;
      hv.group.position.set(x, 0, 0);
      if (hs.phase === "warn") {
        hv.beam.visible = false;
        hv.warn.visible = true;
        hv.warn.position.y = h.kind === "beam" ? 4 : -groundY;
        hv.warnMat.opacity = 0.45 + 0.45 * Math.abs(Math.sin(time * 0.35));
        hv.warn.scale.setScalar(1 + 0.15 * Math.sin(time * 0.5));
        hv.glow.intensity = 6e4 * (0.4 + 0.3 * Math.sin(time * 0.5));
        hv.glow.position.set(0, 20, 60);
      } else {
        hv.beam.visible = true;
        hv.warn.visible = false;
        hv.beamMat.opacity = 0.6 + 0.2 * Math.sin(time * 1.4);
        hv.beam.scale.x = hv.beam.scale.z = 1 + 0.06 * Math.sin(time * 2.2);
        hv.glow.intensity = 3e5;
        hv.glow.position.set(0, 120, 80);
      }
    });
  });

  // Key light + shadow follow the action.
  animators.push((_w, _t, focus) => {
    const reach = Math.max(focus.visibleW, focus.visibleH * 1.6) * 0.62 + 200;
    key.target.position.set(focus.x, focus.y, 0);
    key.position.set(focus.x + 450, focus.y + 900, 700);
    const cam = key.shadow.camera;
    cam.left = -reach;
    cam.right = reach;
    cam.top = reach * 0.8;
    cam.bottom = -reach * 0.8;
    cam.updateProjectionMatrix();
  });

  return {
    group,
    fog,
    background,
    update(world, time, focus) {
      for (const a of animators) a(world, time, focus);
    },
    setShadows(on) {
      key.castShadow = on;
    },
    dispose() {
      group.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (m.isMesh) {
          const mat = m.material as Material | Material[];
          void mat;
        }
      });
      for (const d of disposables) d.dispose();
    },
  };
};

type Track = <T extends { dispose(): void }>(x: T) => T;
type Animators = ((world: World, time: number, focus: CameraFocus) => void)[];

/* ----------------------------------------------------------- Proving Ground */

function buildProving(group: Group, def: StageDef, track: Track, animators: Animators): void {
  const r = rng(11);
  // Floating islands in layers, each with a glowing crystal cluster.
  const rockMat = track(stdMat(0x5a6390, { roughness: 0.9, metalness: 0.05, rim: 0xffb0c8, rimStrength: 0.35 }));
  const crystalMat = track(stdMat(0x9ef0ff, { roughness: 0.15, metalness: 0.1, emissive: 0x4ac8ff, emissiveIntensity: 1.2, rim: 0xffffff, rimStrength: 0.6 }));
  const grassMat = track(stdMat(0x5aa088, { roughness: 0.9, metalness: 0 }));
  const islands: Group[] = [];
  for (let i = 0; i < 12; i += 1) {
    const g = new Group();
    const size = 90 + r() * 260;
    const topGeo = track(new CylinderGeometry(size, size * 0.86, size * 0.16, 14));
    const top = mesh(topGeo, grassMat, false);
    g.add(top);
    const underGeo = track(new IcosahedronGeometry(size * 0.9, 1));
    const under = mesh(underGeo, rockMat, false);
    under.scale.set(1, 1.4, 0.9);
    under.position.y = -size * 0.95;
    g.add(under);
    const count = 2 + Math.floor(r() * 4);
    for (let k = 0; k < count; k += 1) {
      const c = mesh(cone(size * (0.05 + r() * 0.05), size * (0.3 + r() * 0.5), 6), crystalMat, false);
      c.position.set((r() - 0.5) * size * 1.2, size * 0.06, (r() - 0.5) * size * 0.6);
      c.rotation.z = (r() - 0.5) * 0.7;
      g.add(c);
    }
    const side = i % 2 === 0 ? -1 : 1;
    g.position.set(side * (500 + r() * 1700) + (r() - 0.5) * 300, 260 + r() * 900 - 200, -900 - r() * 2600);
    g.userData.bob = r() * 6.28;
    g.userData.base = g.position.y;
    group.add(g);
    islands.push(g);
  }
  // Big thin ring and a pale moon.
  const ring = mesh(track(new TorusGeometry(1500, 12, 8, 120)), track(new MeshBasicMaterial({ color: 0x8fe8ff, fog: false })), false);
  ring.position.set(900, 900, -4200);
  ring.rotation.set(1.1, 0.3, 0.4);
  group.add(ring);
  const ringGlow = glowCard(0x6ad8ff, 3600, 3600, 0.16);
  ringGlow.position.set(900, 900, -4200);
  group.add(ringGlow);
  const moon = mesh(track(new SphereGeometry(520, 32, 20)), track(new MeshBasicMaterial({ color: 0xffe6f0, fog: false })), false);
  moon.position.set(-1500, 1300, -5200);
  group.add(moon);
  const moonGlow = glowCard(0xffc0d8, 2600, 2600, 0.35);
  moonGlow.position.copy(moon.position);
  moonGlow.position.z += 10;
  group.add(moonGlow);
  // Hanging banners / pylons on the main deck for scale.
  const main = def.platforms[0];
  for (const side of [-1, 1]) {
    const pylon = new Group();
    const shaft = mesh(track(new CylinderGeometry(10, 14, 200, 8)), track(stdMat(0x384070, { roughness: 0.6, metalness: 0.4 })));
    shaft.position.y = 100;
    pylon.add(shaft);
    const orb = mesh(track(new SphereGeometry(20, 16, 12)), track(new MeshBasicMaterial({ color: 0x8cf0ff })), false);
    orb.position.y = 220;
    pylon.add(orb);
    const g2 = glowCard(0x8cf0ff, 260, 260, 0.7);
    g2.position.set(0, 220, 8);
    pylon.add(g2);
    pylon.position.set(side * (main.w / 2 - 30), 0, -150);
    group.add(pylon);
  }
  animators.push((_w, time) => {
    for (const g of islands) g.position.y = (g.userData.base as number) + Math.sin(time * 0.012 + (g.userData.bob as number)) * 14;
    ring.rotation.z += 0.0004;
  });
}

/* ------------------------------------------------------------ Skyline Rush */

function buildSkyline(group: Group, def: StageDef, track: Track, animators: Animators): void {
  const r = rng(29);
  const palettes = [["#ffd36e", "#ff7ad9", "#6ee7ff"], ["#ff7ad9", "#b778ff", "#ffffff"], ["#6ee7ff", "#37f2d0", "#ffd36e"]];
  // Building cluster merged into a few draw calls (one per window palette).
  for (let pi = 0; pi < palettes.length; pi += 1) {
    const tex = track(windowTexture(100 + pi, palettes[pi]));
    const mat = track(new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5, color: 0x1d1738, roughness: 0.85, metalness: 0.2 }));
    const geos: BufferGeometry[] = [];
    for (let i = 0; i < 26; i += 1) {
      const w = 160 + r() * 260;
      const h = 500 + r() * 1700;
      const d = 160 + r() * 200;
      const g = new BoxGeometry(w, h, d);
      const uv = g.getAttribute("uv");
      const repX = Math.max(1, Math.round(w / 120));
      const repY = Math.max(1, Math.round(h / 140));
      for (let k = 0; k < uv.count; k += 1) uv.setXY(k, uv.getX(k) * repX, uv.getY(k) * repY);
      const layer = i % 3;
      const z = -760 - layer * 640 - r() * 400;
      let x = (r() - 0.5) * 5200;
      // Keep a calm, dark gap directly behind the fighting plane for readability.
      if (layer === 0 && Math.abs(x) < 520) x += Math.sign(x || 1) * 700;
      g.translate(x, h / 2 - 700 + (r() - 0.5) * 80, z);
      geos.push(g);
    }
    const merged = track(mergeGeometries(geos, false));
    const city = new Mesh(merged, mat);
    city.frustumCulled = false;
    group.add(city);
    for (const g of geos) g.dispose();
  }
  // Neon signs.
  const signColors = [0xff5ad8, 0x37f2d0, 0xffd36e, 0xb778ff];
  for (let i = 0; i < 14; i += 1) {
    const col = signColors[i % signColors.length];
    const w = 120 + r() * 220;
    const sign = mesh(track(new BoxGeometry(w, 26, 6)), track(new MeshBasicMaterial({ color: col })), false);
    const x = (r() - 0.5) * 3200;
    const y = 80 + r() * 900;
    sign.position.set(x, y, -300 - r() * 900);
    group.add(sign);
    const gl = glowCard(col, w * 2.4, 240, 0.7);
    gl.position.copy(sign.position);
    gl.position.z += 8;
    group.add(gl);
  }
  // Rooftop details on the main deck: AC units and a back billboard.
  const main = def.platforms[0];
  const metal = track(stdMat(0x403a66, { roughness: 0.5, metalness: 0.6 }));
  for (const x of [-0.42, 0.38]) {
    const ac = mesh(track(new BoxGeometry(90, 46, 70)), metal);
    ac.position.set(main.x + main.w / 2 + x * main.w, 23, -150);
    group.add(ac);
  }
  const board = new Group();
  const frame = mesh(track(new BoxGeometry(520, 150, 12)), metal);
  board.add(frame);
  const face = mesh(track(new BoxGeometry(490, 120, 4)), track(new MeshBasicMaterial({ color: 0x1a1030 })), false);
  face.position.z = 8;
  board.add(face);
  const txt = mesh(track(new BoxGeometry(400, 14, 3)), track(new MeshBasicMaterial({ color: 0xff5ad8 })), false);
  txt.position.set(0, 18, 11);
  board.add(txt);
  const txt2 = mesh(track(new BoxGeometry(300, 10, 3)), track(new MeshBasicMaterial({ color: 0x37f2d0 })), false);
  txt2.position.set(0, -14, 11);
  board.add(txt2);
  const bg = glowCard(0xff5ad8, 900, 360, 0.45);
  bg.position.z = 14;
  board.add(bg);
  board.position.set(0, 300, -230);
  group.add(board);
  const legs = mesh(track(new BoxGeometry(14, 230, 14)), metal);
  legs.position.set(-170, 115, -230);
  group.add(legs);
  const legs2 = legs.clone();
  legs2.position.x = 170;
  group.add(legs2);
  // Light haze bands.
  const haze: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const m = new Mesh(
      new PlaneGeometry(7000, 600),
      track(new MeshBasicMaterial({ color: i === 0 ? 0xff5ad8 : 0x8a4cff, transparent: true, opacity: 0.1, depthWrite: false, blending: AdditiveBlending, fog: false })),
    );
    m.position.set(0, -300 + i * 220, -900 - i * 600);
    group.add(m);
    haze.push(m);
  }
  animators.push((_w, time, focus) => {
    haze.forEach((m, i) => {
      m.position.x = focus.x * 0.9 + Math.sin(time * 0.004 + i) * 120;
    });
  });
}

/* --------------------------------------------------------------- Foundry */

function buildFoundry(group: Group, def: StageDef, track: Track, animators: Animators): void {
  const r = rng(53);
  // Lava sea.
  const lavaMat = track(
    new ShaderMaterial({
      uniforms: { time: { value: 0 } },
      fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float time; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
        void main(){
          vec2 p = vW.xz*0.0016 + vec2(time*0.012, -time*0.006);
          float a = fbm(p*3.0 + fbm(p*2.0 + time*0.02));
          float cracks = smoothstep(0.42, 0.62, a);
          vec3 dark = vec3(0.16,0.03,0.015);
          vec3 hot = mix(vec3(1.0,0.35,0.06), vec3(1.0,0.85,0.3), smoothstep(0.55,0.9,a));
          vec3 col = mix(hot, dark, cracks);
          col *= 0.9 + 0.35*sin(time*0.6 + a*9.0);
          gl_FragColor = vec4(col*1.25, 1.0);
        }`,
    }),
  );
  const lava = new Mesh(track(new PlaneGeometry(12000, 6000, 1, 1)), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(0, -760, -1500);
  lava.frustumCulled = false;
  group.add(lava);
  const lavaGlow = glowCard(0xff7a2d, 6000, 900, 0.5);
  lavaGlow.position.set(0, -700, -300);
  group.add(lavaGlow);
  const lavaLight = new PointLight(0xff6a22, 1.6e5, 2600, 1.4);
  lavaLight.position.set(0, -520, 200);
  group.add(lavaLight);

  // Cavern walls: lumpy rock built from displaced icosahedra.
  const rockMat = track(stdMat(0x2a1a16, { roughness: 0.95, metalness: 0.05, rim: 0xff7a40, rimStrength: 0.3 }));
  for (let i = 0; i < 34; i += 1) {
    const geo = track(new IcosahedronGeometry(1, 2));
    const pos = geo.getAttribute("position");
    for (let k = 0; k < pos.count; k += 1) {
      const v = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k));
      const noise = 1 + (Math.sin(v.x * 3.1 + i) + Math.cos(v.y * 2.7 + i * 1.3) + Math.sin(v.z * 3.7 + i * 0.7)) * 0.12;
      v.multiplyScalar(noise);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const s = 260 + r() * 520;
    const m = mesh(geo, rockMat, false);
    m.scale.set(s, s * (0.9 + r() * 1.4), s * 0.8);
    const side = i % 2 === 0 ? -1 : 1;
    m.position.set(side * (1100 + r() * 1500) + (r() - 0.5) * 300, (r() - 0.5) * 1800 + 200, -700 - r() * 1400);
    m.receiveShadow = false;
    group.add(m);
  }
  // Back wall + pillars of falling lava.
  const wall = mesh(track(new PlaneGeometry(9000, 3600)), track(stdMat(0x1c0f0c, { roughness: 1, metalness: 0 })), false);
  wall.position.set(0, 500, -2400);
  group.add(wall);
  const falls: Mesh[] = [];
  for (let i = 0; i < 5; i += 1) {
    const w = 36 + r() * 60;
    const f = new Mesh(
      track(new PlaneGeometry(w, 2600)),
      track(new MeshBasicMaterial({ color: 0xff7a1d, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, fog: false })),
    );
    f.position.set(-1700 + i * 850 + (r() - 0.5) * 200, 500, -1800 - r() * 600);
    group.add(f);
    falls.push(f);
    const g = glowCard(0xff7a2d, w * 5, 2600, 0.14);
    g.position.copy(f.position);
    g.position.z += 4;
    group.add(g);
  }
  // Industrial gantry: pipes and beams.
  const metal = track(stdMat(0x433632, { roughness: 0.6, metalness: 0.75, rim: 0xffb070, rimStrength: 0.4 }));
  for (let i = 0; i < 9; i += 1) {
    const len = 900 + r() * 1400;
    const pipe = mesh(track(new CylinderGeometry(18 + r() * 24, 18 + r() * 24, len, 12)), metal, false);
    pipe.position.set(-2200 + i * 520 + r() * 120, 200 + r() * 700, -900 - r() * 700);
    pipe.rotation.z = r() < 0.4 ? Math.PI / 2 : 0;
    group.add(pipe);
  }
  // Furnace glow rectangles on the back wall.
  for (let i = 0; i < 5; i += 1) {
    const vent = new Mesh(track(new PlaneGeometry(120, 60)), track(new MeshBasicMaterial({ color: 0xff8a3a, fog: false })));
    vent.position.set(-900 + i * 450, 650 + r() * 300, -2380);
    group.add(vent);
    const g = glowCard(0xff8a3a, 520, 340, 0.4);
    g.position.copy(vent.position);
    g.position.z += 6;
    group.add(g);
  }
  const main = def.platforms[0];
  for (const x of [-0.36, 0.36]) {
    const stack = mesh(track(new CylinderGeometry(26, 34, 210, 10)), metal);
    stack.position.set(main.x + main.w / 2 + x * main.w, 105, -170);
    group.add(stack);
    const flame = glowCard(0xffa24d, 120, 140, 0.9);
    flame.position.set(stack.position.x, 220, -160);
    group.add(flame);
  }
  animators.push((_w, time, focus) => {
    lavaMat.uniforms.time.value = time;
    lava.position.x = focus.x;
    falls.forEach((f, i) => {
      (f.material as MeshBasicMaterial).opacity = 0.4 + 0.12 * Math.sin(time * 0.05 + i * 1.7);
    });
    lavaLight.intensity = 1.6e5 * (0.9 + 0.1 * Math.sin(time * 0.2));
    lavaLight.position.x = focus.x;
  });
}
