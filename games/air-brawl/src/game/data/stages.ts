import type { StageDef, StageId } from "../sim/types";

/**
 * Stage geometry. Origin = centre of the main platform's top surface; +y is
 * down, so platforms above the stage have negative y. A fighter stands with
 * its feet on `platform.y`.
 */

const SPAWNS_FLAT = (halfSpread: number, y = 0) =>
  Array.from({ length: 8 }, (_, i) => ({
    x: -halfSpread + (halfSpread * 2 * i) / 7,
    y,
  }));

const provingGround: StageDef = {
  id: "proving-ground",
  name: "Proving Ground",
  tagline: "Clean competitive arena. One big floor, three floating platforms.",
  platforms: [
    { id: "main", x: -520, y: 0, w: 1040, h: 150, solid: true, ledges: true },
    { id: "left", x: -450, y: -185, w: 230, h: 18, solid: false },
    { id: "right", x: 220, y: -185, w: 230, h: 18, solid: false },
    { id: "top", x: -130, y: -345, w: 260, h: 18, solid: false },
  ],
  hazards: [],
  blast: { left: -1500, right: 1500, top: -1150, bottom: 900 },
  camera: { left: -1250, right: 1250, top: -900, bottom: 650 },
  spawns: SPAWNS_FLAT(440),
  respawn: { x: 0, y: -560 },
  itemRange: [-420, 420],
  theme: {
    skyTop: "#0a1230",
    skyBottom: "#1d3a7a",
    glow: "#5ad7ff",
    platform: "#243a86",
    platformEdge: "#8ceaff",
    accent: "#5ad7ff",
    decor: "proving",
  },
};

const skylineRush: StageDef = {
  id: "skyline-rush",
  name: "Skyline Rush",
  tagline: "Neon rooftop with sliding platforms and drone strikes.",
  platforms: [
    { id: "main", x: -400, y: 0, w: 800, h: 140, solid: true, ledges: true },
    {
      id: "moverA",
      x: -230,
      y: -200,
      w: 210,
      h: 18,
      solid: false,
      move: { ax: 330, ay: 0, period: 480, phase: 0 },
    },
    {
      id: "moverB",
      x: 20,
      y: -200,
      w: 210,
      h: 18,
      solid: false,
      move: { ax: 330, ay: 0, period: 480, phase: 0.5 },
    },
    {
      id: "crown",
      x: -125,
      y: -380,
      w: 250,
      h: 18,
      solid: false,
      move: { ax: 0, ay: 28, period: 300, phase: 0 },
    },
  ],
  hazards: [
    {
      id: "drone",
      kind: "beam",
      period: 420,
      warn: 70,
      active: 34,
      offset: 120,
      xs: [-290, 250, 0, -160, 330, -40],
      w: 130,
      top: -900,
      bottom: 400,
      damage: 9,
      angle: 80,
      baseKb: 34,
      growth: 70,
    },
  ],
  blast: { left: -1450, right: 1450, top: -1150, bottom: 900 },
  camera: { left: -1200, right: 1200, top: -900, bottom: 650 },
  spawns: SPAWNS_FLAT(340),
  respawn: { x: 0, y: -600 },
  itemRange: [-340, 340],
  theme: {
    skyTop: "#190a3a",
    skyBottom: "#5b1a74",
    glow: "#ff55d6",
    platform: "#2c1654",
    platformEdge: "#ff9cf2",
    accent: "#37f2d0",
    decor: "skyline",
  },
};

const foundry: StageDef = {
  id: "foundry",
  name: "The Foundry",
  tagline: "Tall and chaotic. Rising lift, molten geysers, lots of ways up.",
  platforms: [
    { id: "main", x: -340, y: 0, w: 680, h: 120, solid: true, ledges: true },
    { id: "ledgeL", x: -590, y: -170, w: 220, h: 18, solid: false },
    { id: "ledgeR", x: 370, y: -170, w: 220, h: 18, solid: false },
    { id: "mid", x: -160, y: -330, w: 320, h: 18, solid: false },
    {
      id: "lift",
      x: -105,
      y: -500,
      w: 210,
      h: 18,
      solid: false,
      move: { ax: 0, ay: 130, period: 420, phase: 0 },
    },
    { id: "sideL", x: -600, y: -480, w: 190, h: 18, solid: false },
    { id: "sideR", x: 410, y: -480, w: 190, h: 18, solid: false },
  ],
  hazards: [
    {
      id: "geyser",
      kind: "geyser",
      period: 480,
      warn: 80,
      active: 46,
      offset: 200,
      xs: [-470, 470, -470, 470, 0],
      w: 120,
      top: -620,
      bottom: 500,
      damage: 10,
      angle: 88,
      baseKb: 40,
      growth: 78,
    },
  ],
  blast: { left: -1500, right: 1500, top: -1550, bottom: 900 },
  camera: { left: -1250, right: 1250, top: -1250, bottom: 650 },
  spawns: SPAWNS_FLAT(270),
  respawn: { x: 0, y: -780 },
  itemRange: [-300, 300],
  theme: {
    skyTop: "#200c08",
    skyBottom: "#6b2412",
    glow: "#ff9140",
    platform: "#3a2420",
    platformEdge: "#ffb870",
    accent: "#ff5c33",
    decor: "foundry",
  },
};

export const STAGES: Record<StageId, StageDef> = {
  "proving-ground": provingGround,
  "skyline-rush": skylineRush,
  foundry,
};

export const STAGE_IDS: StageId[] = ["proving-ground", "skyline-rush", "foundry"];
