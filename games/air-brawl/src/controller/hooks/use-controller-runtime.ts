import { useAirJamController, useInputWriter } from "@air-jam/sdk";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMatchStore } from "../../game/session/store";
import { InputPipe } from "../runtime/input-pipe";

/** Phone-local preferences, persisted per device. */
export interface PhonePrefs {
  haptics: boolean;
  mirrored: boolean;
  hints: boolean;
}

const KEY = "air-brawl:phone-prefs:v1";
const defaults: PhonePrefs = { haptics: true, mirrored: false, hints: true };
let prefs: PhonePrefs | null = null;
const listeners = new Set<() => void>();

const readPrefs = (): PhonePrefs => {
  if (prefs) return prefs;
  try {
    const raw = window.localStorage.getItem(KEY);
    prefs = raw ? { ...defaults, ...(JSON.parse(raw) as Partial<PhonePrefs>) } : { ...defaults };
  } catch {
    prefs = { ...defaults };
  }
  return prefs;
};

export const phonePrefs = {
  get: readPrefs,
  set(patch: Partial<PhonePrefs>) {
    prefs = { ...readPrefs(), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable; keep in memory
    }
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const usePhonePrefs = (): PhonePrefs => useSyncExternalStore(phonePrefs.subscribe, phonePrefs.get);

/** Reactive portrait/landscape flag (CSS handles layout; this drives hints only). */
export const usePortrait = (): boolean => {
  const [portrait, setPortrait] = useState(() => window.matchMedia("(orientation: portrait)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const on = () => setPortrait(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return portrait;
};

/**
 * Wires the input pipeline to the Air Jam session and installs every stuck-input
 * guard: blur, visibility, page hide, touch cancel, disconnect and phase changes
 * all clear held input and push a neutral packet immediately.
 */
export const useControllerRuntime = () => {
  const writeInput = useInputWriter();
  const connection = useAirJamController((s) => s.connectionStatus);
  const stateMessage = useAirJamController((s) => s.stateMessage);
  const phase = useMatchStore((s) => s.matchPhase);
  const pipe = useMemo(() => new InputPipe((wire) => writeInput(wire)), [writeInput]);
  const pipeRef = useRef(pipe);
  pipeRef.current = pipe;

  const connected = connection === "connected";
  const inMatch = phase === "countdown" || phase === "playing";
  const active = connected && inMatch;

  useEffect(() => {
    pipe.setEnabled(active);
  }, [pipe, active]);

  useEffect(() => () => pipe.destroy(), [pipe]);

  // Stuck-input guards.
  useEffect(() => {
    const clear = () => pipeRef.current.releaseAll();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") clear();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) clear();
    };
    window.addEventListener("blur", clear);
    window.addEventListener("pagehide", clear);
    window.addEventListener("touchcancel", clear);
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    // iOS pinch / double-tap zoom must never fire during play.
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", block);
    document.addEventListener("gesturechange", block);
    return () => {
      window.removeEventListener("blur", clear);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("touchcancel", clear);
      window.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
    };
  }, []);

  // Latency probe echo: the host sends `probe:<id>`; we reflect the id in the input stream.
  useEffect(() => {
    if (!stateMessage || !stateMessage.startsWith("probe:")) return;
    const id = Number(stateMessage.slice(6));
    if (Number.isFinite(id)) pipeRef.current.setEcho(id);
  }, [stateMessage]);

  return { pipe, connected, active, connection };
};
