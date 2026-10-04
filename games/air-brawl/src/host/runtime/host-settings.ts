import { useSyncExternalStore } from "react";
import { DEFAULT_VIEW_SETTINGS, type ViewSettings } from "../../game/view3d/game-view3d";

/** Host-local display preferences (not replicated; persisted in this browser). */
export interface HostSettings extends ViewSettings {
  haptics: boolean;
  tags: boolean;
  attract: boolean;
}

const KEY = "air-brawl:host-settings:v1";

const defaults = (): HostSettings => ({
  ...DEFAULT_VIEW_SETTINGS,
  haptics: true,
  tags: true,
  attract: true,
  debug: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1",
});

const load = (): HostSettings => {
  const base = defaults();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HostSettings>;
      return { ...base, ...parsed, debug: base.debug || false };
    }
  } catch {
    // Storage may be unavailable (private mode); fall back to defaults.
  }
  return base;
};

let current: HostSettings | null = null;
const listeners = new Set<() => void>();

const get = (): HostSettings => {
  if (!current) current = load();
  return current;
};

export const hostSettings = {
  get,
  set(patch: Partial<HostSettings>): void {
    current = { ...get(), ...patch };
    try {
      const { debug: _debug, ...persist } = current;
      void _debug;
      window.localStorage.setItem(KEY, JSON.stringify(persist));
    } catch {
      // ignore
    }
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useHostSettings = (): HostSettings => useSyncExternalStore(hostSettings.subscribe, hostSettings.get);
