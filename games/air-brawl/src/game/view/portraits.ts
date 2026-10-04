import type { Graphics } from "pixi.js";
import type { FighterId } from "../sim/types";

/**
 * Original vector bust portraits for the HUD tiles, drawn in a 100x100 box (y down, centre 50,50).
 * Light direction is up-left; every portrait carries a hard shadow side and a bright accent so it
 * reads at thumbnail size on any slot colour.
 */
export const drawPortrait = (g: Graphics, id: FighterId, accent: number): void => {
  g.clear();
  switch (id) {
    case "nova": {
      // Shoulders + helmet with a glass visor and glowing eye slits.
      g.poly([6, 100, 14, 80, 34, 72, 66, 72, 86, 80, 94, 100]).fill({ color: 0x1b2038 });
      g.poly([22, 100, 28, 82, 40, 76, 60, 76, 72, 82, 78, 100]).fill({ color: 0xeef2fb });
      g.poly([20, 40, 12, 16, 30, 28]).fill({ color: 0xcfd6e6 });
      g.poly([80, 40, 88, 16, 70, 28]).fill({ color: 0x9aa4bd });
      g.ellipse(50, 48, 31, 33).fill({ color: 0xf4f7ff });
      g.ellipse(58, 56, 24, 28).fill({ color: 0x000000, alpha: 0.12 });
      g.roundRect(24, 42, 52, 22, 10).fill({ color: 0x0b1228 });
      g.roundRect(26, 44, 48, 6, 3).fill({ color: 0xffffff, alpha: 0.22 });
      g.ellipse(38, 54, 7, 3.2).fill({ color: accent });
      g.ellipse(62, 54, 7, 3.2).fill({ color: accent });
      g.roundRect(46, 14, 8, 22, 3).fill({ color: 0x1b2038, alpha: 0.85 });
      g.ellipse(50, 70, 17, 7).fill({ color: 0x1b2038, alpha: 0.9 });
      break;
    }
    case "volt": {
      // Shoulders + scarf, face with raised goggles and a wild yellow crest.
      g.poly([6, 100, 14, 82, 34, 74, 66, 74, 86, 82, 94, 100]).fill({ color: 0x1b2540 });
      g.poly([30, 88, 70, 88, 64, 100, 36, 100]).fill({ color: accent });
      g.poly([30, 78, 70, 78, 74, 90, 26, 90]).fill({ color: 0xf4f0e6 });
      g.poly([22, 36, 14, 8, 32, 24, 36, 2, 46, 22, 54, 0, 60, 22, 74, 4, 70, 26, 90, 16, 78, 40]).fill({ color: 0xffe14d });
      g.ellipse(50, 56, 26, 28).fill({ color: 0xf2c6a0 });
      g.ellipse(58, 62, 20, 24).fill({ color: 0x000000, alpha: 0.1 });
      g.roundRect(22, 30, 56, 12, 6).fill({ color: 0x1b2038 });
      g.ellipse(36, 36, 9, 7.5).fill({ color: accent });
      g.ellipse(64, 36, 9, 7.5).fill({ color: accent });
      g.ellipse(38, 56, 5.5, 7).fill({ color: 0xffffff });
      g.ellipse(62, 56, 5.5, 7).fill({ color: 0xffffff });
      g.ellipse(39, 57, 2.6, 3.4).fill({ color: 0x14121c });
      g.ellipse(63, 57, 2.6, 3.4).fill({ color: 0x14121c });
      g.poly([30, 46, 46, 49, 46, 51, 30, 49]).fill({ color: 0xffe14d });
      g.poly([54, 49, 70, 46, 70, 49, 54, 51]).fill({ color: 0xffe14d });
      g.poly([40, 72, 60, 70, 60, 73, 42, 76]).fill({ color: 0x14121c });
      break;
    }
    case "bulwark": {
      // Hulking helm with horns, brow plate and a burning visor slit.
      g.poly([0, 100, 4, 78, 28, 68, 72, 68, 96, 78, 100, 100]).fill({ color: 0x2a2f40 });
      g.poly([8, 100, 12, 82, 30, 74, 70, 74, 88, 82, 92, 100]).fill({ color: 0xcfc6b4 });
      g.poly([16, 40, 2, 14, 24, 28]).fill({ color: 0xe9e2d2 });
      g.poly([84, 40, 98, 14, 76, 28]).fill({ color: 0xb8ae98 });
      g.roundRect(20, 20, 60, 56, 12).fill({ color: 0x2a2d3c });
      g.roundRect(20, 20, 60, 20, 10).fill({ color: 0xf2f4fa });
      g.roundRect(24, 24, 24, 8, 4).fill({ color: 0xffffff, alpha: 0.4 });
      g.roundRect(26, 44, 48, 12, 4).fill({ color: 0x0a0a12 });
      g.roundRect(30, 47, 14, 6, 3).fill({ color: accent });
      g.roundRect(56, 47, 14, 6, 3).fill({ color: accent });
      g.roundRect(34, 62, 32, 10, 3).fill({ color: 0x14141c });
      for (let i = 0; i < 4; i += 1) g.rect(38 + i * 8, 64, 3, 6).fill({ color: 0x525a70 });
      g.poly([38, 76, 44, 88, 46, 76]).fill({ color: 0xf2f4fa });
      g.poly([62, 76, 56, 88, 54, 76]).fill({ color: 0xf2f4fa });
      break;
    }
    default: {
      // Wisp: pointed hood, dark face void, bright eyes, floating halo.
      g.ellipse(50, 56, 44, 44).stroke({ width: 2.4, color: 0xffffff, alpha: 0.55 });
      g.poly([4, 100, 18, 78, 40, 70, 60, 70, 82, 78, 96, 100]).fill({ color: 0x2a1a55 });
      g.poly([50, 0, 76, 34, 82, 62, 72, 78, 28, 78, 18, 62, 24, 34]).fill({ color: 0x3a2476 });
      g.poly([50, 0, 76, 34, 82, 62, 72, 78, 62, 78, 66, 50, 64, 30]).fill({ color: 0x000000, alpha: 0.18 });
      g.ellipse(50, 56, 22, 24).fill({ color: 0x07040f });
      g.ellipse(41, 54, 5, 7).fill({ color: accent });
      g.ellipse(59, 54, 5, 7).fill({ color: accent });
      g.ellipse(41, 53, 2, 3).fill({ color: 0xffffff });
      g.ellipse(59, 53, 2, 3).fill({ color: 0xffffff });
      g.poly([22, 40, 32, 34, 36, 38, 26, 46]).fill({ color: 0xe6dcff });
      g.poly([78, 40, 68, 34, 64, 38, 74, 46]).fill({ color: 0xe6dcff });
      g.ellipse(50, 80, 14, 5).fill({ color: accent, alpha: 0.9 });
      break;
    }
  }
};
