import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  NormalBlending,
  type Object3D,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StageDef, World } from "../sim/types";
import { cloudSprite, fbm, shaftSprite, softGlow, type PBRTex } from "./proc-tex";

export interface CameraFocus {
  x: number;
  y: number;
  visibleW: number;
  visibleH: number;
}

/** Per-stage rendering character: exposure, bloom and the colour grade applied in post. */
export interface StageLook {
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  grade: { saturation: number; contrast: number; tint: [number, number, number]; lift: [number, number, number]; vignette: number };
  envIntensity: number;
}

export interface Stage3D {
  group: Group;
  fog: Fog;
  background: Color;
  look: StageLook;
  /** Mini-scene (sky + a few emissive cards) baked into the reflection environment. */
  envScene: Scene;
  update(world: World, time: number, focus: CameraFocus): void;
  setShadows(on: boolean): void;
  setDetail(level: number): void;
  dispose(): void;
}

export type Track = <T extends { dispose(): void }>(x: T) => T;
export type Animator = (world: World, time: number, focus: CameraFocus) => void;

export interface BuildCtx {
  def: StageDef;
  group: Group;
  track: Track;
  animators: Animator[];
  scatter: Scatter;
  /** Objects that can be hidden at lower quality levels (fine detail). */
  detail: Group;
}

/* ---------------------------------------------------------------- random */

export const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/* ---------------------------------------------------------------- scatter */

const tmpQ = new Quaternion();
const tmpP = new Vector3();
const tmpS = new Vector3();
const tmpE = new Euler();

export const compose = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 => {
  tmpQ.setFromEuler(tmpE.set(rx, ry, rz, "XYZ"));
  tmpP.set(x, y, z);
  tmpS.set(sx, sy, sz);
  return new Matrix4().compose(tmpP, tmpQ, tmpS);
};

interface ScatterSet {
  geo: BufferGeometry;
  mat: Material;
  matrices: Matrix4[];
  colors: Color[];
  cast: boolean;
}

/** Collects instances per geometry+material and emits one InstancedMesh each. */
export class Scatter {
  private readonly sets = new Map<string, ScatterSet>();
  add(key: string, geo: BufferGeometry, mat: Material, matrix: Matrix4, color?: Color | number, cast = false): void {
    let s = this.sets.get(key);
    if (!s) {
      s = { geo, mat, matrices: [], colors: [], cast };
      this.sets.set(key, s);
    }
    s.matrices.push(matrix);
    s.colors.push(color instanceof Color ? color : new Color(color ?? 0xffffff));
  }
  flush(parent: Group): InstancedMesh[] {
    const out: InstancedMesh[] = [];
    for (const s of this.sets.values()) {
      const im = new InstancedMesh(s.geo, s.mat, s.matrices.length);
      s.matrices.forEach((m, i) => {
        im.setMatrixAt(i, m);
        im.setColorAt(i, s.colors[i]);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = s.cast;
      im.frustumCulled = false;
      parent.add(im);
      out.push(im);
    }
    this.sets.clear();
    return out;
  }
}

/* ----------------------------------------------------------- small helpers */

export const tintGeo = (geo: BufferGeometry, bottom: number, top: number, minY?: number, maxY?: number): BufferGeometry => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const lo = minY ?? bb.min.y;
  const hi = maxY ?? bb.max.y;
  const pos = g.getAttribute("position");
  const a = new Color(bottom);
  const b = new Color(top);
  const c = new Color();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - lo) / Math.max(1e-5, hi - lo)));
    c.lerpColors(a, b, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
};

export const mergeTinted = (parts: BufferGeometry[]): BufferGeometry => {
  const flat = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "color" && name !== "uv") g.deleteAttribute(name);
    return g;
  });
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error("merge failed");
  return merged;
};

/** Low-poly round tree: trunk + three displaced foliage lobes, vertex-coloured. */
export const roundTreeGeo = (trunk = 0x6b4a32, leafLo = 0x2f6b3a, leafHi = 0x7fcf5a, seed = 1): BufferGeometry => {
  const r = rng(seed);
  const parts: BufferGeometry[] = [];
  const t = new CylinderGeometry(7, 11, 70, 7, 1);
  t.translate(0, 35, 0);
  parts.push(tintGeo(t, 0x3a281c, trunk));
  const lobes: [number, number, number, number][] = [
    [0, 88, 0, 46],
    [-26, 70, 8, 32],
    [28, 74, -6, 34],
  ];
  for (const [x, y, z, rad] of lobes) {
    const g = new IcosahedronGeometry(rad, 1);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      const k = 1 + (r() - 0.5) * 0.28;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.9, pos.getZ(i) * k);
    }
    g.translate(x, y, z);
    g.computeVertexNormals();
    parts.push(tintGeo(g, leafLo, leafHi, y - rad, y + rad));
  }
  return mergeTinted(parts);
};

/** Stacked-cone pine. */
export const pineGeo = (trunk = 0x5a3d2a, lo = 0x1f5a45, hi = 0x4ba06a): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const t = new CylinderGeometry(5, 8, 40, 6);
  t.translate(0, 20, 0);
  parts.push(tintGeo(t, 0x30211a, trunk));
  for (let i = 0; i < 4; i += 1) {
    const c = new CylinderGeometry(0, 40 - i * 7, 62 - i * 6, 8, 1);
    c.translate(0, 46 + i * 34, 0);
    parts.push(tintGeo(c, lo, hi, 20 + i * 34, 80 + i * 34));
  }
  return mergeTinted(parts);
};

/** Faceted crystal cluster (hex prisms with pointed tips). */
export const crystalGeo = (count = 5, seed = 4): BufferGeometry => {
  const r = rng(seed);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const h = 40 + r() * 70;
    const w = 7 + r() * 8;
    const body = new CylinderGeometry(w * 0.85, w, h, 6, 1);
    body.translate(0, h / 2, 0);
    const tip = new CylinderGeometry(0, w * 0.85, h * 0.4, 6, 1);
    tip.translate(0, h + h * 0.2, 0);
    const g = mergeTinted([tintGeo(body, 0x2f6dd8, 0x8be8ff), tintGeo(tip, 0x8be8ff, 0xffffff)]);
    const ang = (i / count) * Math.PI * 2 + r();
    const lean = (r() - 0.5) * 0.7;
    const m = new Matrix4().compose(
      new Vector3(Math.cos(ang) * 10 * (i > 0 ? 1 : 0), 0, Math.sin(ang) * 6 * (i > 0 ? 1 : 0)),
      new Quaternion().setFromAxisAngle(new Vector3(Math.cos(ang), 0, Math.sin(ang)).normalize().cross(new Vector3(0, 1, 0)).normalize(), lean),
      new Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    parts.push(g);
  }
  return mergeTinted(parts);
};

export const glowCard = (color: number, w: number, h: number, opacity = 0.8, fog = false): Mesh => {
  const m = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: softGlow(), color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog }),
  );
  m.renderOrder = 2;
  return m;
};

/* -------------------------------------------------------------------- sky */

export interface SkyOptions {
  top: string;
  mid: string;
  horizon: string;
  bottom: string;
  sunDir?: Vector3;
  sunColor?: string;
  sunSize?: number;
  stars?: number;
  clouds?: { color: string; shade: string; amount: number; speed: number; height: number };
  horizonGlow?: { color: string; strength: number; width: number };
}

export const skyMaterial = (o: SkyOptions): ShaderMaterial =>
  new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color(o.top) },
      mid: { value: new Color(o.mid) },
      horizon: { value: new Color(o.horizon) },
      bottom: { value: new Color(o.bottom) },
      stars: { value: o.stars ?? 0 },
      sunDir: { value: (o.sunDir ?? new Vector3(0.4, 0.2, -1)).clone().normalize() },
      sunColor: { value: new Color(o.sunColor ?? "#ffffff") },
      sunSize: { value: o.sunSize ?? 0 },
      cloudColor: { value: new Color(o.clouds?.color ?? "#ffffff") },
      cloudShade: { value: new Color(o.clouds?.shade ?? "#aab4d0") },
      cloudAmount: { value: o.clouds?.amount ?? 0 },
      cloudHeight: { value: o.clouds?.height ?? 0.35 },
      glowColor: { value: new Color(o.horizonGlow?.color ?? "#000000") },
      glowStrength: { value: o.horizonGlow?.strength ?? 0 },
      glowWidth: { value: o.horizonGlow?.width ?? 0.2 },
      cloudSpeed: { value: o.clouds?.speed ?? 0.01 },
      time: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 bottom; uniform float stars;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize;
      uniform vec3 cloudColor; uniform vec3 cloudShade; uniform float cloudAmount; uniform float cloudHeight; uniform float cloudSpeed;
      uniform vec3 glowColor; uniform float glowStrength; uniform float glowWidth; uniform float time;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.02+vec2(3.1,1.7); a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        // The game camera only sees roughly +-0.25 of elevation, so the gradient is compressed into that band.
        float hh = h * 3.4;
        vec3 col;
        if (hh > 0.0) {
          vec3 lowMid = mix(horizon, mid, smoothstep(0.0, 0.34, hh));
          col = mix(lowMid, top, smoothstep(0.22, 0.95, hh));
        } else {
          col = mix(horizon, bottom, smoothstep(0.0, 0.5, -hh));
        }
        float g = exp(-pow(abs(h) / max(glowWidth, 0.001), 1.4));
        float sd = max(dot(d, sunDir), 0.0);
        col += glowColor * glowStrength * g * (0.35 + 0.65 * pow(sd, 3.0));
        if (stars > 0.0 && h > 0.02) {
          vec2 sp = d.xz / (d.y + 0.25) * 90.0;
          vec2 id = floor(sp);
          float s = step(0.992, hash(id));
          float tw = 0.5 + 0.5 * sin(time * 30.0 + hash(id + 7.0) * 40.0);
          col += vec3(s * tw * stars) * smoothstep(0.02, 0.3, h);
        }
        if (cloudAmount > 0.0 && h > 0.01) {
          vec2 cp = d.xz / (h + cloudHeight) * 1.6 + vec2(time * cloudSpeed, 0.0);
          float c = fbm(cp * 1.4);
          float cov = smoothstep(1.0 - cloudAmount, 1.0 - cloudAmount + 0.28, c + 0.12);
          float lit = clamp(fbm(cp * 1.4 + sunDir.xz * 0.15) - c + 0.55, 0.0, 1.0);
          vec3 cc = mix(cloudShade, cloudColor, lit);
          col = mix(col, cc, cov * smoothstep(0.0, 0.12, h) * 0.92);
        }
        if (sunSize > 0.0) {
          col += sunColor * (pow(sd, 1800.0 / sunSize) * 1.6 + pow(sd, 60.0) * 0.28 + pow(sd, 10.0) * 0.10);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

/* ----------------------------------------------------------- cloud fields */

export interface CloudFieldOptions {
  count: number;
  /** x range, y range, z range (world). */
  x: [number, number];
  y: [number, number];
  z: [number, number];
  size: [number, number];
  tint?: number;
  opacity?: number;
  speed?: number;
  seed?: number;
  fog?: boolean;
}

/** Instanced cumulus billboards that drift and wrap; one draw call. */
export const cloudField = (ctx: BuildCtx, o: CloudFieldOptions): InstancedMesh => {
  const r = rng(o.seed ?? 5);
  const mat = ctx.track(
    new MeshBasicMaterial({ map: cloudSprite(), transparent: true, depthWrite: false, color: o.tint ?? 0xffffff, opacity: o.opacity ?? 1, fog: o.fog ?? true }),
  );
  const geo = ctx.track(new PlaneGeometry(1, 0.5));
  const im = new InstancedMesh(geo, mat, o.count);
  const items: { x: number; y: number; z: number; s: number; v: number; flip: number }[] = [];
  for (let i = 0; i < o.count; i += 1) {
    items.push({
      x: o.x[0] + r() * (o.x[1] - o.x[0]),
      y: o.y[0] + r() * (o.y[1] - o.y[0]),
      z: o.z[0] + r() * (o.z[1] - o.z[0]),
      s: o.size[0] + r() * (o.size[1] - o.size[0]),
      v: 0.6 + r() * 0.8,
      flip: r() < 0.5 ? -1 : 1,
    });
  }
  im.frustumCulled = false;
  im.renderOrder = -5;
  const m = new Matrix4();
  const span = o.x[1] - o.x[0];
  const place = (time: number): void => {
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      let x = it.x + time * (o.speed ?? 0.6) * it.v;
      x = o.x[0] + ((((x - o.x[0]) % span) + span) % span);
      m.compose(tmpP.set(x, it.y, it.z), tmpQ.identity(), tmpS.set(it.s * it.flip, it.s, 1));
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  place(0);
  ctx.animators.push((_w, time) => place(time));
  ctx.group.add(im);
  return im;
};

/* ----------------------------------------------------------------- ridges */

export interface RidgeOptions {
  width: number;
  z: number;
  baseY: number;
  height: number;
  top: number;
  bottom: number;
  roughness?: number;
  seed?: number;
  fog?: boolean;
  segments?: number;
  jag?: number;
}

/** Silhouette mountain/skyline strip with a baked top-to-bottom haze gradient. */
export const ridge = (ctx: BuildCtx, o: RidgeOptions): Mesh => {
  const seg = o.segments ?? 90;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const top = new Color(o.top);
  const bot = new Color(o.bottom);
  const c = new Color();
  for (let i = 0; i <= seg; i += 1) {
    const t = i / seg;
    const x = (t - 0.5) * o.width;
    const n = fbm(t * 0.98 + 0.01, 0.3, 6, 4, o.seed ?? 3);
    const peak = Math.pow(n, 1.4) * (1 + (o.jag ?? 0) * Math.sin(t * 90 + (o.seed ?? 0)));
    const y = o.baseY + peak * o.height * (o.roughness ?? 1);
    pos.push(x, y, o.z, x, o.baseY - o.height * 1.4, o.z);
    c.copy(top);
    col.push(c.r, c.g, c.b);
    c.copy(bot);
    col.push(c.r, c.g, c.b);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = ctx.track(new BufferGeometry());
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = ctx.track(new MeshBasicMaterial({ vertexColors: true, fog: o.fog ?? true, side: DoubleSide }));
  const m = new Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -8;
  ctx.group.add(m);
  return m;
};

/* -------------------------------------------------------------- waterfall */

let waterTexCache: CanvasTexture | null = null;
const waterfallTexture = (): CanvasTexture => {
  if (waterTexCache) return waterTexCache;
  const W = 64;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const n = fbm(x / W, y / H, 4, 4, 91);
      const streak = fbm((x / W) * 3, y / H, 3, 3, 93);
      const side = Math.pow(1 - Math.abs((x / (W - 1)) * 2 - 1), 0.55);
      const a = Math.min(1, Math.max(0, (0.3 + n * 0.95) * (0.5 + streak * 0.7))) * side;
      const i = (y * W + x) * 4;
      img.data[i] = 232;
      img.data[i + 1] = 246;
      img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  waterTexCache = tex;
  return tex;
};

export interface WaterfallOptions {
  x: number;
  /** World y of the top edge and the bottom of the fall. */
  top: number;
  bottom: number;
  z: number;
  width: number;
  tint?: number;
  opacity?: number;
  fog?: boolean;
  speed?: number;
  /** Parent group (defaults to the stage root). */
  parent?: Group;
  additive?: boolean;
}

/** Scrolling falling-water ribbon with a mist puff at its base. */
export const waterfall = (ctx: BuildCtx, o: WaterfallOptions): Group => {
  const g = new Group();
  const height = o.top - o.bottom;
  const tex = waterfallTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(1, Math.max(1, height / 320));
  const mat = ctx.track(
    new MeshBasicMaterial({ map: tex, color: o.tint ?? 0xffffff, transparent: true, opacity: o.opacity ?? 0.9, depthWrite: false, side: DoubleSide, fog: o.fog ?? true, blending: o.additive ? AdditiveBlending : NormalBlending }),
  );
  const plane = new Mesh(ctx.track(new PlaneGeometry(o.width, height)), mat);
  plane.position.set(0, -height / 2, 0);
  g.add(plane);
  const mist = glowCard(0xe8f4ff, o.width * 3.2, o.width * 1.6, 0.55, true);
  mist.position.set(0, -height + o.width * 0.2, 6);
  g.add(mist);
  g.position.set(o.x, o.top, o.z);
  (o.parent ?? ctx.group).add(g);
  const speed = o.speed ?? 0.014;
  ctx.animators.push((_w, time) => {
    tex.offset.y = -time * speed * (1 + 320 / Math.max(160, height));
    mist.scale.x = 1 + Math.sin(time * 0.05 + o.x) * 0.06;
  });
  return g;
};

/* ------------------------------------------------------------ light shafts */

export interface ShaftOptions {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  color: number;
  opacity: number;
  /** Lean in radians (positive = top tilts toward -x). */
  tilt?: number;
  sway?: number;
}

export const lightShaft = (ctx: BuildCtx, o: ShaftOptions): Mesh => {
  const mat = ctx.track(
    new MeshBasicMaterial({ map: shaftSprite(), color: o.color, transparent: true, opacity: o.opacity, blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide }),
  );
  const m = new Mesh(ctx.track(new PlaneGeometry(o.width, o.height)), mat);
  m.position.set(o.x, o.y, o.z);
  m.rotation.z = o.tilt ?? 0;
  m.renderOrder = 3;
  ctx.group.add(m);
  const base = o.opacity;
  ctx.animators.push((_w, time) => {
    mat.opacity = base * (0.82 + 0.18 * Math.sin(time * 0.02 + o.x * 0.01));
    m.rotation.z = (o.tilt ?? 0) + Math.sin(time * 0.006 + o.x) * (o.sway ?? 0.02);
  });
  return m;
};

/* ----------------------------------------------------------------- lights */

export const makeKeyLight = (color: number, intensity: number): DirectionalLight => {
  const light = new DirectionalLight(color, intensity);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 1.2;
  light.shadow.camera.near = 10;
  light.shadow.camera.far = 3200;
  return light;
};

/** PBR material from a procedural texture set. */
export const pbr = (
  tex: PBRTex,
  o: { color?: number; roughness?: number; metalness?: number; repeat?: [number, number]; bump?: number; emissive?: number; emissiveIntensity?: number; env?: number } = {},
): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({
    map: tex.map,
    bumpMap: tex.bump,
    bumpScale: o.bump ?? 1.5,
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 0.8,
    metalness: o.metalness ?? 0.05,
    envMapIntensity: o.env ?? 1,
  });
  if (tex.emissive) {
    m.emissiveMap = tex.emissive;
    m.emissive = new Color(o.emissive ?? 0xffffff);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  return m;
};

/** UV-scaled box so a tiling texture keeps constant texel density (world units per tile). */
export const texBox = (w: number, h: number, d: number, tile = 200): BoxGeometry => {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute("uv");
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  for (let i = 0; i < uv.count; i += 1) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return g;
};

export const sphereGeo = (r: number, seg = 16): SphereGeometry => new SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
export const cylGeo = (rt: number, rb: number, h: number, seg = 12): CylinderGeometry => new CylinderGeometry(rt, rb, h, seg, 1);

/* --------------------------------------------------------- rock hull mass */

export interface HullOptions {
  width: number;
  depth: number;
  height: number;
  seed?: number;
  /** Radial segment count (low values give a faceted, forged look). */
  radial?: number;
  /** Profile exponent: <1 = bulbous, >1 = pointed taper. */
  taper?: number;
  rows?: number;
  roughness?: number;
}

/** Tapering, noise-displaced mass hanging under a platform; UVs wrap for strata textures. */
export const rockHull = (o: HullOptions): BufferGeometry => {
  const radial = o.radial ?? 48;
  const rows = o.rows ?? 16;
  const geo = new CylinderGeometry(1, 1, 1, radial, rows, true);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = 0.5 - y; // 0 at the top, 1 at the bottom
    const ang = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    const taper = Math.pow(1 - t, o.taper ?? 0.75);
    const n = fbm(ang, t * 0.9, 7, 4, o.seed ?? 3);
    const ridge = 1 + (n - 0.5) * 0.55 * (0.35 + t) * (o.roughness ?? 1);
    const strata = 1 + Math.sin(t * 38 + n * 5) * 0.025;
    pos.setXYZ(i, x * taper * ridge * strata * (o.width / 2), -t * o.height, z * taper * ridge * strata * (o.depth / 2));
  }
  geo.computeVertexNormals();
  return geo;
};

/** Rock chunk displaced by a position-based field so shared vertices stay welded (no shattered facets). */
export const lumpGeo = (size: number, seed: number): BufferGeometry => {
  const g = new IcosahedronGeometry(size, 2);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const q = 3.1 / size;
    const n = Math.sin(x * q + seed) * Math.sin(y * q * 1.3 + seed * 2) + Math.sin(z * q * 1.7 + seed * 3) * 0.7 + Math.sin((x + z) * q * 2.9 + seed) * 0.35;
    const k = 1 + n * 0.17;
    pos.setXYZ(i, x * k, y * k * 1.15, z * k);
  }
  g.computeVertexNormals();
  return g;
};

/* --------------------------------------------------------- stage assembly */

export interface StageRig {
  sky: SkyOptions;
  fog: { color: number; near: number; far: number };
  background: number;
  key: { color: number; intensity: number; dir: [number, number, number] };
  hemi: { sky: number; ground: number; intensity: number };
  rim: { color: number; intensity: number; pos: [number, number, number] };
  look: StageLook;
  /** Bright cards baked into the reflection environment (sun disc, neon strips, lava glow). */
  envCards?: { color: number; x: number; y: number; z: number; w: number; h: number; intensity?: number }[];
}

export const assembleStage = (ctx: BuildCtx, rig: StageRig): Stage3D => {
  const { group, animators, track } = ctx;
  const sky = track(skyMaterial(rig.sky));
  const skyMesh = new Mesh(track(new SphereGeometry(9000, 40, 24)), sky);
  skyMesh.renderOrder = -10;
  skyMesh.frustumCulled = false;
  group.add(skyMesh);
  animators.push((_w, time, focus) => {
    skyMesh.position.set(focus.x, 0, 0);
    sky.uniforms.time.value = time * 0.016;
  });

  const key = makeKeyLight(rig.key.color, rig.key.intensity);
  key.position.set(...rig.key.dir);
  group.add(key, key.target);
  const hemi = new HemisphereLight(rig.hemi.sky, rig.hemi.ground, rig.hemi.intensity);
  group.add(hemi);
  const rim = new DirectionalLight(rig.rim.color, rig.rim.intensity);
  rim.position.set(...rig.rim.pos);
  group.add(rim);

  animators.push((_w, _t, focus) => {
    const reach = Math.max(focus.visibleW, focus.visibleH * 1.6) * 0.62 + 200;
    const d = rig.key.dir;
    const len = Math.hypot(d[0], d[1], d[2]);
    key.target.position.set(focus.x, focus.y, 0);
    key.position.set(focus.x + d[0] * (1100 / len), focus.y + d[1] * (1100 / len), d[2] * (1100 / len));
    const cam = key.shadow.camera;
    cam.left = -reach;
    cam.right = reach;
    cam.top = reach * 0.8;
    cam.bottom = -reach * 0.8;
    cam.updateProjectionMatrix();
  });

  // Reflection environment: the sky dome plus emissive cards, prefiltered once by the view.
  const envScene = new Scene();
  const envSky = new Mesh(new SphereGeometry(900, 24, 16), skyMaterial(rig.sky));
  envScene.add(envSky);
  for (const c of rig.envCards ?? []) {
    const card = new Mesh(new PlaneGeometry(c.w, c.h), new MeshBasicMaterial({ color: new Color(c.color).multiplyScalar(c.intensity ?? 3), side: DoubleSide, fog: false }));
    card.position.set(c.x, c.y, c.z);
    card.lookAt(0, 0, 0);
    envScene.add(card);
  }

  const detailLevels: number[] = [];
  void detailLevels;
  return {
    group,
    fog: new Fog(rig.fog.color, rig.fog.near, rig.fog.far),
    background: new Color(rig.background),
    look: rig.look,
    envScene,
    update(world, time, focus) {
      for (const a of animators) a(world, time, focus);
    },
    setShadows(on) {
      key.castShadow = on;
    },
    setDetail(level) {
      ctx.detail.visible = level < 3;
    },
    dispose() {
      const seen = new Set<unknown>();
      const kill = (root: Object3D): void => {
        root.traverse((obj) => {
          const o = obj as Mesh;
          if (!o.isMesh) return;
          if (o.geometry && !seen.has(o.geometry)) {
            seen.add(o.geometry);
            o.geometry.dispose();
          }
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m && !seen.has(m)) {
              seen.add(m);
              m.dispose();
            }
          }
        });
      };
      kill(group);
      kill(envScene);
      for (const d of (ctx as unknown as { disposables?: { dispose(): void }[] }).disposables ?? []) d.dispose();
    },
  };
};

/** Moves each platform visual to its live sim position (platforms may slide). */
export const followPlatforms = (ctx: BuildCtx, visuals: { group: Group; baseX: number; baseY: number }[]): void => {
  ctx.animators.push((world) => {
    visuals.forEach((pv, i) => {
      const rp = world.platforms[i];
      if (rp) pv.group.position.set(rp.x, -rp.y, 0);
      else pv.group.position.set(pv.baseX, -pv.baseY, 0);
    });
  });
};

export const newCtx = (def: StageDef): BuildCtx & { disposables: { dispose(): void }[] } => {
  const disposables: { dispose(): void }[] = [];
  const group = new Group();
  const detail = new Group();
  group.add(detail);
  return {
    def,
    group,
    track: <T extends { dispose(): void }>(x: T): T => {
      disposables.push(x);
      return x;
    },
    animators: [],
    scatter: new Scatter(),
    detail,
    disposables,
  };
};
