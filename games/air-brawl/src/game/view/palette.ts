/**
 * Player identity. Colour AND shape, so 8 players stay distinguishable on a
 * projector and for colour-blind viewers. Shared by the host canvas and the
 * phone UI.
 */

export type SlotShape =
  | "circle"
  | "triangle"
  | "square"
  | "diamond"
  | "star"
  | "hexagon"
  | "cross"
  | "pentagon";

export interface SlotStyle {
  name: string;
  /** Primary CSS colour (bright, high contrast on dark). */
  color: string;
  /** Darker shade for outlines / panels. */
  dark: string;
  /** Lighter shade for highlights. */
  light: string;
  shape: SlotShape;
}

export const SLOT_STYLES: SlotStyle[] = [
  { name: "Crimson", color: "#ff4d5e", dark: "#7d1426", light: "#ffb3bb", shape: "circle" },
  { name: "Azure", color: "#3fa7ff", dark: "#0f3f7a", light: "#b5dcff", shape: "triangle" },
  { name: "Lime", color: "#7dff5c", dark: "#1f6a14", light: "#d3ffc6", shape: "square" },
  { name: "Amber", color: "#ffc933", dark: "#7a5200", light: "#ffeaa8", shape: "diamond" },
  { name: "Violet", color: "#b778ff", dark: "#4a1a8a", light: "#e3ccff", shape: "star" },
  { name: "Aqua", color: "#3ff5e0", dark: "#0a615a", light: "#c1fff8", shape: "hexagon" },
  { name: "Pink", color: "#ff6fd0", dark: "#7d1a62", light: "#ffc9ee", shape: "cross" },
  { name: "Frost", color: "#f0f3ff", dark: "#56607f", light: "#ffffff", shape: "pentagon" },
];

export const slotStyle = (slot: number): SlotStyle => SLOT_STYLES[((slot % 8) + 8) % 8];

export const hexToNumber = (hex: string): number => parseInt(hex.replace("#", ""), 16);

export const mixHex = (a: string, b: string, t: number): string => {
  const pa = hexToNumber(a);
  const pb = hexToNumber(b);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
};

/** Unit polygon points (radius 1, centred at 0,0) for a shape, as flat [x,y,...]. */
export const shapePoints = (shape: SlotShape): number[] => {
  const poly = (n: number, rot = -Math.PI / 2, r = 1) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = rot + (i / n) * Math.PI * 2;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return pts;
  };
  switch (shape) {
    case "triangle":
      return poly(3, -Math.PI / 2, 1.12);
    case "square":
      return poly(4, Math.PI / 4, 1.05);
    case "diamond":
      return poly(4, -Math.PI / 2, 1.15);
    case "hexagon":
      return poly(6, 0, 1.05);
    case "pentagon":
      return poly(5, -Math.PI / 2, 1.08);
    case "star": {
      const pts: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 1.18 : 0.52;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      return pts;
    }
    case "cross": {
      const t = 0.36;
      return [
        -t, -1, t, -1, t, -t, 1, -t, 1, t, t, t, t, 1, -t, 1, -t, t, -1, t, -1, -t, -t, -t,
      ];
    }
    case "circle":
    default:
      return poly(20, 0, 1);
  }
};

/** SVG `points` attribute for DOM icons (viewBox -1.3..1.3). */
export const shapeSvgPoints = (shape: SlotShape): string => {
  const pts = shapePoints(shape);
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i].toFixed(3)},${pts[i + 1].toFixed(3)}`);
  return out.join(" ");
};

/** Short display name safe for tight layouts. */
export const shortName = (name: string, max = 10): string =>
  name.length <= max ? name : `${name.slice(0, max - 1)}…`;

export const TEAM_STYLES = [
  { name: "Red Team", color: "#ff5470" },
  { name: "Blue Team", color: "#4aa8ff" },
  { name: "Gold Team", color: "#ffc933" },
  { name: "Green Team", color: "#6dff8a" },
];
