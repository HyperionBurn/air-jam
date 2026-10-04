/**
 * Generates every Air Brawl sound effect and both music loops as WAV files.
 * Everything is synthesized from oscillators, filtered noise and envelopes —
 * no sampled, ripped or third-party audio. Output is deterministic (seeded
 * noise), so re-running produces identical files.
 *
 *   node scripts/generate-audio.mjs
 *
 * Output: public/sounds/*.wav (16-bit PCM mono; SFX 32 kHz, music 22.05 kHz).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sounds");
mkdirSync(OUT_DIR, { recursive: true });

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ toolkit */

/** Seeded noise so builds are reproducible. */
const makeRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

class Track {
  constructor(seconds, rate) {
    this.rate = rate;
    this.data = new Float32Array(Math.max(1, Math.floor(seconds * rate)));
    this.rng = makeRng(0x9e3779b9);
  }
  get seconds() {
    return this.data.length / this.rate;
  }
  /** Add `fn(t, n)` over [start, start+dur). `t` is local seconds, `n` local sample index. */
  add(start, dur, fn, gain = 1) {
    const from = Math.floor(start * this.rate);
    const count = Math.floor(dur * this.rate);
    for (let n = 0; n < count; n += 1) {
      const i = from + n;
      if (i < 0 || i >= this.data.length) continue;
      this.data[i] += fn(n / this.rate, n) * gain;
    }
    return this;
  }
  /** Mix another track in at `start` seconds. */
  mix(other, start = 0, gain = 1) {
    const from = Math.floor(start * this.rate);
    for (let n = 0; n < other.data.length; n += 1) {
      const i = from + n;
      if (i >= this.data.length) break;
      this.data[i] += other.data[n] * gain;
    }
    return this;
  }
  /** Feedback echo / cheap reverb tail. */
  echo(delaySec, feedback, wet) {
    const d = Math.floor(delaySec * this.rate);
    const out = new Float32Array(this.data.length);
    for (let i = 0; i < this.data.length; i += 1) {
      const fb = i >= d ? out[i - d] * feedback : 0;
      out[i] = this.data[i] + fb;
    }
    for (let i = 0; i < this.data.length; i += 1) this.data[i] = this.data[i] * (1 - wet * 0.5) + out[i] * wet;
    return this;
  }
  lowpass(cutoff) {
    const a = 1 - Math.exp((-TAU * cutoff) / this.rate);
    let y = 0;
    for (let i = 0; i < this.data.length; i += 1) {
      y += a * (this.data[i] - y);
      this.data[i] = y;
    }
    return this;
  }
  /** Soft saturation. */
  drive(amount) {
    const k = 1 + amount;
    for (let i = 0; i < this.data.length; i += 1) this.data[i] = Math.tanh(this.data[i] * k) / Math.tanh(k);
    return this;
  }
  fadeEdges(inSec = 0.002, outSec = 0.01) {
    const a = Math.floor(inSec * this.rate);
    const b = Math.floor(outSec * this.rate);
    for (let i = 0; i < a && i < this.data.length; i += 1) this.data[i] *= i / a;
    for (let i = 0; i < b && i < this.data.length; i += 1) this.data[this.data.length - 1 - i] *= i / b;
    return this;
  }
  normalize(peak = 0.9) {
    let max = 0;
    for (const v of this.data) max = Math.max(max, Math.abs(v));
    if (max > 0) for (let i = 0; i < this.data.length; i += 1) this.data[i] *= peak / max;
    return this;
  }
}

/** Streaming helpers (stateful per voice). */
const phaseOsc = (rate) => {
  let phase = 0;
  return (freq) => {
    phase += (TAU * freq) / rate;
    if (phase > TAU) phase -= TAU;
    return phase;
  };
};
const wave = {
  sine: Math.sin,
  tri: (p) => (2 / Math.PI) * Math.asin(Math.sin(p)),
  saw: (p) => ((p % TAU) / TAU) * 2 - 1,
  square: (p) => (Math.sin(p) >= 0 ? 0.7 : -0.7),
};

const expDecay = (t, tau) => Math.exp(-t / tau);
const lerp = (a, b, x) => a + (b - a) * x;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const adsr = (t, dur, a = 0.004, r = 0.04) => Math.min(1, t / a) * clamp01((dur - t) / r);
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

/** Biquad band-pass / high-pass applied while streaming noise. */
const makeBiquad = (type, freq, q, rate) => {
  const w = (TAU * freq) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  let b0, b1, b2;
  if (type === "bp") {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else if (type === "hp") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  }
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
};

const writeWav = (name, track) => {
  const { data, rate } = track;
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i += 1) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  writeFileSync(join(OUT_DIR, `${name}.wav`), buf);
  console.log(`  ${name}.wav  ${(data.length / rate).toFixed(2)}s  ${(buf.length / 1024).toFixed(0)}KB`);
};

/* ----------------------------------------------------------------- voices */

const SR = 32000;
const sfx = (seconds) => new Track(seconds, SR);

/** Pitched tone with sweep + exponential decay. */
const addTone = (tr, { start = 0, dur, f0, f1 = f0, shape = "sine", gain = 0.5, tau = dur / 3, attack = 0.003, vibrato = 0 }) => {
  const osc = phaseOsc(tr.rate);
  tr.add(start, dur, (t) => {
    const x = t / dur;
    const f = f0 * (f1 / f0) ** x * (1 + vibrato * Math.sin(TAU * 22 * t));
    return wave[shape](osc(f)) * expDecay(t, tau) * Math.min(1, t / attack) * clamp01((dur - t) / 0.01);
  }, gain);
};

/** Filtered noise burst, optional centre-frequency sweep. */
const addNoise = (tr, { start = 0, dur, type = "bp", f0, f1 = f0, q = 1, gain = 0.5, tau = dur / 3, attack = 0.002 }) => {
  const sweeping = f0 !== f1;
  let filt = makeBiquad(type, f0, q, tr.rate);
  let lastBucket = -1;
  tr.add(start, dur, (t) => {
    if (sweeping) {
      const bucket = Math.floor((t / dur) * 24);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        filt = makeBiquad(type, f0 * (f1 / f0) ** (t / dur), q, tr.rate);
      }
    }
    return filt(tr.rng() * 2 - 1) * expDecay(t, tau) * Math.min(1, t / attack) * clamp01((dur - t) / 0.01);
  }, gain);
};

const note = (tr, start, midiNote, dur, shape = "tri", gain = 0.4, tau = dur * 0.5) =>
  addTone(tr, { start, dur, f0: midi(midiNote), shape, gain, tau, attack: 0.004 });

/* ------------------------------------------------------------------- SFX */

const hit = (name, { dur, thump0, thump1, thumpGain, crack, noiseGain, drive, tail = 0 }) => {
  const t = sfx(dur);
  addTone(t, { dur: dur * 0.85, f0: thump0, f1: thump1, gain: thumpGain, tau: dur * 0.22 });
  addNoise(t, { dur: dur * 0.5, f0: crack, q: 0.9, gain: noiseGain, tau: dur * 0.12 });
  addNoise(t, { dur: dur * 0.9, type: "lp", f0: 900, q: 0.7, gain: noiseGain * 0.8, tau: dur * 0.25 });
  if (tail > 0) t.echo(0.045, 0.45, tail);
  t.drive(drive).fadeEdges().normalize(0.95);
  writeWav(name, t);
};

const buildSfx = () => {
  hit("hit-light", { dur: 0.13, thump0: 240, thump1: 110, thumpGain: 0.7, crack: 3200, noiseGain: 0.5, drive: 0.6 });
  hit("hit-mid", { dur: 0.2, thump0: 190, thump1: 70, thumpGain: 0.9, crack: 2600, noiseGain: 0.6, drive: 1.1 });
  hit("hit-heavy", { dur: 0.32, thump0: 140, thump1: 45, thumpGain: 1.1, crack: 2000, noiseGain: 0.75, drive: 1.8, tail: 0.25 });
  hit("hit-mega", { dur: 0.7, thump0: 110, thump1: 30, thumpGain: 1.3, crack: 1500, noiseGain: 0.9, drive: 2.6, tail: 0.5 });

  let t = sfx(0.16);
  addNoise(t, { dur: 0.16, f0: 500, f1: 2600, q: 1.4, gain: 0.8, tau: 0.05, attack: 0.03 });
  writeWav("swing", t.fadeEdges().normalize(0.7));
  t = sfx(0.26);
  addNoise(t, { dur: 0.26, f0: 260, f1: 1500, q: 1.1, gain: 1, tau: 0.09, attack: 0.05 });
  addTone(t, { dur: 0.26, f0: 120, f1: 70, gain: 0.25, tau: 0.1 });
  writeWav("swing-heavy", t.fadeEdges().normalize(0.8));

  t = sfx(0.24);
  addTone(t, { dur: 0.24, f0: 420, f1: 680, gain: 0.4, tau: 0.1, vibrato: 0.02, shape: "tri" });
  addTone(t, { dur: 0.24, f0: 840, f1: 1360, gain: 0.18, tau: 0.08, shape: "sine" });
  writeWav("shield", t.fadeEdges().normalize(0.6));

  t = sfx(0.65);
  addNoise(t, { dur: 0.3, type: "hp", f0: 3500, q: 0.7, gain: 0.8, tau: 0.08 });
  for (const [i, f] of [1320, 1780, 2410, 3100, 760].entries()) addTone(t, { start: i * 0.012, dur: 0.6, f0: f, f1: f * 0.7, gain: 0.25, tau: 0.17 });
  addTone(t, { dur: 0.4, f0: 160, f1: 50, gain: 0.7, tau: 0.1 });
  t.echo(0.07, 0.4, 0.4).drive(0.8);
  writeWav("shield-break", t.fadeEdges().normalize(0.9));

  t = sfx(0.12);
  addTone(t, { dur: 0.12, f0: 300, f1: 620, gain: 0.5, tau: 0.06 });
  writeWav("jump", t.fadeEdges().normalize(0.55));
  t = sfx(0.2);
  addTone(t, { dur: 0.1, f0: 360, f1: 700, gain: 0.45, tau: 0.05 });
  addTone(t, { start: 0.07, dur: 0.13, f0: 520, f1: 1000, gain: 0.45, tau: 0.06 });
  writeWav("double-jump", t.fadeEdges().normalize(0.6));
  t = sfx(0.14);
  addNoise(t, { dur: 0.14, type: "lp", f0: 700, q: 0.7, gain: 1, tau: 0.04 });
  addTone(t, { dur: 0.14, f0: 120, f1: 55, gain: 0.7, tau: 0.05 });
  writeWav("land", t.fadeEdges().normalize(0.6));
  t = sfx(0.18);
  addNoise(t, { dur: 0.18, type: "hp", f0: 2200, q: 0.7, gain: 0.6, tau: 0.06, attack: 0.02 });
  addNoise(t, { dur: 0.18, f0: 1200, f1: 3200, q: 1.2, gain: 0.5, tau: 0.05, attack: 0.02 });
  writeWav("dash", t.fadeEdges().normalize(0.55));
  t = sfx(0.22);
  addNoise(t, { dur: 0.22, f0: 2800, f1: 600, q: 1.2, gain: 0.9, tau: 0.08, attack: 0.02 });
  addTone(t, { dur: 0.15, f0: 700, f1: 300, gain: 0.2, tau: 0.06 });
  writeWav("dodge", t.fadeEdges().normalize(0.6));

  t = sfx(0.16);
  addTone(t, { dur: 0.16, f0: 330, f1: 220, shape: "square", gain: 0.3, tau: 0.07 });
  addNoise(t, { dur: 0.05, f0: 2400, q: 1, gain: 0.5, tau: 0.02 });
  writeWav("grab", t.fadeEdges().normalize(0.6));
  t = sfx(0.3);
  addNoise(t, { dur: 0.22, f0: 400, f1: 2400, q: 1.1, gain: 0.7, tau: 0.08, attack: 0.04 });
  addTone(t, { start: 0.14, dur: 0.16, f0: 180, f1: 60, gain: 0.9, tau: 0.06 });
  writeWav("throw", t.fadeEdges().normalize(0.75));

  t = sfx(0.34);
  addTone(t, { dur: 0.34, f0: 260, f1: 1100, shape: "saw", gain: 0.25, tau: 0.14 });
  addTone(t, { dur: 0.34, f0: 520, f1: 2200, shape: "sine", gain: 0.25, tau: 0.12, vibrato: 0.03 });
  addNoise(t, { dur: 0.3, type: "hp", f0: 4200, gain: 0.25, tau: 0.1 });
  writeWav("special", t.lowpass(9000).fadeEdges().normalize(0.7));
  t = sfx(0.2);
  addTone(t, { dur: 0.2, f0: 1500, f1: 280, gain: 0.55, tau: 0.07, shape: "tri" });
  addTone(t, { dur: 0.2, f0: 750, f1: 140, gain: 0.3, tau: 0.08 });
  writeWav("projectile", t.fadeEdges().normalize(0.6));

  t = sfx(0.85);
  addNoise(t, { dur: 0.85, type: "lp", f0: 1400, q: 0.7, gain: 1, tau: 0.22 });
  addNoise(t, { dur: 0.35, type: "bp", f0: 2200, q: 0.6, gain: 0.5, tau: 0.07 });
  addTone(t, { dur: 0.7, f0: 95, f1: 24, gain: 1.2, tau: 0.22 });
  t.echo(0.06, 0.45, 0.35).drive(1.6);
  writeWav("explosion", t.lowpass(11000).fadeEdges().normalize(0.95));

  t = sfx(0.3);
  addTone(t, { dur: 0.3, f0: 380, f1: 1500, gain: 0.4, tau: 0.1, vibrato: 0.08 });
  addTone(t, { dur: 0.3, f0: 1500, f1: 300, gain: 0.3, tau: 0.12 });
  addNoise(t, { dur: 0.28, type: "hp", f0: 3800, gain: 0.2, tau: 0.08 });
  writeWav("teleport", t.fadeEdges().normalize(0.6));

  t = sfx(0.36);
  for (const [i, f] of [1750, 2380, 3050, 1210].entries()) addTone(t, { dur: 0.34, f0: f, gain: 0.3 / (1 + i * 0.2), tau: 0.1 });
  addNoise(t, { dur: 0.04, f0: 5000, q: 0.8, gain: 0.9, tau: 0.01 });
  writeWav("clash", t.drive(0.8).fadeEdges().normalize(0.8));

  t = sfx(0.12);
  addTone(t, { dur: 0.1, f0: 600, f1: 900, gain: 0.5, tau: 0.04, shape: "tri" });
  addNoise(t, { dur: 0.03, f0: 3000, q: 1, gain: 0.4, tau: 0.01 });
  writeWav("ledge", t.fadeEdges().normalize(0.55));

  t = sfx(0.36);
  for (const [i, n] of [72, 76, 79, 84].entries()) note(t, i * 0.065, n, 0.2, "tri", 0.35, 0.09);
  writeWav("item", t.fadeEdges().normalize(0.65));
  t = sfx(0.55);
  note(t, 0, 88, 0.35, "sine", 0.4, 0.14);
  note(t, 0.09, 95, 0.4, "sine", 0.3, 0.16);
  addNoise(t, { dur: 0.35, type: "hp", f0: 6000, gain: 0.12, tau: 0.1 });
  writeWav("item-spawn", t.echo(0.1, 0.4, 0.4).fadeEdges().normalize(0.55));

  t = sfx(0.5);
  for (const s of [0, 0.2]) addTone(t, { start: s, dur: 0.14, f0: 880, gain: 0.35, shape: "square", tau: 0.1 });
  writeWav("hazard-warn", t.lowpass(4000).fadeEdges().normalize(0.55));
  t = sfx(0.7);
  addNoise(t, { dur: 0.7, f0: 700, f1: 200, q: 0.5, gain: 1, tau: 0.3, attack: 0.04 });
  addTone(t, { dur: 0.6, f0: 70, f1: 140, shape: "saw", gain: 0.5, tau: 0.25 });
  writeWav("hazard-fire", t.drive(1.2).lowpass(7000).fadeEdges().normalize(0.85));

  t = sfx(1.1);
  addTone(t, { dur: 0.9, f0: 120, f1: 28, gain: 1.2, tau: 0.3 });
  addNoise(t, { dur: 0.8, type: "lp", f0: 1600, gain: 0.9, tau: 0.25 });
  addTone(t, { dur: 0.9, f0: 900, f1: 120, shape: "saw", gain: 0.3, tau: 0.2 });
  t.echo(0.09, 0.5, 0.5).drive(1.8);
  writeWav("ko", t.fadeEdges().normalize(0.95));
  t = sfx(2.0);
  addTone(t, { start: 0.0, dur: 1.5, f0: 100, f1: 22, gain: 1.4, tau: 0.5 });
  addNoise(t, { dur: 1.4, type: "lp", f0: 1800, gain: 1, tau: 0.45 });
  addTone(t, { start: 0.0, dur: 1.2, f0: 1400, f1: 90, shape: "saw", gain: 0.35, tau: 0.35 });
  for (const [i, f] of [1200, 1800, 2700].entries()) addTone(t, { start: 0.05 + i * 0.04, dur: 1.4, f0: f, f1: f * 0.5, gain: 0.12, tau: 0.5 });
  t.echo(0.13, 0.55, 0.55).drive(2.2);
  writeWav("final-ko", t.fadeEdges().normalize(1));

  t = sfx(0.6);
  addTone(t, { dur: 0.55, f0: 300, f1: 1200, shape: "saw", gain: 0.25, tau: 0.25, attack: 0.1 });
  addTone(t, { dur: 0.55, f0: 600, f1: 2400, gain: 0.25, tau: 0.22, attack: 0.1, vibrato: 0.02 });
  note(t, 0.3, 88, 0.3, "sine", 0.3, 0.12);
  writeWav("respawn", t.lowpass(9000).echo(0.08, 0.4, 0.3).fadeEdges().normalize(0.65));

  t = sfx(0.22);
  addTone(t, { dur: 0.2, f0: 660, gain: 0.5, tau: 0.12 });
  writeWav("countdown", t.fadeEdges().normalize(0.75));
  t = sfx(0.6);
  for (const f of [880, 1318, 1760]) addTone(t, { dur: 0.55, f0: f, f1: f * 1.01, shape: "tri", gain: 0.3, tau: 0.22 });
  addNoise(t, { dur: 0.2, type: "hp", f0: 4000, gain: 0.2, tau: 0.06 });
  writeWav("go", t.echo(0.08, 0.35, 0.3).fadeEdges().normalize(0.85));

  t = sfx(2.6);
  const fan = [[67, 0, 0.18], [72, 0.18, 0.18], [76, 0.36, 0.18], [79, 0.54, 0.3], [76, 0.86, 0.14], [79, 1.0, 0.14], [84, 1.14, 0.9]];
  for (const [n, s, d] of fan) {
    note(t, s, n, d + 0.25, "saw", 0.16, d * 0.9);
    note(t, s, n - 12, d + 0.25, "tri", 0.2, d * 0.9);
    note(t, s, n + 7, d + 0.2, "tri", 0.1, d * 0.8);
  }
  addNoise(t, { start: 1.14, dur: 0.5, type: "hp", f0: 5000, gain: 0.16, tau: 0.15 });
  writeWav("victory", t.lowpass(8000).echo(0.14, 0.4, 0.4).fadeEdges(0.002, 0.25).normalize(0.85));

  t = sfx(1.6);
  addNoise(t, { dur: 1.6, f0: 650, f1: 1500, q: 0.45, gain: 1, tau: 0.8, attack: 0.35 });
  addNoise(t, { dur: 1.6, f0: 1900, q: 0.4, gain: 0.5, tau: 0.7, attack: 0.3 });
  writeWav("crowd", t.fadeEdges(0.2, 0.5).normalize(0.55));

  t = sfx(0.04);
  addTone(t, { dur: 0.04, f0: 1400, gain: 0.5, tau: 0.015 });
  writeWav("ui-move", t.fadeEdges().normalize(0.5));
  t = sfx(0.2);
  note(t, 0, 79, 0.1, "tri", 0.4, 0.05);
  note(t, 0.06, 86, 0.14, "tri", 0.4, 0.07);
  writeWav("ui-select", t.fadeEdges().normalize(0.6));
  t = sfx(0.2);
  note(t, 0, 79, 0.1, "tri", 0.4, 0.05);
  note(t, 0.06, 72, 0.14, "tri", 0.4, 0.07);
  writeWav("ui-back", t.fadeEdges().normalize(0.55));
  t = sfx(0.45);
  for (const [i, n] of [72, 76, 79].entries()) note(t, i * 0.07, n, 0.3, "tri", 0.4, 0.12);
  note(t, 0.21, 84, 0.2, "sine", 0.3, 0.1);
  writeWav("ready", t.echo(0.06, 0.3, 0.25).fadeEdges().normalize(0.7));
  t = sfx(0.4);
  note(t, 0, 76, 0.2, "tri", 0.4, 0.09);
  note(t, 0.12, 83, 0.28, "tri", 0.4, 0.12);
  writeWav("join", t.echo(0.07, 0.3, 0.25).fadeEdges().normalize(0.65));
};

/* ----------------------------------------------------------------- music */

const MUSIC_RATE = 22050;

const drums = (tr, beat, i, { kickEvery = 1, snare = true, hats = true, hatGain = 0.12, big = false }) => {
  const t = i * beat;
  if (i % kickEvery === 0) {
    const osc = phaseOsc(tr.rate);
    tr.add(t, 0.22, (x) => Math.sin(osc(lerp(150, 46, clamp01(x / 0.09)))) * expDecay(x, 0.09) * 0.9, big ? 1 : 0.8);
  }
  if (snare && i % 2 === 1) {
    const f = makeBiquad("bp", 1800, 0.8, tr.rate);
    tr.add(t, 0.2, (x) => (f(tr.rng() * 2 - 1) * 0.9 + Math.sin(TAU * 190 * x) * 0.3) * expDecay(x, 0.07), 0.55);
  }
  if (hats) {
    for (let k = 0; k < 2; k += 1) {
      const f = makeBiquad("hp", 7000, 0.7, tr.rate);
      tr.add(t + k * beat * 0.5, 0.06, (x) => f(tr.rng() * 2 - 1) * expDecay(x, 0.018), hatGain * (k === 1 ? 0.8 : 1));
    }
  }
};

const voiceNote = (tr, start, n, dur, shape, gain, tau, cutoff) => {
  const osc = phaseOsc(tr.rate);
  const f = midi(n);
  let y = 0;
  const a = 1 - Math.exp((-TAU * cutoff) / tr.rate);
  tr.add(start, dur, (t) => {
    const raw = wave[shape](osc(f)) * adsr(t, dur, 0.006, 0.05) * expDecay(t, tau);
    y += a * (raw - y);
    return y;
  }, gain);
};

const buildMusic = () => {
  // ---- battle: 140 BPM, A minor drive, 8 bars (2 progressions).
  {
    const bpm = 140;
    const beat = 60 / bpm;
    const bars = 8;
    const tr = new Track(bars * 4 * beat, MUSIC_RATE);
    const chords = [
      { root: 45, tones: [57, 60, 64] }, // Am
      { root: 41, tones: [53, 57, 60] }, // F
      { root: 48, tones: [60, 64, 67] }, // C
      { root: 43, tones: [55, 59, 62] }, // G
    ];
    for (let bar = 0; bar < bars; bar += 1) {
      const ch = chords[bar % 4];
      for (let b = 0; b < 4; b += 1) {
        const i = bar * 4 + b;
        drums(tr, beat, i, { snare: true, hats: true, big: bar % 4 === 0 && b === 0 });
        // Driving 8th-note bass.
        for (let k = 0; k < 2; k += 1) {
          const bn = ch.root + (k === 1 && b % 2 === 1 ? 12 : 0);
          voiceNote(tr, (i + k * 0.5) * beat, bn, beat * 0.45, "saw", 0.3, 0.22, 700);
        }
        // 16th arpeggio lead.
        for (let k = 0; k < 4; k += 1) {
          const arp = ch.tones[(k + b) % 3] + 12 + ((k + bar) % 4 === 3 ? 12 : 0);
          voiceNote(tr, (i + k * 0.25) * beat, arp, beat * 0.22, "square", 0.075, 0.12, 2600);
        }
      }
      // Pad stab on the bar.
      for (const n of ch.tones) voiceNote(tr, bar * 4 * beat, n, beat * 3.6, "tri", 0.07, 1.4, 1800);
      // Hook melody in second half.
      if (bar >= 4) {
        const hook = bar % 2 === 0 ? [81, 79, 76, 79] : [84, 81, 79, 76];
        hook.forEach((n, k) => voiceNote(tr, (bar * 4 + k) * beat, n, beat * 0.9, "tri", 0.11, 0.35, 3200));
      }
    }
    tr.echo(beat * 0.75, 0.3, 0.25).drive(0.7).fadeEdges(0.0, 0.0).normalize(0.8);
    writeWav("music-battle", tr);
  }

  // ---- menu: 104 BPM relaxed groove, C-G-Am-F, 8 bars.
  {
    const bpm = 104;
    const beat = 60 / bpm;
    const bars = 8;
    const tr = new Track(bars * 4 * beat, MUSIC_RATE);
    const chords = [
      { root: 48, tones: [60, 64, 67, 71] }, // Cmaj7
      { root: 43, tones: [59, 62, 67, 69] }, // G6
      { root: 45, tones: [57, 60, 64, 67] }, // Am7
      { root: 41, tones: [57, 60, 64, 65] }, // Fmaj7
    ];
    for (let bar = 0; bar < bars; bar += 1) {
      const ch = chords[bar % 4];
      for (let b = 0; b < 4; b += 1) {
        const i = bar * 4 + b;
        drums(tr, beat, i, { kickEvery: 2, snare: b === 1 || b === 3, hats: true, hatGain: 0.07 });
        voiceNote(tr, i * beat, ch.root, beat * 0.9, "tri", 0.34, 0.5, 600);
        const pluck = ch.tones[(b * 2 + bar) % 4] + 12;
        voiceNote(tr, (i + 0.5) * beat, pluck, beat * 0.5, "tri", 0.12, 0.2, 2800);
      }
      for (const n of ch.tones) voiceNote(tr, bar * 4 * beat, n, beat * 3.9, "sine", 0.07, 2.4, 1500);
      if (bar % 2 === 1) {
        const mel = [79, 83, 81, 76];
        mel.forEach((n, k) => voiceNote(tr, (bar * 4 + k) * beat + beat * 0.25, n, beat * 0.9, "sine", 0.12, 0.45, 3600));
      }
    }
    tr.echo(beat * 0.75, 0.35, 0.3).fadeEdges(0.0, 0.0).normalize(0.7);
    writeWav("music-menu", tr);
  }
};

console.log("Generating Air Brawl audio…");
buildSfx();
buildMusic();
console.log("Done.");
