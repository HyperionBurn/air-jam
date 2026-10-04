import { InputEncoder, type WireInput } from "../../game/net/input-codec";

/** Minimum gap between event-driven packets (ms). Button edges always send immediately. */
const STICK_MIN_GAP_MS = 8;
/** Resend interval while something is held / the stick is active. */
const ACTIVE_HEARTBEAT_MS = 80;
/** Resend interval while fully neutral (keeps the host's stale watchdog fed). */
const IDLE_HEARTBEAT_MS = 250;

export interface PipeStats {
  packetsSent: number;
  sendRate: number;
  touchEvents: number;
  touchRate: number;
  lastSendAgeMs: number;
}

type Scheduler = {
  now: () => number;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
};

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

/**
 * Controller input pipeline: touch handlers mutate an `InputEncoder`; this class
 * decides *when* to put packets on the wire.
 *
 *  - button edges flush synchronously inside the event handler (zero added latency)
 *  - stick movement flushes immediately unless it just sent, then on the next frame
 *  - a slow heartbeat keeps the host's stale-input watchdog fed
 *  - `releaseAll` (blur, cancel, disconnect, phase change) clears every held input
 *    and sends one neutral packet right away so nothing can get stuck host-side
 */
export class InputPipe {
  readonly encoder = new InputEncoder();
  private enabled = false;
  private lastSentAt = -Infinity;
  private frameId: number | null = null;
  private timerId: number | null = null;
  private packetsSent = 0;
  private touchEvents = 0;
  private windowStart = 0;
  private windowSent = 0;
  private windowTouch = 0;
  private sendRate = 0;
  private touchRate = 0;

  constructor(
    private readonly send: (wire: WireInput) => boolean,
    private readonly scheduler: Scheduler = browserScheduler,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Start/stop sending. Disabling clears all held input. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (!enabled) {
      this.encoder.releaseAll();
      this.flush();
      this.enabled = false;
      this.stopTimers();
      return;
    }
    this.enabled = true;
    this.flush();
    this.timerId = window.setInterval(() => this.heartbeat(), 40);
  }

  private stopTimers(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.frameId !== null) {
      this.scheduler.cancelFrame(this.frameId);
      this.frameId = null;
    }
  }

  /** Call from every pointer event, for diagnostics. */
  noteTouchEvent(): void {
    this.touchEvents += 1;
    this.windowTouch += 1;
  }

  setStick(x: number, y: number): void {
    if (this.encoder.setStick(x, y)) this.markChanged(false);
  }

  press(bit: number): void {
    if (this.encoder.press(bit)) this.markChanged(true);
  }

  release(bit: number): void {
    if (this.encoder.release(bit)) this.markChanged(true);
  }

  /** Right-stick smash flick (gamepads): attack press + direction in one immediate packet. */
  smash(dir: number): void {
    if (this.encoder.smash(dir)) this.markChanged(true);
  }

  releaseAll(): void {
    if (this.encoder.releaseAll()) this.markChanged(true);
  }

  setEcho(id: number): void {
    this.encoder.setEcho(id);
    this.markChanged(true);
  }

  private markChanged(immediate: boolean): void {
    if (!this.enabled) return;
    const now = this.scheduler.now();
    if (immediate || now - this.lastSentAt >= STICK_MIN_GAP_MS) {
      this.flush();
      return;
    }
    if (this.frameId === null) {
      this.frameId = this.scheduler.requestFrame(() => {
        this.frameId = null;
        this.flush();
      });
    }
  }

  private heartbeat(): void {
    const now = this.scheduler.now();
    const interval = this.encoder.isNeutral ? IDLE_HEARTBEAT_MS : ACTIVE_HEARTBEAT_MS;
    if (now - this.lastSentAt >= interval) this.flush();
    if (now - this.windowStart >= 1000) {
      const span = Math.max(1, now - this.windowStart);
      this.sendRate = Math.round((this.windowSent * 1000) / span);
      this.touchRate = Math.round((this.windowTouch * 1000) / span);
      this.windowStart = now;
      this.windowSent = 0;
      this.windowTouch = 0;
    }
  }

  /** Put the current state on the wire now. */
  flush(): void {
    const now = this.scheduler.now();
    const ok = this.send(this.encoder.snapshot(now));
    if (ok) {
      this.lastSentAt = now;
      this.packetsSent += 1;
      this.windowSent += 1;
    }
  }

  get stats(): PipeStats {
    return {
      packetsSent: this.packetsSent,
      sendRate: this.sendRate,
      touchEvents: this.touchEvents,
      touchRate: this.touchRate,
      lastSendAgeMs: Math.round(this.scheduler.now() - this.lastSentAt),
    };
  }

  destroy(): void {
    this.encoder.releaseAll();
    this.stopTimers();
    this.enabled = false;
  }
}
