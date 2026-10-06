import { Container, Graphics, Sprite, Text, type TextStyleOptions } from "pixi.js";
import type { Fighter, World } from "../sim/types";

import { hexToNumber, mixHex, shortName, slotStyle, TEAM_STYLES, type SlotStyle } from "./palette";
import { drawPortrait } from "./portraits";
import type { GameTextures } from "./textures";

const FONT = "'Arial Black', 'Segoe UI Black', 'Helvetica Neue', Arial, sans-serif";


const text = (value: string, options: Partial<TextStyleOptions> = {}): Text =>
  new Text({
    text: value,
    style: {
      fontFamily: FONT,
      fontWeight: "900",
      fontSize: 22,
      fill: "#ffffff",
      stroke: { color: "#05070f", width: 5, join: "round" },
      ...options,
    },
  });

/** What the HUD needs from a camera: world → screen projection and apparent scale. */
export interface ScreenCamera {
  toScreen(wx: number, wy: number, viewW: number, viewH: number): { x: number; y: number };
  readonly scale: number;
}

interface Card {
  root: Container;
  bg: Graphics;
  icon: Sprite;
  portrait: Graphics;
  name: Text;
  fighter: Text;
  percent: Text;
  decimal: Text;
  plate: Text;
  stocks: Container;
  status: Text;
  team: Graphics;
  lastPercent: number;
  lastStocks: number;
  lastScore: number;
  hasStatus: boolean;
  bump: number;
  flash: number;
  stockSprites: Sprite[];
  scoreText: Text;
}

interface Tag {
  root: Container;
  icon: Sprite;
  label: Text;
}

interface EdgeMarker {
  root: Container;
  icon: Sprite;
  arrow: Graphics;
  label: Text;
}

/** Short text that rises from a point in the world: PARRY!, STALE, and similar skill feedback. */
interface Callout {
  text: Text;
  wx: number;
  wy: number;
  age: number;
  hold: number;
  size: number;
}

interface Announcement {
  text: Text;
  age: number;
  hold: number;
  base: number;
  pop: number;
}

export interface HudOptions {
  teams: boolean;
  timed: boolean;
  names: Record<string, string>;
  offline: Set<string>;
  uiScale: number;
  showTags: boolean;
}

export class HudView {
  readonly container = new Container();
  private readonly cards = new Map<number, Card>();
  private readonly tags = new Map<number, Tag>();
  private readonly edges = new Map<number, EdgeMarker>();
  private readonly cardLayer = new Container();
  private readonly tagLayer = new Container();
  private readonly announceLayer = new Container();
  private announcements: Announcement[] = [];
  private callouts: Callout[] = [];
  private readonly timerText = text("", { fontSize: 46 });
  private readonly timerSub = text("", { fontSize: 18, fill: "#cfe0ff" });
  private flashOverlay = new Graphics();
  private flashAlpha = 0;
  private flashColor = 0xffffff;
  private vignette = new Graphics();
  private vignetteAlpha = 0;
  private viewW = 0;
  private viewH = 0;

  /** Height the HUD cards occupy at the bottom of the screen (for camera framing). */
  cardInset = 0;

  constructor(private readonly textures: GameTextures) {
    this.container.addChild(this.vignette, this.flashOverlay, this.tagLayer, this.cardLayer, this.timerText, this.timerSub, this.announceLayer);
    this.timerText.anchor.set(0.5, 0);
    this.timerSub.anchor.set(0.5, 0);
    this.timerText.visible = false;
    this.timerSub.visible = false;
  }

  /* ----------------------------------------------------------------- BUILD */

  private makeCard(f: Fighter): Card {
    const style = slotStyle(f.slot);
    const root = new Container();
    const bg = new Graphics();
    const icon = new Sprite(this.textures.shapes[style.shape]);
    icon.anchor.set(0.5);
    icon.tint = 0xffffff;
    icon.alpha = 0.92;
    const name = text(shortName(f.name, 11), { fontSize: 15, fill: "#ffffff", stroke: { color: "#05070f", width: 3, join: "round" } });
    const fighter = text(f.def.name.toUpperCase(), { fontSize: 10, fill: "#ffffff", stroke: { color: "#05070f", width: 3 } });
    const percent = text("0", { fontSize: 50, fill: "#ffffff", stroke: { color: "#05070f", width: 7, join: "round" }, fontStyle: "italic" });
    percent.anchor.set(1, 1);
    const decimal = text("%", { fontSize: 22, fill: "#ffffff", stroke: { color: "#05070f", width: 5, join: "round" }, fontStyle: "italic" });
    decimal.anchor.set(0, 1);
    const plate = text("", { fontSize: 12 });
    const stocks = new Container();
    const status = text("", { fontSize: 12, fill: "#ffe066" });
    const team = new Graphics();
    const scoreText = text("", { fontSize: 22, fill: "#ffe9a8" });
    const portrait = new Graphics();
    drawPortrait(portrait, f.def.id, hexToNumber(style.light));
    root.addChild(bg, team, portrait, icon, fighter, percent, decimal, name, stocks, status, scoreText, plate);
    this.cardLayer.addChild(root);
    return { root, bg, icon, portrait, name, fighter, percent, decimal, plate, stocks, status, team, lastPercent: -1, lastStocks: -1, lastScore: -9999, hasStatus: false, bump: 0, flash: 0, stockSprites: [], scoreText };
  }

  private makeTag(f: Fighter): Tag {
    const style = slotStyle(f.slot);
    const root = new Container();
    const icon = new Sprite(this.textures.shapes[style.shape]);
    icon.anchor.set(0.5);
    icon.tint = hexToNumber(style.color);
    icon.width = 34;
    icon.height = 34;
    const label = text(`P${f.slot + 1}`, { fontSize: 18, fill: "#ffffff", stroke: { color: hexToNumber(style.dark), width: 6, join: "round" } });
    label.anchor.set(0.5);
    root.addChild(icon, label);
    this.tagLayer.addChild(root);
    return { root, icon, label };
  }

  private makeEdge(f: Fighter): EdgeMarker {
    const style = slotStyle(f.slot);
    const root = new Container();
    const arrow = new Graphics();
    const icon = new Sprite(this.textures.shapes[style.shape]);
    icon.anchor.set(0.5);
    icon.tint = hexToNumber(style.color);
    icon.width = 46;
    icon.height = 46;
    const label = text(`P${f.slot + 1}`, { fontSize: 15, fill: "#ffffff", stroke: { color: hexToNumber(style.dark), width: 5 } });
    label.anchor.set(0.5);
    root.addChild(arrow, icon, label);
    this.tagLayer.addChild(root);
    return { root, icon, arrow, label };
  }

  /* ---------------------------------------------------------------- EFFECTS */

  announce(message: string, color = "#ffffff", options: { size?: number; hold?: number } = {}): void {
    for (const a of this.announcements) a.hold = Math.min(a.hold, a.age + 6);
    const label = text(message, {
      fontSize: options.size ?? 140,
      fill: color,
      stroke: { color: "#05070f", width: Math.max(10, (options.size ?? 140) * 0.09), join: "round" },
      dropShadow: { color: "#000000", alpha: 0.55, blur: 14, distance: 10, angle: Math.PI / 2 },
    });
    label.anchor.set(0.5);
    label.alpha = 0;
    this.announceLayer.addChild(label);
    this.announcements.push({ text: label, age: 0, hold: options.hold ?? 40, base: options.size ?? 140, pop: 0 });
  }

  /** Floating text at a world position. Capped so a brawl never buries the screen in labels. */
  callout(wx: number, wy: number, message: string, color = "#ffffff", options: { size?: number; hold?: number } = {}): void {
    const size = options.size ?? 40;
    if (this.callouts.length >= 8) {
      const oldest = this.callouts.shift();
      oldest?.text.destroy();
    }
    const label = text(message, {
      fontSize: size,
      fill: color,
      stroke: { color: "#05070f", width: Math.max(5, size * 0.14), join: "round" },
    });
    label.anchor.set(0.5);
    label.alpha = 0;
    this.announceLayer.addChild(label);
    this.callouts.push({ text: label, wx, wy, age: 0, hold: options.hold ?? 30, size });
  }

  flash(color: number, alpha: number): void {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  setVignette(alpha: number): void {
    this.vignetteAlpha = alpha;
  }

  bumpPercent(index: number): void {
    const card = this.cards.get(index);
    if (card) {
      card.bump = 1;
      card.flash = 1;
    }
  }

  clear(): void {
    for (const c of this.cards.values()) c.root.destroy({ children: true });
    for (const t of this.tags.values()) t.root.destroy({ children: true });
    for (const e of this.edges.values()) e.root.destroy({ children: true });
    this.cards.clear();
    this.tags.clear();
    this.edges.clear();
    for (const a of this.announcements) a.text.destroy();
    this.announcements = [];
    for (const c of this.callouts) c.text.destroy();
    this.callouts = [];
    this.timerText.visible = false;
    this.timerSub.visible = false;
  }

  /* ----------------------------------------------------------------- UPDATE */

  update(world: World, camera: ScreenCamera, viewW: number, viewH: number, dtFrames: number, opts: HudOptions): void {
    if (viewW !== this.viewW || viewH !== this.viewH) {
      this.viewW = viewW;
      this.viewH = viewH;
      this.drawOverlays();
    }
    const fighters = world.fighters;
    const n = fighters.length;
    const scale = Math.max(0.55, Math.min(1.5, opts.uiScale)) * Math.min(1, viewW / 1920 + 0.25);
    const gap = 10 * scale;
    const cardW = Math.min(232 * scale, (viewW - 32 - gap * (n - 1)) / n);
    const cardH = 92 * scale;
    const totalW = n * cardW + (n - 1) * gap;
    const startX = (viewW - totalW) / 2;
    const y = viewH - cardH - 12 * scale;
    this.cardInset = cardH + 22 * scale;

    fighters.forEach((f, i) => {
      let card = this.cards.get(i);
      if (!card) {
        card = this.makeCard(f);
        this.cards.set(i, card);
      }
      this.updateCard(card, f, world, startX + i * (cardW + gap), y, cardW, cardH, scale, dtFrames, opts);
    });

    this.updateTags(world, camera, viewW, viewH, scale, opts);
    this.updateTimer(world, viewW, scale, opts);
    this.updateAnnouncements(viewW, viewH, dtFrames, scale);
    this.updateCallouts(camera, viewW, viewH, scale, dtFrames);

    this.flashAlpha = Math.max(0, this.flashAlpha - 0.045 * dtFrames);
    this.flashOverlay.alpha = this.flashAlpha;
    this.flashOverlay.tint = this.flashColor;
    this.vignette.alpha = this.vignetteAlpha;
  }

  private drawOverlays(): void {
    this.flashOverlay.clear();
    this.flashOverlay.rect(0, 0, this.viewW, this.viewH).fill({ color: 0xffffff });
    this.flashOverlay.alpha = 0;
    this.vignette.clear();
    const steps = 8;
    for (let i = 0; i < steps; i += 1) {
      const inset = (i / steps) * Math.min(this.viewW, this.viewH) * 0.2;
      this.vignette
        .rect(inset, inset, this.viewW - inset * 2, this.viewH - inset * 2)
        .stroke({ width: (Math.min(this.viewW, this.viewH) * 0.2) / steps + 1, color: 0x000000, alpha: 0.11 });
    }
    this.vignette.alpha = this.vignetteAlpha;
  }

  private updateCard(
    card: Card,
    f: Fighter,
    world: World,
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
    dtFrames: number,
    opts: HudOptions,
  ): void {
    const style: SlotStyle = slotStyle(f.slot);
    const dead = !f.alive;
    const color = hexToNumber(style.color);
    card.root.position.set(x, y);
    card.root.alpha = dead ? 0.45 : 1;
    const skew = 10 * scale;
    const tile = Math.min(h - 8 * scale, 66 * scale);
    const plateH = 20 * scale;
    const body = h - plateH;

    card.bg.clear();
    // Name plate: dark slanted bar with a thin slot-colour line.
    card.bg.poly([skew, h - plateH, w, h - plateH, w - skew, h, 0, h]).fill({ color: 0x090c18, alpha: 0.92 });
    card.bg.poly([0, h - 2.5 * scale, w - skew, h - 2.5 * scale, w - skew - 2 * scale, h, 0, h]).fill({ color, alpha: dead ? 0.35 : 1 });
    // Percent backing wash.
    card.bg.poly([tile + skew * 0.5, 4 * scale, w, 4 * scale, w - skew, body, tile - skew * 0.4, body]).fill({ color: 0x05070f, alpha: 0.38 });
    // Portrait tile: slanted square in the slot colour with a darker lower half.
    card.bg.poly([skew, 0, tile + skew, 0, tile, tile, 0, tile]).fill({ color: dead ? 0x555a6a : color });
    card.bg.poly([skew * 0.45, tile * 0.55, tile + skew * 0.45, tile * 0.55, tile, tile, 0, tile]).fill({ color: 0x000000, alpha: 0.28 });
    card.bg.poly([skew, 0, tile + skew, 0, tile, tile, 0, tile]).stroke({ width: 2.5 * scale, color: 0x05070f, alpha: 0.9 });
    card.team.clear();
    if (opts.teams) {
      const team = TEAM_STYLES[f.team % TEAM_STYLES.length];
      card.team.poly([tile + skew + 2 * scale, 0, tile + skew + 8 * scale, 0, tile + 8 * scale, tile, tile + 2 * scale, tile]).fill({ color: hexToNumber(team.color) });
    }

    const offline = opts.offline.has(f.id);
    // Fighter bust fills the tile; the identity shape (colour + shape redundancy) rides in the corner.
    const bust = (tile / 100) * 0.96;
    card.portrait.scale.set(bust);
    card.portrait.position.set(skew * 0.5 + tile * 0.5 - 50 * bust, tile * 0.5 - 50 * bust - tile * 0.02);
    card.portrait.alpha = dead ? 0.4 : 1;
    card.icon.position.set(skew * 0.5 + tile * 0.82, tile * 0.2);
    card.icon.width = tile * 0.26;
    card.icon.height = tile * 0.26;
    card.fighter.style.fontSize = 10 * scale;
    card.fighter.anchor.set(0.5, 1);
    card.fighter.position.set(tile * 0.5 + skew * 0.4, tile - 3 * scale);

    const displayName = opts.names[f.id] ?? f.name;
    card.name.text = shortName(displayName, Math.max(5, Math.floor((w - 20 * scale) / (9 * scale))));
    card.name.style.fontSize = 13 * scale;
    card.name.position.set(skew + 6 * scale, h - plateH + 2 * scale);

    // Damage: big italic number, small percent sign; white, yellow, orange, red, deep red.
    const pct = Math.round(f.percent);
    if (pct !== card.lastPercent) {
      if (pct > card.lastPercent && card.lastPercent >= 0) {
        card.bump = 1;
        card.flash = 1;
      }
      card.lastPercent = pct;
      card.percent.text = `${pct}`;
    }
    card.bump = Math.max(0, card.bump - 0.07 * dtFrames);
    card.flash = Math.max(0, card.flash - 0.06 * dtFrames);
    const heat = Math.min(1, pct / 200);
    let base: string;
    if (heat < 0.25) base = mixHex("#ffffff", "#ffe35a", heat / 0.25);
    else if (heat < 0.55) base = mixHex("#ffe35a", "#ff8a1f", (heat - 0.25) / 0.3);
    else base = mixHex("#ff8a1f", "#e01818", Math.min(1, (heat - 0.55) / 0.45));
    const fill = card.flash > 0.5 ? "#ffffff" : base;
    card.percent.style.fill = fill;
    card.decimal.style.fill = fill;
    card.percent.style.fontSize = 46 * scale;
    card.decimal.style.fontSize = 20 * scale;
    const bump = 1 + card.bump * 0.3;
    card.percent.scale.set(bump);
    const right = w - 30 * scale;
    card.percent.position.set(right, body + 2 * scale);
    card.decimal.position.set(right + 2 * scale, body - 2 * scale);
    card.percent.visible = !dead;
    card.decimal.visible = !dead;

    // Stocks (small identity shapes) or score, on the name plate.
    if (opts.timed) {
      card.stocks.visible = false;
      const score = world.scores[f.index];
      if (score !== card.lastScore) {
        card.lastScore = score;
        card.scoreText.text = `${score >= 0 ? "" : "\u2212"}${Math.abs(score)} KO`;
      }
      card.scoreText.style.fontSize = 16 * scale;
      card.scoreText.anchor.set(1, 0.5);
      card.scoreText.position.set(w - skew - 6 * scale, h - plateH / 2 + 1 * scale);
      card.scoreText.visible = true;
    } else {
      card.scoreText.visible = false;
      card.stocks.visible = true;
      if (card.lastStocks !== f.stocks) {
        card.lastStocks = f.stocks;
        for (const s of card.stockSprites) s.destroy();
        card.stockSprites = [];
        for (let i = 0; i < Math.min(f.stocks, 9); i += 1) {
          const s = new Sprite(this.textures.shapes[style.shape]);
          s.anchor.set(0.5);
          s.tint = color;
          card.stocks.addChild(s);
          card.stockSprites.push(s);
        }
      }
      const pip = 13 * scale;
      card.stockSprites.forEach((s, i) => {
        s.width = pip;
        s.height = pip;
        s.position.set(w - skew - 10 * scale - i * (pip + 2 * scale), h - plateH / 2 + 1 * scale);
      });
    }

    // Status chip above the percent.
    let status = "";
    if (offline) status = "OFFLINE";
    else if (!f.alive) status = opts.timed ? "" : "OUT";
    else if (f.state === "respawn") status = "RESPAWN";
    else if (f.buffPower > 0) status = "POWER";
    else if (f.buffSpeed > 0) status = "SURGE";
    else if (f.buffAegis > 0) status = "AEGIS";
    card.status.text = status;
    card.hasStatus = status !== "";
    card.status.style.fontSize = 11 * scale;
    card.status.anchor.set(1, 0);
    card.status.position.set(w - skew - 4 * scale, 4 * scale);
    card.status.style.fill = offline ? "#ff8a8a" : "#ffe066";
    card.fighter.visible = true;
    card.plate.visible = false;
  }

  private updateTags(world: World, camera: ScreenCamera, viewW: number, viewH: number, scale: number, opts: HudOptions): void {
    const margin = 58 * scale;
    for (const f of world.fighters) {
      let tag = this.tags.get(f.index);
      if (!tag) {
        tag = this.makeTag(f);
        this.tags.set(f.index, tag);
      }
      let edge = this.edges.get(f.index);
      if (!edge) {
        edge = this.makeEdge(f);
        this.edges.set(f.index, edge);
      }
      const visibleFighter = f.alive && !f.vanished && !(f.state === "respawn" && f.sf < 70);
      if (!visibleFighter || !opts.showTags) {
        tag.root.visible = false;
        edge.root.visible = false;
        continue;
      }
      const head = camera.toScreen(f.x, f.y - f.def.height * f.def.scale - 38, viewW, viewH);
      const bodyPos = camera.toScreen(f.x, f.y - f.def.height * 0.5, viewW, viewH);
      const onScreen = bodyPos.x > 0 && bodyPos.x < viewW && bodyPos.y > 0 && bodyPos.y < viewH;
      tag.root.visible = onScreen;
      edge.root.visible = !onScreen;
      if (onScreen) {
        const s = Math.max(0.7, Math.min(1.25, camera.scale * 1.3)) * scale;
        tag.root.position.set(head.x, head.y);
        tag.root.scale.set(s);
        const bob = Math.sin((world.frame + f.slot * 9) * 0.1) * 2;
        tag.root.y += bob;
        // Respawn / invulnerable pulse.
        const pulse = f.invuln > 0 && f.state !== "respawn" ? 1 + 0.12 * Math.sin(world.frame * 0.5) : 1;
        tag.root.scale.set(s * pulse);
      } else {
        const cx = Math.max(margin, Math.min(viewW - margin, bodyPos.x));
        const cy = Math.max(margin, Math.min(viewH - margin * 2.4, bodyPos.y));
        edge.root.position.set(cx, cy);
        const ang = Math.atan2(bodyPos.y - viewH / 2, bodyPos.x - viewW / 2);
        const style = slotStyle(f.slot);
        edge.arrow.clear();
        const r = 38 * scale;
        edge.arrow.poly([Math.cos(ang) * (r + 18 * scale), Math.sin(ang) * (r + 18 * scale), Math.cos(ang + 2.4) * r, Math.sin(ang + 2.4) * r, Math.cos(ang - 2.4) * r, Math.sin(ang - 2.4) * r]).fill({ color: hexToNumber(style.color) });
        edge.arrow.poly([Math.cos(ang) * (r + 18 * scale), Math.sin(ang) * (r + 18 * scale), Math.cos(ang + 2.4) * r, Math.sin(ang + 2.4) * r, Math.cos(ang - 2.4) * r, Math.sin(ang - 2.4) * r]).stroke({ width: 3, color: 0x05070f });
        edge.icon.width = 44 * scale;
        edge.icon.height = 44 * scale;
        edge.label.style.fontSize = 14 * scale;
        const near = Math.hypot(bodyPos.x - cx, bodyPos.y - cy);
        edge.root.scale.set(Math.max(0.65, 1 - near / 3000));
      }
    }
  }

  private updateTimer(world: World, viewW: number, scale: number, opts: HudOptions): void {
    if (!opts.timed || world.phase === "countdown") {
      this.timerText.visible = false;
      this.timerSub.visible = false;
      return;
    }
    const remain = Math.max(0, world.config.timeLimitSec * 60 - world.matchFrame);
    const sec = Math.ceil(remain / 60);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    this.timerText.text = `${m}:${s.toString().padStart(2, "0")}`;
    this.timerText.style.fontSize = 46 * scale;
    this.timerText.style.fill = sec <= 10 ? "#ff6b6b" : "#ffffff";
    this.timerText.position.set(viewW / 2, 14 * scale);
    this.timerText.visible = true;
    this.timerSub.text = "MOST KOs WINS";
    this.timerSub.style.fontSize = 15 * scale;
    this.timerSub.position.set(viewW / 2, 14 * scale + 52 * scale);
    this.timerSub.visible = true;
  }

  private updateCallouts(camera: ScreenCamera, viewW: number, viewH: number, scale: number, dtFrames: number): void {
    for (let i = this.callouts.length - 1; i >= 0; i -= 1) {
      const c = this.callouts[i];
      c.age += dtFrames;
      const popIn = Math.min(1, c.age / 6);
      const out = c.age > c.hold ? Math.min(1, (c.age - c.hold) / 10) : 0;
      const p = camera.toScreen(c.wx, c.wy, viewW, viewH);
      const rise = Math.min(1, c.age / (c.hold + 10)) * 46 * scale;
      c.text.position.set(p.x, p.y - rise);
      c.text.alpha = (1 - out) * Math.min(1, c.age / 3);
      c.text.scale.set((0.6 + 0.4 * popIn) * (1 + Math.sin(popIn * Math.PI) * 0.18) * scale * Math.max(0.8, Math.min(1.3, camera.scale * 1.4)));
      if (out >= 1) {
        c.text.destroy();
        this.callouts.splice(i, 1);
      }
    }
  }

  private updateAnnouncements(viewW: number, viewH: number, dtFrames: number, scale: number): void {
    for (let i = this.announcements.length - 1; i >= 0; i -= 1) {
      const a = this.announcements[i];
      a.age += dtFrames;
      const popIn = Math.min(1, a.age / 9);
      const out = a.age > a.hold ? Math.min(1, (a.age - a.hold) / 14) : 0;
      const overshoot = 1 + Math.sin(popIn * Math.PI) * 0.22;
      a.text.alpha = (1 - out) * Math.min(1, a.age / 4);
      a.text.scale.set((0.55 + 0.45 * popIn) * overshoot * (1 + out * 0.25) * scale);
      a.text.position.set(viewW / 2, viewH * 0.36);
      if (out >= 1) {
        a.text.destroy();
        this.announcements.splice(i, 1);
      }
    }
  }
}
