import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  type Group,
} from "three";
import type { HitFx } from "../sim/types";
import { hexToNumber, mixHex, SLOT_STYLES, shapePoints, type SlotShape } from "../view/palette";

/* ---------------------------------------------------------------- atlas */

type TexKey = "glow" | "dot" | "ring" | "streak" | "star" | "smoke" | "puff" | "shape";
const TEX_INDEX: Record<Exclude<TexKey, "shape">, number> = { glow: 0, dot: 1, ring: 2, streak: 3, star: 4, smoke: 5, puff: 6 };
const SHAPE_BASE = 8;
const CELLS = 4;
const CELL = 128;

const buildAtlas = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CELLS * CELL;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const at = (index: number, draw: (cx: number, cy: number) => void): void => {
    const col = index % CELLS;
    const row = Math.floor(index / CELLS);
    g.save();
    g.translate(col * CELL, row * CELL);
    g.beginPath();
    g.rect(0, 0, CELL, CELL);
    g.clip();
    draw(CELL / 2, CELL / 2);
    g.restore();
  };
  // glow
  at(0, (cx, cy) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.14)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, CELL, CELL);
  });
  // dot
  at(1, (cx, cy) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 52);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.72, "rgba(255,255,255,0.95)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, CELL, CELL);
  });
  // ring
  at(2, (cx, cy) => {
    g.strokeStyle = "rgba(255,255,255,1)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, 56, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 14;
    g.beginPath();
    g.arc(cx, cy, 52, 0, Math.PI * 2);
    g.stroke();
  });
  // streak: tapers to a hot tip on the right, fills the cell vertically
  at(3, () => {
    const grad = g.createLinearGradient(0, 0, CELL, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.7)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 64);
    g.quadraticCurveTo(80, 30, CELL, 64);
    g.quadraticCurveTo(80, 98, 0, 64);
    g.closePath();
    g.fill();
  });
  // impact star (spiky, hot centre)
  at(4, (cx, cy) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    const spikes = 12;
    for (let i = 0; i < spikes * 2; i += 1) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? (i % 4 === 0 ? 64 : 40) : 15;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  });
  // soft smoke
  at(5, (cx, cy) => {
    const grad = g.createRadialGradient(cx, cy, 4, cx, cy, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.75)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.3)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, CELL, CELL);
  });
  // cartoon puff: a cluster of overlapping lobes with a lit top (the white "dust cloud" look)
  at(6, (cx, cy) => {
    const lobes: [number, number, number][] = [[0, 6, 40], [-30, 12, 28], [30, 12, 28], [-14, -16, 28], [16, -14, 26]];
    for (const [dx, dy, r] of lobes) {
      const grad = g.createRadialGradient(cx + dx - 6, cy + dy - 10, 2, cx + dx, cy + dy, r);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.75, "rgba(236,242,255,0.95)");
      grad.addColorStop(1, "rgba(210,222,250,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
      g.fill();
    }
  });
  // identity shapes
  SLOT_STYLES.forEach((style, i) => {
    at(SHAPE_BASE + i, (cx, cy) => {
      const pts = shapePoints(style.shape);
      g.fillStyle = "#ffffff";
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.lineWidth = 4;
      g.beginPath();
      for (let k = 0; k < pts.length; k += 2) {
        const x = cx + pts[k] * 46;
        const y = cy + pts[k + 1] * 46;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      g.stroke();
    });
  });
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
};

/* ------------------------------------------------------------ particles */

const MAX = 1400;

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  alpha0: number;
  rot: number;
  vrot: number;
  stretch: boolean;
  flat: number;
  fadeIn: number;
  tex: number;
  r: number;
  g: number;
  b: number;
}

class Layer {
  readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX * 2);
  private readonly rot = new Float32Array(MAX);
  private readonly color = new Float32Array(MAX * 4);
  private readonly tex = new Float32Array(MAX);
  private readonly attrs: InstancedBufferAttribute[];
  count = 0;

  constructor(atlas: CanvasTexture, additive: boolean) {
    const base = new PlaneGeometry(1, 1);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.geo.setAttribute("uv", base.getAttribute("uv"));
    const mk = (arr: Float32Array, n: number, name: string): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(arr, n);
      a.setUsage(DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [mk(this.pos, 3, "iPos"), mk(this.size, 2, "iSize"), mk(this.rot, 1, "iRot"), mk(this.color, 4, "iColor"), mk(this.tex, 1, "iTex")];
    this.geo.instanceCount = 0;
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      uniforms: { map: { value: atlas }, cells: { value: CELLS } },
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iSize; attribute float iRot; attribute vec4 iColor; attribute float iTex;
        uniform float cells; varying vec2 vUv; varying vec4 vColor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iRot); float s = sin(iRot);
          vec2 q = position.xy * iSize;
          mv.xy += vec2(q.x*c - q.y*s, q.x*s + q.y*c);
          gl_Position = projectionMatrix * mv;
          float col = mod(iTex, cells); float row = floor(iTex / cells);
          vUv = (vec2(col, cells - 1.0 - row) + uv) / cells;
          vColor = iColor;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
        void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(vColor.rgb * t.rgb, t.a * vColor.a); }`,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 8 : 6;
  }

  begin(): void {
    this.count = 0;
  }

  push(p: Particle, wx: number, wy: number, sx: number, sy: number, rot: number, alpha: number): void {
    const i = this.count++;
    this.pos[i * 3] = wx;
    this.pos[i * 3 + 1] = wy;
    this.pos[i * 3 + 2] = p.z;
    this.size[i * 2] = sx;
    this.size[i * 2 + 1] = sy;
    this.rot[i] = rot;
    this.color[i * 4] = p.r;
    this.color[i * 4 + 1] = p.g;
    this.color[i * 4 + 2] = p.b;
    this.color[i * 4 + 3] = alpha;
    this.tex[i] = p.tex;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    for (const a of this.attrs) a.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

interface SpawnOptions {
  tex: TexKey;
  shape?: SlotShape;
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  gravity?: number;
  drag?: number;
  life: number;
  size0: number;
  size1?: number;
  alpha?: number;
  color: number;
  additive?: boolean;
  rot?: number;
  vrot?: number;
  stretch?: boolean;
  flat?: number;
  fadeIn?: number;
}

const tmpColor = new Color();

/** Pooled billboard particles in two instanced draws (additive + normal). Nothing allocates in play. */
export class Fx3D {
  private readonly additive: Particle[] = [];
  private readonly normal: Particle[] = [];
  private cursorA = 0;
  private cursorN = 0;
  private readonly atlas: CanvasTexture;
  private readonly layerA: Layer;
  private readonly layerN: Layer;
  density = 1;

  constructor(parent: Group) {
    this.atlas = buildAtlas();
    this.layerA = new Layer(this.atlas, true);
    this.layerN = new Layer(this.atlas, false);
    parent.add(this.layerN.mesh, this.layerA.mesh);
    const blank = (): Particle => ({
      active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, gravity: 0, drag: 0, life: 0, maxLife: 1, size0: 1, size1: 1, alpha0: 1,
      rot: 0, vrot: 0, stretch: false, flat: 1, fadeIn: 0, tex: 0, r: 1, g: 1, b: 1,
    });
    for (let i = 0; i < MAX; i += 1) {
      this.additive.push(blank());
      this.normal.push(blank());
    }
  }

  private spawn(o: SpawnOptions): void {
    const additive = o.additive !== false;
    const pool = additive ? this.additive : this.normal;
    const idx = additive ? this.cursorA++ % MAX : this.cursorN++ % MAX;
    const p = pool[idx];
    p.active = true;
    p.x = o.x;
    p.y = o.y;
    p.z = o.z ?? 36;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.life = o.life;
    p.maxLife = o.life;
    p.size0 = o.size0;
    p.size1 = o.size1 ?? o.size0;
    p.alpha0 = o.alpha ?? 1;
    p.rot = o.rot ?? 0;
    p.vrot = o.vrot ?? 0;
    p.stretch = o.stretch ?? false;
    p.flat = o.flat ?? 1;
    p.fadeIn = o.fadeIn ?? 0;
    p.tex = o.tex === "shape" ? SHAPE_BASE + Math.max(0, SLOT_STYLES.findIndex((s) => s.shape === (o.shape ?? "circle"))) : TEX_INDEX[o.tex];
    tmpColor.setHex(o.color);
    p.r = tmpColor.r;
    p.g = tmpColor.g;
    p.b = tmpColor.b;
  }

  update(dt: number): void {
    this.step(this.additive, this.layerA, dt);
    this.step(this.normal, this.layerN, dt);
  }

  private step(pool: Particle[], layer: Layer, dt: number): void {
    layer.begin();
    for (const p of pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      const drag = p.drag > 0 ? Math.pow(1 - p.drag, dt) : 1;
      p.vx *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      const t = 1 - p.life / p.maxLife;
      const size = p.size0 + (p.size1 - p.size0) * t;
      const fade = p.fadeIn > 0 ? Math.min(1, t / p.fadeIn) : 1;
      const alpha = p.alpha0 * (1 - t) * fade;
      if (p.stretch) {
        const speed = Math.hypot(p.vx, p.vy);
        // sim y is down; world y is up.
        layer.push(p, p.x, -p.y, size * (0.6 + speed * 0.1), size * 0.22, Math.atan2(-p.vy, p.vx), alpha);
      } else {
        layer.push(p, p.x, -p.y, size, size * p.flat, p.rot, alpha);
      }
    }
    layer.end();
  }

  clear(): void {
    for (const p of this.additive) p.active = false;
    for (const p of this.normal) p.active = false;
    this.layerA.begin();
    this.layerA.end();
    this.layerN.begin();
    this.layerN.end();
  }

  dispose(): void {
    this.layerA.dispose();
    this.layerN.dispose();
    this.atlas.dispose();
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.density));
  }

  /* ------------------------------------------------------------------ HITS */

  hit(x: number, y: number, power: number, dx: number, dy: number, color: string, fx: HitFx): void {
    const p = Math.min(1.6, Math.max(0.2, power));
    const base = hexToNumber(color);
    const hot = fx === "fire" ? 0xffa23d : fx === "electric" ? 0x9be8ff : fx === "magic" ? 0xe0a8ff : fx === "shock" ? 0xfff2c0 : 0xffd9a0;
    // Hot starburst: the signature impact read.
    this.spawn({ tex: "star", x, y, life: 8 + p * 5, size0: 50 * p, size1: 190 * p + 70, color: 0xffffff, rot: Math.random() * 3, z: 44 });
    this.spawn({ tex: "star", x, y, life: 12 + p * 5, size0: 30 * p, size1: 150 * p + 50, color: hot, rot: Math.random() * 3, alpha: 0.9, z: 42 });
    this.spawn({ tex: "glow", x, y, life: 14, size0: 90, size1: 190 + 140 * p, alpha: 0.9, color: hot });
    this.spawn({ tex: "ring", x, y, life: 12 + p * 4, size0: 30, size1: 150 + 140 * p, alpha: 0.85, color: base });
    const ang = Math.atan2(dy, dx);
    const n = this.count(8 + p * 18);
    for (let i = 0; i < n; i += 1) {
      const a = ang + (Math.random() - 0.5) * 1.5;
      const speed = 8 + Math.random() * 14 * p + 4;
      this.spawn({
        tex: "streak", x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.06, gravity: 0.1,
        life: 12 + Math.random() * 12, size0: 54 + Math.random() * 36, size1: 12, stretch: true, color: Math.random() < 0.5 ? hot : 0xffffff,
      });
    }
    // Impact puff.
    this.spawn({ tex: "puff", x, y, life: 20, size0: 40, size1: 120 + 60 * p, alpha: 0.5, color: 0xffffff, additive: false, rot: Math.random() * 6, vrot: 0.02 });
    if (fx === "fire") {
      for (let i = 0; i < this.count(9); i += 1) {
        this.spawn({ tex: "glow", x: x + (Math.random() - 0.5) * 26, y, vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 3, drag: 0.03, life: 26 + Math.random() * 16, size0: 46, size1: 8, color: 0xff7a2d });
      }
    } else if (fx === "electric") {
      for (let i = 0; i < this.count(8); i += 1) {
        const a = Math.random() * Math.PI * 2;
        this.spawn({ tex: "streak", x, y, vx: Math.cos(a) * 16, vy: Math.sin(a) * 16, drag: 0.2, life: 8, size0: 80, size1: 30, stretch: true, color: 0xc8f4ff });
      }
    } else if (fx === "shock" || fx === "meteor") {
      this.spawn({ tex: "ring", x, y: y + 16, life: 20, size0: 40, size1: 300, alpha: 0.8, color: 0xffe9a8, flat: 0.35 });
    } else if (fx === "magic") {
      for (let i = 0; i < this.count(7); i += 1) {
        this.spawn({ tex: "star", x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2, life: 24, size0: 30, size1: 4, color: 0xf0c0ff, vrot: 0.2 });
      }
    }
  }

  shieldHit(x: number, y: number, color: string): void {
    const c = hexToNumber(color);
    this.spawn({ tex: "ring", x, y, life: 12, size0: 40, size1: 160, alpha: 0.9, color: c });
    this.spawn({ tex: "glow", x, y, life: 10, size0: 70, size1: 130, alpha: 0.8, color: 0xffffff });
    for (let i = 0; i < this.count(6); i += 1) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ tex: "dot", x, y, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, drag: 0.1, life: 14, size0: 9, size1: 2, color: c });
    }
  }

  shieldBreak(x: number, y: number): void {
    this.spawn({ tex: "star", x, y, life: 22, size0: 60, size1: 400, color: 0xffffff, z: 44 });
    this.spawn({ tex: "ring", x, y, life: 26, size0: 40, size1: 420, alpha: 0.9, color: 0x9ec5ff });
    for (let i = 0; i < this.count(26); i += 1) {
      const a = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 11;
      this.spawn({ tex: "streak", x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.05, life: 26, size0: 64, size1: 8, stretch: true, color: 0x9ec5ff });
    }
  }

  clash(x: number, y: number): void {
    this.spawn({ tex: "star", x, y, life: 14, size0: 40, size1: 240, color: 0xffffff, z: 44 });
    this.spawn({ tex: "ring", x, y, life: 16, size0: 20, size1: 170, alpha: 0.9, color: 0xfff2a0 });
    for (let i = 0; i < this.count(12); i += 1) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ tex: "streak", x, y, vx: Math.cos(a) * 11, vy: Math.sin(a) * 11, drag: 0.1, life: 14, size0: 60, size1: 10, stretch: true, color: 0xffe28a });
    }
  }

  /* -------------------------------------------------------------- MOVEMENT */

  dust(x: number, y: number, dir: number, power = 1): void {
    const n = this.count(2 + power * 2);
    for (let i = 0; i < n; i += 1) {
      this.spawn({
        tex: "puff", x: x + (Math.random() - 0.5) * 16, y: y - 4, vx: -dir * (1 + Math.random() * 2.5) * power + (Math.random() - 0.5), vy: -0.5 - Math.random() * 1.2,
        drag: 0.06, life: 22 + Math.random() * 12, size0: 22, size1: 70, alpha: 0.7, color: 0xffffff, additive: false, rot: Math.random() * 6, vrot: (Math.random() - 0.5) * 0.05, z: 14,
      });
    }
  }

  land(x: number, y: number, hard: boolean): void {
    this.spawn({ tex: "ring", x, y, life: 14, size0: 30, size1: hard ? 190 : 120, alpha: 0.5, color: 0xdbe3ff, flat: 0.22 });
    for (let i = 0; i < this.count(hard ? 8 : 4); i += 1) {
      const dir = i % 2 === 0 ? 1 : -1;
      this.spawn({
        tex: "puff", x, y: y - 4, vx: dir * (1.2 + Math.random() * 3), vy: -0.3 - Math.random() * 0.8, drag: 0.07, life: 24 + Math.random() * 10,
        size0: 28, size1: 80, alpha: 0.75, color: 0xffffff, additive: false, rot: Math.random() * 6, z: 14,
      });
    }
  }

  jump(x: number, y: number, air: boolean, color: string): void {
    const c = hexToNumber(color);
    this.spawn({ tex: "ring", x, y, life: 16, size0: 20, size1: air ? 130 : 95, alpha: 0.8, color: c, flat: 0.3 });
    if (air) {
      for (let i = 0; i < this.count(6); i += 1) {
        this.spawn({ tex: "dot", x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, drag: 0.05, life: 18, size0: 10, size1: 2, color: c });
      }
    }
  }

  dodge(x: number, y: number, color: string): void {
    this.spawn({ tex: "ring", x, y, life: 14, size0: 30, size1: 130, alpha: 0.7, color: hexToNumber(color) });
  }

  trail(x: number, y: number, color: string, size: number): void {
    this.spawn({ tex: "glow", x, y, life: 14, size0: size, size1: size * 0.3, alpha: 0.7, color: hexToNumber(color) });
  }

  /** One-frame glow used for live hitboxes. */
  flashGlow(x: number, y: number, color: number, size: number, alpha = 0.35): void {
    this.spawn({ tex: "glow", x, y, life: 3, size0: size, size1: size * 0.8, alpha, color });
  }

  speedLines(x: number, y: number, dir: number, color: string): void {
    this.spawn({ tex: "streak", x: x - dir * 30, y: y - 20 - Math.random() * 50, vx: -dir * 10, vy: 0, life: 10, size0: 130, size1: 40, stretch: true, alpha: 0.6, color: hexToNumber(color) });
  }

  /* --------------------------------------------------------------- SPECIAL */

  explosion(x: number, y: number, radius: number): void {
    this.spawn({ tex: "star", x, y, life: 12, size0: radius, size1: radius * 3, color: 0xffffff, z: 46 });
    this.spawn({ tex: "glow", x, y, life: 24, size0: radius * 0.8, size1: radius * 3.2, alpha: 0.9, color: 0xff8a3a });
    this.spawn({ tex: "ring", x, y, life: 20, size0: 40, size1: radius * 2.6, alpha: 0.9, color: 0xffd08a });
    for (let i = 0; i < this.count(20); i += 1) {
      const a = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 9;
      this.spawn({ tex: "glow", x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 1, drag: 0.07, gravity: 0.05, life: 26 + Math.random() * 14, size0: 40, size1: 6, color: Math.random() < 0.5 ? 0xff7a2d : 0xffd23d });
    }
    for (let i = 0; i < this.count(10); i += 1) {
      this.spawn({
        tex: "puff", x: x + (Math.random() - 0.5) * radius, y: y + (Math.random() - 0.5) * radius, vx: (Math.random() - 0.5) * 2, vy: -1 - Math.random() * 1.5,
        drag: 0.03, life: 36, size0: 50, size1: 150, alpha: 0.75, color: 0x6a6f88, additive: false, rot: Math.random() * 6, z: 20,
      });
    }
  }

  teleport(x: number, y: number, color: string, appear: boolean): void {
    const c = hexToNumber(color);
    this.spawn({ tex: "ring", x, y, life: 18, size0: appear ? 170 : 30, size1: appear ? 30 : 170, alpha: 0.9, color: c });
    this.spawn({ tex: "glow", x, y, life: 14, size0: 40, size1: 150, alpha: 0.8, color: 0xffffff });
    for (let i = 0; i < this.count(10); i += 1) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ tex: "star", x, y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, drag: 0.05, life: 24, size0: 24, size1: 2, color: c, vrot: 0.2 });
    }
  }

  respawn(x: number, y: number, color: string): void {
    const c = hexToNumber(color);
    this.spawn({ tex: "ring", x, y, life: 26, size0: 40, size1: 260, alpha: 0.9, color: c });
    this.spawn({ tex: "star", x, y, life: 22, size0: 40, size1: 260, color: 0xffffff, z: 44 });
    for (let i = 0; i < this.count(14); i += 1) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ tex: "glow", x, y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4 - 1, drag: 0.06, life: 30, size0: 34, size1: 4, color: c });
    }
  }

  itemSpawn(x: number, y: number, color: string): void {
    this.spawn({ tex: "ring", x, y, life: 24, size0: 20, size1: 160, alpha: 0.8, color: hexToNumber(color) });
  }

  itemPickup(x: number, y: number, color: string): void {
    const c = hexToNumber(color);
    this.spawn({ tex: "star", x, y, life: 16, size0: 30, size1: 220, color: c, z: 44 });
    for (let i = 0; i < this.count(10); i += 1) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ tex: "dot", x, y, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5 - 2, drag: 0.06, life: 22, size0: 13, size1: 2, color: c });
    }
  }

  /** Blast-zone knockout: identity-shape confetti, a streak along the exit line and a huge flash. */
  ko(x: number, y: number, dx: number, dy: number, shape: SlotShape, color: string, big: boolean): void {
    const c = hexToNumber(color);
    const scale = big ? 1.6 : 1;
    this.spawn({ tex: "star", x, y, life: 22, size0: 120 * scale, size1: 760 * scale, color: 0xffffff, z: 50 });
    this.spawn({ tex: "glow", x, y, life: 36, size0: 140 * scale, size1: 640 * scale, alpha: 0.9, color: c });
    this.spawn({ tex: "ring", x, y, life: 30, size0: 60, size1: 620 * scale, color: c });
    this.spawn({ tex: "ring", x, y, life: 38, size0: 40, size1: 900 * scale, alpha: 0.7, color: 0xffffff });
    const outward = Math.atan2(dy || 0, dx || 0);
    const hasDir = dx !== 0 || dy !== 0;
    for (let i = 0; i < this.count(22 * scale); i += 1) {
      const a = hasDir ? outward + Math.PI + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 14;
      this.spawn({
        tex: "shape", shape, x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.04, gravity: 0.12, life: 46 + Math.random() * 30,
        size0: 38 + Math.random() * 28, size1: 8, color: c, vrot: (Math.random() - 0.5) * 0.4, rot: Math.random() * 6,
      });
    }
    for (let i = 0; i < this.count(20 * scale); i += 1) {
      const a = hasDir ? outward + Math.PI + (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2;
      const speed = 14 + Math.random() * 22;
      this.spawn({ tex: "streak", x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.04, life: 30, size0: 170, size1: 20, stretch: true, color: 0xffffff });
    }
  }

  confetti(x: number, y: number, color: string, shape: SlotShape): void {
    const c = hexToNumber(color);
    const tints = [c, hexToNumber(mixHex(color, "#ffffff", 0.5)), 0xffd23d, 0xffffff];
    for (let i = 0; i < this.count(3); i += 1) {
      this.spawn({
        tex: Math.random() < 0.5 ? "shape" : "dot", shape, x: x + (Math.random() - 0.5) * 700, y, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, gravity: 0.02, drag: 0.01,
        life: 120, size0: 20 + Math.random() * 16, size1: 12, color: tints[Math.floor(Math.random() * tints.length)], vrot: (Math.random() - 0.5) * 0.3, additive: false, alpha: 1,
      });
    }
  }

  beam(x: number, y: number, color: string): void {
    this.spawn({ tex: "glow", x, y: y - 80, life: 6, size0: 100, size1: 100, alpha: 0.55, color: hexToNumber(color) });
  }

  ambientEmber(x: number, y: number, color: number): void {
    this.spawn({ tex: "glow", x, y, z: -50, vx: (Math.random() - 0.5) * 0.6, vy: -0.8 - Math.random() * 1.2, life: 90 + Math.random() * 60, size0: 12 + Math.random() * 14, size1: 2, alpha: 0.7, color, fadeIn: 0.15 });
  }

  /** Slow ambient dust/embers/stars drifting through the stage for depth. */
  ambientMote(x: number, y: number, color: number, z: number): void {
    this.spawn({ tex: "dot", x, y, z, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.3, life: 150 + Math.random() * 100, size0: 4 + Math.random() * 6, size1: 4, alpha: 0.6, color, fadeIn: 0.2 });
  }
}
