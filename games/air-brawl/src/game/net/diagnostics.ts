/** Rolling min/avg/max over a fixed window, allocation-free after construction. */
export class RollingStat {
  private readonly values: Float32Array;
  private index = 0;
  private count = 0;

  constructor(size = 120) {
    this.values = new Float32Array(size);
  }

  push(value: number): void {
    this.values[this.index] = value;
    this.index = (this.index + 1) % this.values.length;
    this.count = Math.min(this.values.length, this.count + 1);
  }

  get avg(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i += 1) sum += this.values[i];
    return sum / this.count;
  }

  get max(): number {
    let m = 0;
    for (let i = 0; i < this.count; i += 1) m = Math.max(m, this.values[i]);
    return m;
  }

  /** 99th-percentile-ish: the second largest of the window. */
  get p99(): number {
    if (this.count === 0) return 0;
    const copy = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    return copy[Math.max(0, Math.floor(copy.length * 0.99) - 1)] ?? copy[copy.length - 1];
  }
}

export interface ControllerDiag {
  id: string;
  name: string;
  packetRate: number;
  inputAgeMs: number;
  jitterMs: number;
  rttMs: number;
  stale: boolean;
}

export interface HostDiagnostics {
  fps: number;
  tickMs: RollingStat;
  renderMs: RollingStat;
  frameMs: RollingStat;
  droppedFrames: number;
  stepsPerFrame: number;
  simFrame: number;
  controllers: ControllerDiag[];
  /** Total input packets applied per second across controllers. */
  packetsPerSec: number;
  /** Adaptive render quality (0 = full, 4 = lowest). */
  quality: number;
}

export const createDiagnostics = (): HostDiagnostics => ({
  fps: 0,
  tickMs: new RollingStat(180),
  renderMs: new RollingStat(180),
  frameMs: new RollingStat(180),
  droppedFrames: 0,
  stepsPerFrame: 0,
  simFrame: 0,
  controllers: [],
  packetsPerSec: 0,
  quality: 0,
});
