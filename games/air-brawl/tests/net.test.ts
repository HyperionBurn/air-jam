import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputPipe } from "../src/controller/runtime/input-pipe";
import { gameInputSchema, InputDecoder, InputEncoder, NEUTRAL_WIRE, type WireInput } from "../src/game/net/input-codec";
import { BTN } from "../src/game/sim";

const wire = (encoder: InputEncoder, now = 0): WireInput => gameInputSchema.parse(encoder.snapshot(now));

describe("input codec", () => {
  it("validates against the wire schema", () => {
    const e = new InputEncoder();
    e.setStick(0.5, -0.25);
    e.press(BTN.ATTACK);
    expect(() => gameInputSchema.parse(e.snapshot(10))).not.toThrow();
    expect(gameInputSchema.safeParse({ ...NEUTRAL_WIRE, mx: 500 }).success).toBe(false);
  });

  it("rounds the stick to percent and clamps", () => {
    const e = new InputEncoder();
    expect(e.setStick(2, -2)).toBe(true);
    const w = wire(e);
    expect(w.mx).toBe(100);
    expect(w.my).toBe(-100);
    expect(e.setStick(2, -2)).toBe(false);
  });

  it("derives a tap from the press counter even if press and release land between reads", () => {
    const e = new InputEncoder();
    const d = new InputDecoder();
    const first = d.read(wire(e), 0);
    expect(first.taps).toBe(0);
    // Press + release entirely between two host ticks.
    e.press(BTN.ATTACK);
    e.release(BTN.ATTACK);
    const f = d.read(wire(e), 16);
    expect(f.taps & BTN.ATTACK).toBe(BTN.ATTACK);
    expect(f.held & BTN.ATTACK).toBe(0);
    // The edge is consumed: same packet again must not retrigger.
    expect(d.read(wire(e), 32).taps).toBe(0);
  });

  it("handles press counter wrap-around", () => {
    const e = new InputEncoder();
    const d = new InputDecoder();
    for (let i = 0; i < 255; i += 1) {
      e.press(BTN.JUMP);
      e.release(BTN.JUMP);
    }
    d.read(wire(e), 0);
    e.press(BTN.JUMP);
    e.release(BTN.JUMP);
    e.press(BTN.JUMP);
    const f = d.read(wire(e, 5), 16);
    expect(f.taps & BTN.JUMP).toBe(BTN.JUMP);
  });

  it("clears held input when the controller goes silent (stuck-input protection)", () => {
    const e = new InputEncoder();
    const d = new InputDecoder();
    e.setStick(1, 0);
    e.press(BTN.SHIELD);
    const packet = wire(e, 0);
    const live = d.read(packet, 0);
    expect(live.mx).toBe(1);
    expect(live.held & BTN.SHIELD).toBe(BTN.SHIELD);
    // No new packets for > 700 ms: the host keeps re-reading the same (last) packet.
    const stale = d.read(packet, 1500);
    expect(d.stale).toBe(true);
    expect(stale.mx).toBe(0);
    expect(stale.held).toBe(0);
  });

  it("returns neutral for a controller that has never sent anything", () => {
    const d = new InputDecoder();
    const f = d.read(undefined, 100);
    expect(f).toEqual({ mx: 0, my: 0, held: 0, taps: 0 });
    expect(d.stale).toBe(true);
  });

  it("measures RTT from probe echoes", () => {
    const e = new InputEncoder();
    const d = new InputDecoder();
    d.noteProbe(7, 1000);
    e.setEcho(7);
    d.read(wire(e, 1030), 1060);
    expect(d.rttMs).toBe(60);
  });

  it("a rejoin does not fire a phantom press", () => {
    const e = new InputEncoder();
    const d = new InputDecoder();
    e.press(BTN.ATTACK);
    e.release(BTN.ATTACK);
    d.read(wire(e), 0);
    d.reset();
    const f = d.read(wire(e, 1), 16);
    expect(f.taps).toBe(0);
  });

  it("releaseAll drops stick and buttons but keeps counters", () => {
    const e = new InputEncoder();
    e.setStick(1, 1);
    e.press(BTN.ATTACK);
    const before = wire(e).ta;
    expect(e.releaseAll()).toBe(true);
    const w = wire(e);
    expect(w.held).toBe(0);
    expect(w.mx).toBe(0);
    expect(w.ta).toBe(before);
    expect(e.isNeutral).toBe(true);
  });
});

describe("InputPipe", () => {
  let clock = 0;
  let frames: (() => void)[] = [];
  const sent: WireInput[] = [];
  const scheduler = {
    now: () => clock,
    requestFrame: (cb: () => void) => frames.push(cb),
    cancelFrame: () => undefined,
  };
  let timers: { fn: () => void; ms: number }[] = [];

  beforeEach(() => {
    clock = 0;
    frames = [];
    sent.length = 0;
    timers = [];
    vi.stubGlobal("window", {
      setInterval: (fn: () => void, ms: number) => timers.push({ fn, ms }),
      clearInterval: () => {
        timers = [];
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const make = () => new InputPipe((w) => (sent.push(w), true), scheduler);

  it("sends nothing until enabled, then an initial neutral packet", () => {
    const pipe = make();
    pipe.press(BTN.ATTACK);
    expect(sent).toHaveLength(0);
    pipe.setEnabled(true);
    expect(sent).toHaveLength(1);
  });

  it("flushes button edges synchronously with no added latency", () => {
    const pipe = make();
    pipe.setEnabled(true);
    sent.length = 0;
    pipe.press(BTN.ATTACK);
    expect(sent).toHaveLength(1);
    expect(sent[0].held & BTN.ATTACK).toBe(BTN.ATTACK);
    pipe.release(BTN.ATTACK);
    expect(sent).toHaveLength(2);
    expect(sent[1].held).toBe(0);
  });

  it("coalesces rapid stick moves to the next frame", () => {
    const pipe = make();
    pipe.setEnabled(true);
    sent.length = 0;
    clock = 100;
    pipe.setStick(0.5, 0); // first move after a gap: immediate
    expect(sent).toHaveLength(1);
    clock = 102;
    pipe.setStick(0.7, 0); // within the min gap: deferred
    pipe.setStick(0.9, 0);
    expect(sent).toHaveLength(1);
    expect(frames).toHaveLength(1);
    clock = 110;
    frames[0]();
    expect(sent).toHaveLength(2);
    expect(sent[1].mx).toBe(90);
  });

  it("heartbeats keep the host watchdog fed (active vs idle cadence)", () => {
    const pipe = make();
    pipe.setEnabled(true);
    sent.length = 0;
    const tick = timers[0].fn;
    clock = 100;
    tick();
    expect(sent).toHaveLength(0); // idle: 250 ms
    clock = 260;
    tick();
    expect(sent).toHaveLength(1);
    pipe.setStick(1, 0);
    sent.length = 0;
    clock = 360;
    tick();
    expect(sent).toHaveLength(1); // active: 80 ms
  });

  it("disabling releases everything and sends one neutral packet", () => {
    const pipe = make();
    pipe.setEnabled(true);
    pipe.setStick(1, 1);
    pipe.press(BTN.SHIELD);
    sent.length = 0;
    pipe.setEnabled(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].held).toBe(0);
    expect(sent[0].mx).toBe(0);
    expect(pipe.isEnabled).toBe(false);
  });

  it("releaseAll (blur / lost touch) clears held input immediately", () => {
    const pipe = make();
    pipe.setEnabled(true);
    pipe.press(BTN.JUMP);
    pipe.setStick(-1, 0);
    sent.length = 0;
    pipe.releaseAll();
    expect(sent).toHaveLength(1);
    expect(sent[0].held).toBe(0);
    expect(sent[0].mx).toBe(0);
  });

  it("does not count failed sends as delivered", () => {
    const pipe = new InputPipe(() => false, scheduler);
    pipe.setEnabled(true);
    pipe.press(BTN.ATTACK);
    expect(pipe.stats.packetsSent).toBe(0);
  });
});
