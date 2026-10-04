import type { ItemKind, MoveDef } from "../sim/types";

export interface ItemInfo {
  kind: ItemKind;
  name: string;
  blurb: string;
  /** Spawn weight. */
  weight: number;
  color: string;
}

export const ITEMS: Record<ItemKind, ItemInfo> = {
  powerCore: {
    kind: "powerCore",
    name: "Power Core",
    blurb: "Hits hit harder",
    weight: 3,
    color: "#ff6a3d",
  },
  surge: {
    kind: "surge",
    name: "Surge",
    blurb: "Move faster",
    weight: 3,
    color: "#37f2d0",
  },
  aegis: {
    kind: "aegis",
    name: "Aegis",
    blurb: "Absorbs 3 hits",
    weight: 2,
    color: "#7cb8ff",
  },
  chaosBomb: {
    kind: "chaosBomb",
    name: "Chaos Bomb",
    blurb: "Throw with Attack",
    weight: 3,
    color: "#ffd23d",
  },
};

export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[];

/** Shared move used when a fighter throws a held item. */
export const ITEM_THROW: MoveDef = {
  id: "itemThrow",
  name: "Item Throw",
  kind: "special",
  total: 24,
  hitboxes: [],
  spawns: [{ at: 7, projectile: "bomb", x: 34, y: -62, vx: 8.5, vy: -6.5 }],
  anim: "toss",
};

/** Spawn interval (frames) per item setting. */
export const ITEM_INTERVALS = {
  off: 0,
  low: 1500,
  normal: 900,
  chaos: 420,
} as const;
