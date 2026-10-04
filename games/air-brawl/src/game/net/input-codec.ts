import { z } from "zod";
import { BTN, type InputFrame } from "../sim/types";

/**
 * Wire format for controller → host input.
 *
 *  - `mx`/`my`   stick in whole percent (-100..100) to keep payloads tiny
 *  - `held`      bitmask of buttons currently down
 *  - `tj/ta/ts/th` per-button press counters (0..255, wrapping). The host derives
 *                tap edges from counter deltas, so a press+release that both land
 *                between two host reads — Wi-Fi jitter, batched packets — is never lost.
 *  - `seq`       monotonically increasing packet number (rate / age diagnostics)
 *  - `ct`        controller clock when sent (relative one-way jitter estimate)
 *  - `echo`      last latency probe id seen (host measures real RTT from it)
 */
export const gameInputSchema = z.object({
  mx: z.number().min(-100).max(100),
  my: z.number().min(-100).max(100),
  held: z.number().int().min(0).max(15),
  tj: z.number().int().min(0).max(255),
  ta: z.number().int().min(0).max(255),
  ts: z.number().int().min(0).max(255),
  th: z.number().int().min(0).max(255),
  seq: z.number().int().min(0),
  ct: z.number(),
  echo: z.number().int().optional(),
  /** Right-stick smash flick counter (wraps) and the direction of the latest flick (1 R, 2 L, 3 U, 4 D). */
  tc: z.number().int().min(0).max(255).optional(),
  cd: z.number().int().min(0).max(4).optional(),
});

export type WireInput = z.infer<typeof gameInputSchema>;

export const BUTTON_KEYS = {
  [BTN.JUMP]: "tj",
  [BTN.ATTACK]: "ta",
  [BTN.SPECIAL]: "ts",
  [BTN.SHIELD]: "th",
} as const;

const BUTTON_LIST: { bit: number; key: "tj" | "ta" | "ts" | "th" }[] = [
  { bit: BTN.JUMP, key: "tj" },
  { bit: BTN.ATTACK, key: "ta" },
  { bit: BTN.SPECIAL, key: "ts" },
  { bit: BTN.SHIELD, key: "th" },
];

export const NEUTRAL_WIRE: WireInput = {
  mx: 0,
  my: 0,
  held: 0,
  tj: 0,
  ta: 0,
  ts: 0,
  th: 0,
  seq: 0,
  ct: 0,
};

/** Controller-side input state machine. Pure and unit-tested. */
export class InputEncoder {
  private mx = 0;
  private my = 0;
  private held = 0;
  private counters = { tj: 0, ta: 0, ts: 0, th: 0 };
  private flicks = 0;
  private flickDir = 0;
  private seq = 0;
  private echo: number | undefined;

  setStick(x: number, y: number): boolean {
    const nx = Math.round(Math.max(-1, Math.min(1, x)) * 100);
    const ny = Math.round(Math.max(-1, Math.min(1, y)) * 100);
    if (nx === this.mx && ny === this.my) return false;
    this.mx = nx;
    this.my = ny;
    return true;
  }

  press(bit: number): boolean {
    if (this.held & bit) return false;
    this.held |= bit;
    for (const b of BUTTON_LIST) {
      if (b.bit === bit) this.counters[b.key] = (this.counters[b.key] + 1) & 255;
    }
    return true;
  }

  release(bit: number): boolean {
    if (!(this.held & bit)) return false;
    this.held &= ~bit;
    return true;
  }

  /**
   * Right-stick smash: an attack press that carries a direction, in one atomic change, so the host
   * can never see the press without the flick (or the flick without the press).
   */
  smash(dir: number): boolean {
    if (dir < 1 || dir > 4) return false;
    this.held |= BTN.ATTACK;
    this.counters.ta = (this.counters.ta + 1) & 255;
    this.flicks = (this.flicks + 1) & 255;
    this.flickDir = dir;
    return true;
  }

  /** Drop every held input (lost touches, blur, disconnect). Press counters are kept. */
  releaseAll(): boolean {
    const changed = this.held !== 0 || this.mx !== 0 || this.my !== 0;
    this.held = 0;
    this.mx = 0;
    this.my = 0;
    return changed;
  }

  get isNeutral(): boolean {
    return this.held === 0 && this.mx === 0 && this.my === 0;
  }

  setEcho(id: number): void {
    this.echo = id;
  }

  snapshot(now: number): WireInput {
    this.seq += 1;
    const out: WireInput = {
      mx: this.mx,
      my: this.my,
      held: this.held,
      tj: this.counters.tj,
      ta: this.counters.ta,
      ts: this.counters.ts,
      th: this.counters.th,
      seq: this.seq,
      ct: Math.round(now),
      tc: this.flicks,
      cd: this.flickDir,
    };
    if (this.echo !== undefined) out.echo = this.echo;
    return out;
  }
}

/** Host-side per-controller decoder: wire input → sim `InputFrame` with tap edges. */
export class InputDecoder {
  private last: WireInput | null = null;
  private lastSeq = -1;
  private seqAt = 0;
  private frame: InputFrame = { mx: 0, my: 0, held: 0, taps: 0 };
  /** Diagnostics. */
  packets = 0;
  stale = false;
  private windowStart = 0;
  private windowPackets = 0;
  packetRate = 0;
  inputAgeMs = 0;
  /** Smoothed relative one-way jitter (ms), above the running minimum delay. */
  jitterMs = 0;
  private minDelta = Infinity;
  rttMs = -1;
  private probeSentAt = new Map<number, number>();

  /** Mark a probe so a later `echo` can be turned into an RTT. */
  noteProbe(id: number, sentAt: number): void {
    this.probeSentAt.set(id, sentAt);
    if (this.probeSentAt.size > 8) {
      const first = this.probeSentAt.keys().next().value;
      if (first !== undefined) this.probeSentAt.delete(first);
    }
  }

  /**
   * Decode this tick. `raw` is the latest validated wire input (or undefined if
   * none has arrived). Returns a reused frame object; callers must not retain it.
   */
  read(raw: WireInput | undefined, now: number, staleAfterMs = 700): InputFrame {
    const f = this.frame;
    if (!raw) {
      f.mx = 0;
      f.my = 0;
      f.held = 0;
      f.taps = 0;
      f.flick = 0;
      this.stale = true;
      return f;
    }
    if (raw.seq !== this.lastSeq) {
      this.lastSeq = raw.seq;
      this.seqAt = now;
      this.packets += 1;
      this.windowPackets += 1;
      // Relative one-way delay: (host arrival - controller send), minus its running minimum.
      const delta = now - raw.ct;
      this.minDelta = Math.min(this.minDelta, delta);
      this.jitterMs += (Math.max(0, delta - this.minDelta) - this.jitterMs) * 0.1;
      if (raw.echo !== undefined) {
        const sent = this.probeSentAt.get(raw.echo);
        if (sent !== undefined) {
          this.rttMs = now - sent;
          this.probeSentAt.delete(raw.echo);
        }
      }
    }
    if (now - this.windowStart >= 1000) {
      this.packetRate = Math.round((this.windowPackets * 1000) / Math.max(1, now - this.windowStart));
      this.windowPackets = 0;
      this.windowStart = now;
    }
    this.inputAgeMs = now - this.seqAt;
    this.stale = this.inputAgeMs > staleAfterMs;

    let taps = 0;
    if (this.last) {
      for (const b of BUTTON_LIST) {
        const delta = (raw[b.key] - this.last[b.key] + 256) & 255;
        if (delta > 0 && delta < 128) taps |= b.bit;
      }
    }
    let flick = 0;
    if (this.last && raw.tc !== undefined && this.last.tc !== undefined) {
      const delta = (raw.tc - this.last.tc + 256) & 255;
      if (delta > 0 && delta < 128) flick = raw.cd ?? 0;
    }
    this.last = raw;

    if (this.stale) {
      // A silent controller must never leave a fighter running or shielding forever.
      f.mx = 0;
      f.my = 0;
      f.held = 0;
      f.taps = 0;
      f.flick = 0;
      return f;
    }
    f.mx = raw.mx / 100;
    f.my = raw.my / 100;
    f.held = raw.held & 15;
    f.taps = taps;
    f.flick = flick;
    return f;
  }

  /** Forget history (controller left / rejoined) so no phantom press fires. */
  reset(): void {
    this.last = null;
    this.lastSeq = -1;
    this.frame.mx = 0;
    this.frame.my = 0;
    this.frame.held = 0;
    this.frame.taps = 0;
    this.frame.flick = 0;
  }
}
