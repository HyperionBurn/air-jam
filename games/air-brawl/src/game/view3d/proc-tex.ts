import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Procedural, tileable material textures (colour + height). Everything is painted
 * once per page load into canvases and cached: stages share the same few maps
 * and differ by tint/repeat, which keeps memory flat across rematches.
 */

export interface PBRTex {
  map: CanvasTexture;
  bump: CanvasTexture;
  /** Optional emissive companion (lit windows, lava cracks, rune lines). */
  emissive?: CanvasTexture;
}

/* ---------------------------------------------------------------- noise */

const hash = (x: number, y: number, s: number): number => {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Periodic value noise; `p` = lattice period so the texture tiles. */
const vnoise = (x: number, y: number, p: number, s: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = mod(xi, p);
  const x1 = mod(xi + 1, p);
  const y0 = mod(yi, p);
  const y1 = mod(yi + 1, p);
  const a = hash(x0, y0, s);
  const b = hash(x1, y0, s);
  const c = hash(x0, y1, s);
  const d = hash(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

export const fbm = (u: number, v: number, base: number, octaves: number, seed: number): number => {
  let sum = 0;
  let amp = 0.5;
  let freq = base;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * vnoise(u * freq, v * freq, freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export type RGB = [number, number, number];
export const rgb = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mul3 = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/* --------------------------------------------------------------- painter */

type Sample = (u: number, v: number) => { c: RGB; h: number; e?: RGB };

const finish = (tex: CanvasTexture, srgb: boolean): CanvasTexture => {
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  return tex;
};

const paint = (size: number, sample: Sample, emissive = false): PBRTex => {
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c;
  };
  const cc = mk();
  const cb = mk();
  const ce = emissive ? mk() : null;
  const gc = cc.getContext("2d");
  const gb = cb.getContext("2d");
  const ge = ce?.getContext("2d") ?? null;
  if (!gc || !gb) throw new Error("2D canvas unavailable");
  const ic = gc.createImageData(size, size);
  const ib = gb.createImageData(size, size);
  const ie = ge ? ge.createImageData(size, size) : null;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const s = sample(x / size, y / size);
      const i = (y * size + x) * 4;
      ic.data[i] = clamp(s.c[0]) * 255;
      ic.data[i + 1] = clamp(s.c[1]) * 255;
      ic.data[i + 2] = clamp(s.c[2]) * 255;
      ic.data[i + 3] = 255;
      const hv = clamp(s.h) * 255;
      ib.data[i] = ib.data[i + 1] = ib.data[i + 2] = hv;
      ib.data[i + 3] = 255;
      if (ie) {
        const e = s.e ?? [0, 0, 0];
        ie.data[i] = clamp(e[0]) * 255;
        ie.data[i + 1] = clamp(e[1]) * 255;
        ie.data[i + 2] = clamp(e[2]) * 255;
        ie.data[i + 3] = 255;
      }
    }
  }
  gc.putImageData(ic, 0, 0);
  gb.putImageData(ib, 0, 0);
  if (ge && ie && ce) ge.putImageData(ie, 0, 0);
  return {
    map: finish(new CanvasTexture(cc), true),
    bump: finish(new CanvasTexture(cb), false),
    emissive: ce ? finish(new CanvasTexture(ce), true) : undefined,
  };
};

const cache = new Map<string, PBRTex>();
const cached = (key: string, make: () => PBRTex): PBRTex => {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
};

/* -------------------------------------------------------------- materials */

/** Running-bond ashlar blocks: per-block tone, chipped edges, moss in the joints. */
export const stoneBlocks = (base = 0xb9b2a4, moss = 0x6f8f4a, rows = 4, cols = 4): PBRTex =>
  cached(`stone:${base}:${moss}:${rows}:${cols}`, () => {
    const b = rgb(base);
    const m = rgb(moss);
    return paint(512, (u, v) => {
      const row = Math.floor(v * rows);
      const off = (row % 2) * 0.5;
      const uu = mod(u * cols + off, cols);
      const col = Math.floor(uu);
      const fu = uu - col;
      const fv = v * rows - row;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const tone = hash(col, row, 3);
      const grain = fbm(u, v, 8, 4, 5);
      const chip = fbm(u, v, 24, 2, 9);
      const groove = 1 - smooth(0.0, 0.045 + chip * 0.02, edge);
      let c = mul3(b, 0.82 + tone * 0.28 + (grain - 0.5) * 0.35);
      c = lerp3(c, mul3(b, 0.55), groove * 0.9);
      const mossAmt = smooth(0.55, 0.85, fbm(u, v, 5, 3, 13) + groove * 0.4 + (1 - fv) * 0.12);
      c = lerp3(c, m, mossAmt * 0.65);
      const h = 0.62 + (grain - 0.5) * 0.25 - groove * 0.5 + chip * 0.08;
      return { c, h };
    });
  });

/** Layered cliff rock: horizontal strata, cracks, warm/cool banding. */
export const rockStrata = (a = 0x8a7f78, b = 0x5b5560, seed = 2): PBRTex =>
  cached(`rock:${a}:${b}:${seed}`, () => {
    const ca = rgb(a);
    const cb = rgb(b);
    return paint(512, (u, v) => {
      const warp = (fbm(u, v, 4, 3, seed) - 0.5) * 0.12;
      const band = Math.sin((v + warp) * Math.PI * 2 * 9) * 0.5 + 0.5;
      const fine = fbm(u, v, 16, 4, seed + 3);
      const crack = smooth(0.47, 0.5, Math.abs(fbm(u, v, 6, 4, seed + 7) - 0.5) + 0.46);
      let c = lerp3(ca, cb, band * 0.6 + fine * 0.5 - 0.15);
      c = mul3(c, 0.85 + fine * 0.3);
      c = mul3(c, 1 - (1 - crack) * 0.18);
      return { c, h: 0.5 + band * 0.18 + (fine - 0.5) * 0.4 - (1 - crack) * 0.18 };
    });
  });

export const grassTurf = (a = 0x5cae4a, b = 0x2f7a3a): PBRTex =>
  cached(`grass:${a}:${b}`, () => {
    const ca = rgb(a);
    const cb = rgb(b);
    return paint(256, (u, v) => {
      const n = fbm(u, v, 6, 4, 21);
      const blades = fbm(u, v, 64, 2, 23);
      let c = lerp3(cb, ca, n * 0.85 + blades * 0.3);
      c = mul3(c, 0.88 + blades * 0.25);
      return { c, h: 0.45 + blades * 0.5 };
    });
  });

/** Rooftop / plaza concrete: slab joints, stains, hairline cracks. */
export const concrete = (base = 0x8a8794, line = 0x2c2a38, slabs = 4): PBRTex =>
  cached(`concrete:${base}:${line}:${slabs}`, () => {
    const b = rgb(base);
    const l = rgb(line);
    return paint(512, (u, v) => {
      const fu = mod(u * slabs, 1);
      const fv = mod(v * slabs, 1);
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const joint = 1 - smooth(0, 0.012, edge);
      const stain = fbm(u, v, 4, 5, 31);
      const speck = fbm(u, v, 96, 1, 33);
      let c = mul3(b, 0.78 + stain * 0.35 + (speck - 0.5) * 0.18);
      c = lerp3(c, l, joint * 0.85);
      return { c, h: 0.6 + (stain - 0.5) * 0.2 + (speck - 0.5) * 0.15 - joint * 0.5 };
    });
  });

/** Painted/brushed steel plating with seams and rivets. */
export const metalPlate = (base = 0x6d7184, seam = 0x15161f, cells = 4): PBRTex =>
  cached(`metal:${base}:${seam}:${cells}`, () => {
    const b = rgb(base);
    const s = rgb(seam);
    return paint(512, (u, v) => {
      const fu = mod(u * cells, 1);
      const fv = mod(v * cells, 1);
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const seamAmt = 1 - smooth(0, 0.018, edge);
      const brushed = fbm(u * 0.15, v, 3, 3, 41);
      const wear = fbm(u, v, 7, 4, 43);
      // rivets sit just inside each plate corner
      const rx = Math.min(fu, 1 - fu) - 0.07;
      const ry = Math.min(fv, 1 - fv) - 0.07;
      const rivet = 1 - smooth(0.0, 0.022, Math.hypot(rx, ry));
      let c = mul3(b, 0.82 + brushed * 0.3 + (wear - 0.5) * 0.3);
      c = lerp3(c, s, seamAmt * 0.9);
      c = mul3(c, 1 + rivet * 0.35);
      return { c, h: 0.55 + rivet * 0.35 - seamAmt * 0.5 + (wear - 0.5) * 0.1 };
    });
  });

/** Dark basalt with glowing cracks (emissive map carries the lava). */
export const basalt = (base = 0x2b211f, glow = 0xff6a1f): PBRTex =>
  cached(`basalt:${base}:${glow}`, () => {
    const b = rgb(base);
    const g = rgb(glow);
    return paint(
      512,
      (u, v) => {
        const n = fbm(u, v, 5, 5, 51);
        const crackNoise = Math.abs(fbm(u, v, 4, 4, 53) - 0.5);
        const crack = 1 - smooth(0.0, 0.035, crackNoise);
        const detail = fbm(u, v, 40, 2, 55);
        const c = mul3(b, 0.7 + n * 0.7 + (detail - 0.5) * 0.25);
        const heat = crack * (0.55 + fbm(u, v, 10, 3, 57) * 0.7);
        return { c: lerp3(c, mul3(g, 0.55), crack * 0.4), h: 0.6 + (n - 0.5) * 0.4 - crack * 0.4, e: mul3(g, heat) };
      },
      true,
    );
  });

/** Building façade: window grid with per-window lit state (emissive) and spandrel bands. */
export const facade = (seed: number, lit: number[], wall = 0x2e2a45, cols = 6, rows = 14, litRatio = 0.4): PBRTex =>
  cached(`facade:${seed}:${lit.join(",")}:${wall}:${cols}:${rows}:${litRatio}`, () => {
    const w = rgb(wall);
    const palette = lit.map(rgb);
    return paint(
      512,
      (u, v) => {
        const cx = Math.floor(u * cols);
        const cy = Math.floor(v * rows);
        const fu = u * cols - cx;
        const fv = v * rows - cy;
        const inWin = fu > 0.2 && fu < 0.8 && fv > 0.22 && fv < 0.78;
        const on = hash(cx, cy, seed) < litRatio;
        const tint = palette[Math.floor(hash(cx, cy, seed + 9) * palette.length) % palette.length];
        const grime = fbm(u, v, 6, 3, seed + 5);
        let c = mul3(w, 0.8 + grime * 0.4);
        let e: RGB = [0, 0, 0];
        let h = 0.6 + (grime - 0.5) * 0.1;
        if (inWin) {
          if (on) {
            const flick = 0.55 + hash(cx, cy, seed + 21) * 0.6;
            c = mul3(tint, 0.9);
            e = mul3(tint, flick);
          } else {
            c = lerp3(mul3(w, 0.35), [0.15, 0.2, 0.3], 0.5);
            e = [0.015, 0.02, 0.035];
          }
          h = 0.2;
        } else if (fv < 0.12 || fv > 0.88) {
          c = mul3(c, 0.85);
        }
        return { c, h, e };
      },
      true,
    );
  });

export const woodPlanks = (base = 0x9b6b43, planks = 6): PBRTex =>
  cached(`wood:${base}:${planks}`, () => {
    const b = rgb(base);
    return paint(256, (u, v) => {
      const row = Math.floor(v * planks);
      const fv = v * planks - row;
      const seam = 1 - smooth(0, 0.06, Math.min(fv, 1 - fv));
      const grain = fbm(u * 0.2 + hash(row, 0, 61), v * 6, 3, 3, 63 + row);
      let c = mul3(b, 0.7 + grain * 0.6 + hash(row, 1, 65) * 0.15);
      c = mul3(c, 1 - seam * 0.6);
      return { c, h: 0.6 + (grain - 0.5) * 0.3 - seam * 0.5 };
    });
  });

/* ------------------------------------------------------------- sprites */

let cloudTex: CanvasTexture | null = null;
/** Cumulus billboard: many irregular lobes, flat shaded underside, noise-eroded soft edge. */
export const cloudSprite = (): CanvasTexture => {
  if (cloudTex) return cloudTex;
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const lobes: [number, number, number][] = [];
  for (let i = 0; i < 46; i += 1) {
    const t = hash(i, 0, 71);
    const x = W * (0.1 + 0.8 * t);
    const dome = Math.sin(t * Math.PI);
    const r = 16 + dome * 44 * (0.4 + hash(i, 1, 73)) + hash(i, 2, 79) * 12;
    const y = H * 0.7 - dome * 62 * (0.3 + hash(i, 3, 83)) - hash(i, 4, 85) * 16;
    lobes.push([x, y, r]);
  }
  lobes.sort((a, b) => b[1] - a[1]);
  for (const [x, y, r] of lobes) {
    const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.05, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.6, "rgba(246,249,255,0.96)");
    grad.addColorStop(0.9, "rgba(205,218,240,0.7)");
    grad.addColorStop(1, "rgba(190,206,235,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Flatten and shade the underside.
  g.globalCompositeOperation = "source-atop";
  const under = g.createLinearGradient(0, H * 0.46, 0, H * 0.82);
  under.addColorStop(0, "rgba(130,150,200,0)");
  under.addColorStop(1, "rgba(120,140,196,0.62)");
  g.fillStyle = under;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "destination-in";
  const fade = g.createLinearGradient(0, H * 0.7, 0, H * 0.92);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  cloudTex = finish(new CanvasTexture(c), true);
  cloudTex.generateMipmaps = false;
  cloudTex.minFilter = LinearFilter;
  cloudTex.wrapS = cloudTex.wrapT = 1001;
  return cloudTex;
};

let softTex: CanvasTexture | null = null;
/** Round soft falloff, reused for fog banks, lamp halos and light shafts. */
export const softGlow = (): CanvasTexture => {
  if (softTex) return softTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.42)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  softTex = finish(new CanvasTexture(c), true);
  softTex.generateMipmaps = false;
  softTex.minFilter = LinearFilter;
  softTex.wrapS = softTex.wrapT = 1001;
  return softTex;
};

let shaftTex: CanvasTexture | null = null;
/** Vertical-gradient light shaft card (bright at the top, fading with a soft side falloff). */
export const shaftSprite = (): CanvasTexture => {
  if (shaftTex) return shaftTex;
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
      const side = 1 - Math.abs((x / (W - 1)) * 2 - 1);
      const down = Math.pow(1 - y / (H - 1), 1.4);
      const streak = 0.65 + 0.35 * vnoise(x / 6, y / 40, 1000, 77);
      const a = Math.pow(side, 1.6) * down * streak;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  shaftTex = finish(new CanvasTexture(c), true);
  shaftTex.generateMipmaps = false;
  shaftTex.minFilter = LinearFilter;
  shaftTex.wrapS = shaftTex.wrapT = 1001;
  return shaftTex;
};

/** Cloned texture set with its own repeat (shares the painted canvas, separate GPU upload). */
export const repeated = (t: PBRTex, rx: number, ry: number): PBRTex => {
  const k = `rep:${t.map.uuid}:${rx}:${ry}`;
  return cached(k, () => {
    const map = t.map.clone();
    map.repeat.set(rx, ry);
    map.needsUpdate = true;
    const bump = t.bump.clone();
    bump.repeat.set(rx, ry);
    bump.needsUpdate = true;
    let emissive: CanvasTexture | undefined;
    if (t.emissive) {
      emissive = t.emissive.clone();
      emissive.repeat.set(rx, ry);
      emissive.needsUpdate = true;
    }
    return { map, bump, emissive };
  });
};
