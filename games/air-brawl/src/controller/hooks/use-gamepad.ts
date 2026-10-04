import { useEffect, useRef, useState } from "react";
import { GamepadMapper, PAD_LABELS, PadDriver, padKindOf, snapshotOf, type MenuEdges, type PadKind, type PadLabels, type PadReading } from "../../game/net/gamepad";
import type { InputPipe } from "../runtime/input-pipe";

export interface PadStatus {
  index: number;
  kind: PadKind;
  labels: PadLabels;
}

const FOCUSABLE = 'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), [role="radio"]:not(:disabled), a[href]';

const visible = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(el).visibility !== "hidden";
};

/** Spatial focus movement for pad-driven menus: nearest focusable element in the pressed direction. */
export const moveFocus = (dir: "up" | "down" | "left" | "right"): void => {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
  if (all.length === 0) return;
  const current = document.activeElement instanceof HTMLElement && all.includes(document.activeElement) ? document.activeElement : null;
  if (!current) {
    (document.querySelector<HTMLElement>("[data-pad-ready]") ?? all[0]).focus();
    return;
  }
  const c = current.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const along = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    const across = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    if (along < 4) continue;
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
};

const applyMenu = (e: MenuEdges): void => {
  if (e.up) moveFocus("up");
  else if (e.down) moveFocus("down");
  else if (e.left) moveFocus("left");
  else if (e.right) moveFocus("right");
  if (e.confirm) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.matches(FOCUSABLE)) active.click();
    else moveFocus("down");
  }
  if (e.start) document.querySelector<HTMLElement>("[data-pad-ready]")?.click();
  if (e.back) document.querySelector<HTMLElement>("[data-pad-back]")?.click();
};

/** Route the SDK's `navigator.vibrate` haptics to the pad's rumble motors while a pad is in use. */
const installRumble = (getPad: () => Gamepad | null): (() => void) => {
  const nav = navigator as Navigator & { vibrate?: (p: VibratePattern) => boolean };
  const original = nav.vibrate?.bind(navigator);
  const shim = (pattern: VibratePattern): boolean => {
    const pad = getPad();
    const actuator = pad ? (pad as unknown as { vibrationActuator?: { playEffect?: (t: string, p: Record<string, number>) => Promise<unknown> } }).vibrationActuator : undefined;
    if (actuator?.playEffect) {
      const total = Array.isArray(pattern) ? pattern.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) : pattern;
      const strong = Math.min(1, 0.2 + total / 150);
      void actuator.playEffect("dual-rumble", { startDelay: 0, duration: Math.max(20, Math.min(400, total)), weakMagnitude: Math.min(1, strong * 0.7), strongMagnitude: strong })?.catch?.(() => undefined);
    }
    return original ? original(pattern) : true;
  };
  try {
    Object.defineProperty(navigator, "vibrate", { value: shim, configurable: true, writable: true });
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      if (original) Object.defineProperty(navigator, "vibrate", { value: original, configurable: true, writable: true });
      else delete (navigator as unknown as { vibrate?: unknown }).vibrate;
    } catch {
      // nothing to restore
    }
  };
};

/**
 * Gamepad input for the controller page (a pad plugged into / paired with the device that opened
 * `/controller`). In a match it feeds the same `InputPipe` as the touch controls (they keep working
 * side by side); in menus the D-pad / stick moves focus, A presses, Start readies up.
 */
export const useGamepadController = (pipe: InputPipe, inMatch: boolean): PadStatus | null => {
  const [status, setStatus] = useState<PadStatus | null>(null);
  const inMatchRef = useRef(inMatch);
  inMatchRef.current = inMatch;
  const activeRef = useRef<Gamepad | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    const mappers = new Map<number, GamepadMapper>();
    const drivers = new Map<number, PadDriver>();
    let active = -1;
    let raf = 0;
    let lastKey = "";

    const mapperOf = (i: number): GamepadMapper => {
      let m = mappers.get(i);
      if (!m) {
        m = new GamepadMapper();
        mappers.set(i, m);
      }
      return m;
    };
    const driverOf = (i: number): PadDriver => {
      let d = drivers.get(i);
      if (!d) {
        d = new PadDriver(pipe);
        drivers.set(i, d);
      }
      return d;
    };

    const tick = (now: number): void => {
      const pads = Array.from(navigator.getGamepads()).filter((g): g is Gamepad => !!g && g.connected);
      // Read every pad exactly once per frame (the mapper keeps hysteresis / edge state).
      const readings = new Map<number, PadReading>();
      let live: Gamepad | null = null;
      for (const g of pads) {
        const reading = mapperOf(g.index).read(snapshotOf(g));
        readings.set(g.index, reading);
        const isLive = reading.held !== 0 || reading.mx !== 0 || reading.my !== 0 || reading.cstick !== 0;
        if (isLive && (live === null || g.index === active)) live = g;
      }
      if (live) active = live.index;
      const pad = pads.find((g) => g.index === active) ?? pads[0] ?? null;
      activeRef.current = pad;
      const key = pad ? `${pad.index}:${pad.id}` : "";
      if (key !== lastKey) {
        lastKey = key;
        if (pad) {
          const kind = padKindOf(pad.id);
          setStatus({ index: pad.index, kind, labels: PAD_LABELS[kind] });
          document.documentElement.setAttribute("data-pad-nav", "1");
        } else {
          setStatus(null);
          document.documentElement.removeAttribute("data-pad-nav");
        }
      }
      for (const [i, d] of drivers) if (!pad || i !== pad.index) d.release();
      if (pad) {
        const reading = readings.get(pad.index);
        const edges = mapperOf(pad.index).menu(snapshotOf(pad), now);
        if (inMatchRef.current && reading) {
          driverOf(pad.index).apply(reading, false);
        } else {
          driverOf(pad.index).release();
          applyMenu(edges);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onDisconnect = (): void => {
      for (const d of drivers.values()) d.release();
    };
    window.addEventListener("gamepaddisconnected", onDisconnect);
    window.addEventListener("blur", onDisconnect);
    const uninstall = installRumble(() => activeRef.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
      window.removeEventListener("blur", onDisconnect);
      for (const d of drivers.values()) d.release();
      uninstall();
      document.documentElement.removeAttribute("data-pad-nav");
    };
  }, [pipe]);

  return status;
};
