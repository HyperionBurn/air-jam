import { useSyncExternalStore } from "react";
import { GamepadMapper, PAD_LABELS, PadDriver, padKindOf, snapshotOf, type MenuEdges, type PadKind } from "../../game/net/gamepad";
import { InputEncoder, type WireInput } from "../../game/net/input-codec";

/** Player ids for pads plugged into the host machine ("pad:<browser gamepad index>"). */
export const PAD_PREFIX = "pad:";
export const isPadId = (id: string): boolean => id.startsWith(PAD_PREFIX);

export interface LocalPadInfo {
  id: string;
  index: number;
  name: string;
  kind: PadKind;
  connected: boolean;
  joined: boolean;
}

interface Slot {
  index: number;
  info: LocalPadInfo;
  mapper: GamepadMapper;
  encoder: InputEncoder;
  driver: PadDriver;
  gamepad: Gamepad | null;
  lastRumble: number;
}

const RUMBLE: Record<string, { ms: number; weak: number; strong: number }> = {
  light: { ms: 40, weak: 0.25, strong: 0.1 },
  medium: { ms: 90, weak: 0.45, strong: 0.3 },
  heavy: { ms: 170, weak: 0.7, strong: 0.95 },
  success: { ms: 110, weak: 0.5, strong: 0.2 },
  failure: { ms: 240, weak: 0.6, strong: 0.7 },
  custom: { ms: 80, weak: 0.4, strong: 0.3 },
};

type Actuator = { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> };

/**
 * Gamepads plugged into (or paired with) the machine running the host page. A pad joins the room as a
 * real player when someone presses a button in the lobby; its input flows through the very same
 * encoder/decoder path as a phone, so the sim cannot tell the difference.
 */
export class LocalPadHub {
  private readonly slots = new Map<number, Slot>();
  private infos: LocalPadInfo[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LocalPadInfo[] => this.infos;

  private publish(): void {
    this.infos = [...this.slots.values()].map((s) => s.info).sort((a, b) => a.index - b.index);
    for (const l of this.listeners) l();
  }

  /**
   * Poll every pad once. Call from the fixed tick. Returns menu edges for each joined pad.
   * @param canJoin new pads may join (lobby). Disconnected pads are dropped only while this is true,
   *   so a pad that dies mid-match keeps its fighter (shown OFFLINE) until the next lobby.
   */
  sample(now: number, canJoin: boolean): { id: string; edges: MenuEdges }[] {
    const out: { id: string; edges: MenuEdges }[] = [];
    const list: (Gamepad | null)[] = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function" ? Array.from(navigator.getGamepads()) : [];
    const seen = new Set<number>();
    let changed = false;

    for (const g of list) {
      if (!g || !g.connected) continue;
      seen.add(g.index);
      let slot = this.slots.get(g.index);
      if (!slot) {
        const encoder = new InputEncoder();
        const kind = padKindOf(g.id);
        slot = {
          index: g.index,
          info: { id: `${PAD_PREFIX}${g.index}`, index: g.index, name: PAD_LABELS[kind].name, kind, connected: true, joined: false },
          mapper: new GamepadMapper(),
          encoder,
          driver: new PadDriver(encoder),
          gamepad: g,
          lastRumble: 0,
        };
        this.slots.set(g.index, slot);
        changed = true;
      }
      slot.gamepad = g;
      if (!slot.info.connected) {
        slot.info = { ...slot.info, connected: true };
        changed = true;
      }
      const snap = snapshotOf(g);
      const edges = slot.mapper.menu(snap, now);
      if (!slot.info.joined) {
        if (canJoin && edges.any) {
          const sameKind = [...this.slots.values()].filter((s) => s.info.joined && s.info.kind === slot!.info.kind).length;
          // The press that joined is already recorded as "down" by menu(), so it will not fire again as a menu action.
          slot.info = { ...slot.info, joined: true, name: `${PAD_LABELS[slot.info.kind].name} ${sameKind + 1}` };
          changed = true;
        }
        continue;
      }
      slot.driver.apply(slot.mapper.read(snap), true);
      out.push({ id: slot.info.id, edges });
    }

    for (const [index, slot] of this.slots) {
      if (seen.has(index)) continue;
      if (slot.info.connected) {
        slot.driver.release();
        slot.mapper.reset();
        slot.gamepad = null;
        slot.info = { ...slot.info, connected: false };
        changed = true;
      }
      if (!slot.info.joined || canJoin) {
        this.slots.delete(index);
        changed = true;
      }
    }
    if (changed) this.publish();
    return out;
  }

  /** Current wire packet for a joined pad (fresh `seq` every call, so it is never stale). */
  wire(id: string, now: number): WireInput | undefined {
    for (const slot of this.slots.values()) {
      if (slot.info.id === id && slot.info.joined) return slot.encoder.snapshot(now);
    }
    return undefined;
  }

  /** Players to merge into the lobby roster. */
  roster(): { id: string; name: string; connected: boolean; local: true }[] {
    return this.infos.filter((p) => p.joined).map((p) => ({ id: p.id, name: p.name, connected: p.connected, local: true as const }));
  }

  rumble(id: string, pattern: string): void {
    for (const slot of this.slots.values()) {
      if (slot.info.id !== id || !slot.gamepad) continue;
      const now = performance.now();
      if (now - slot.lastRumble < 35) return;
      const actuator = (slot.gamepad as unknown as { vibrationActuator?: Actuator }).vibrationActuator;
      if (!actuator?.playEffect) return;
      slot.lastRumble = now;
      const p = RUMBLE[pattern] ?? RUMBLE.light;
      void actuator.playEffect("dual-rumble", { startDelay: 0, duration: p.ms, weakMagnitude: p.weak, strongMagnitude: p.strong })?.catch?.(() => undefined);
    }
  }
}

export const localPads = new LocalPadHub();

export const useLocalPads = (): LocalPadInfo[] => useSyncExternalStore(localPads.subscribe, localPads.getSnapshot);
