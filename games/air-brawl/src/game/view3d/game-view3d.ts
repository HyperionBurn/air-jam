import { Application, Container, Graphics, Text } from "pixi.js";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ITEMS } from "../data/items";
import { currentMove } from "../sim/ops";
import type { HitFx, ProjectileEntity, SimEvent, World } from "../sim/types";
import { Camera } from "../view/camera";
import { HudView, type HudOptions, type ScreenCamera } from "../view/hud";
import { hexToNumber, slotStyle } from "../view/palette";
import { createTextures } from "../view/textures";
import { setSegScale } from "./geo";
import { FighterModel } from "./fighter-model";
import { Fx3D } from "./fx3d";
import { PostStack } from "./post";
import { buildStage, type Stage3D } from "./stages3d";

export interface ViewSettings {
  reducedShake: boolean;
  reducedEffects: boolean;
  uiScale: number;
  debug: boolean;
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  reducedShake: false,
  reducedEffects: false,
  uiScale: 1,
  debug: false,
};

const FOV = 32;
/** Pixels rendered per quality level (0 = full). The governor walks down this list. */
const PIXEL_BUDGET = [3.2e6, 2.1e6, 1.7e6, 1.5e6, 1.1e6];
/** One 60 Hz refresh is 16.7 ms; beyond this the match feels heavy and inputs land late. */
const SLOW_FRAME_MS = 19.5;
/** Comfortable headroom: a long stretch below this earns a level back. */
const FAST_FRAME_MS = 11;
const FX_COLOR: Record<HitFx, number> = {
  impact: 0xffffff,
  slash: 0xbfe9ff,
  electric: 0x9be8ff,
  fire: 0xffa23d,
  magic: 0xe0a8ff,
  shock: 0xfff2c0,
  meteor: 0xffd27a,
};

/** Projects sim-space (y down) points through the perspective camera for the 2D overlay. */
class Projector implements ScreenCamera {
  private readonly v = new Vector3();
  px = 1;
  constructor(private readonly cam: PerspectiveCamera) {}
  toScreen(wx: number, wy: number, viewW: number, viewH: number): { x: number; y: number } {
    this.v.set(wx, -wy, 0).project(this.cam);
    return { x: (this.v.x * 0.5 + 0.5) * viewW, y: (-this.v.y * 0.5 + 0.5) * viewH };
  }
  get scale(): number {
    return this.px;
  }
}

/** Additive swing smear that follows a live hitbox: soft edges, hot centre, tapered tail. */
class Ribbon {
  readonly mesh: Mesh;
  private readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  readonly points: { x: number; y: number }[] = [];
  static readonly N = 13;

  constructor() {
    const n = Ribbon.N;
    this.pos = new Float32Array(n * 3 * 3);
    this.col = new Float32Array(n * 3 * 4);
    this.geo.setAttribute("position", new BufferAttribute(this.pos, 3).setUsage(35048));
    this.geo.setAttribute("color", new BufferAttribute(this.col, 4).setUsage(35048));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i += 1) {
      const a = i * 3;
      const b = (i + 1) * 3;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
      idx.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
    this.geo.setIndex(idx);
    this.mesh = new Mesh(
      this.geo,
      new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  update(color: number, width: number, intensity: number): void {
    const n = Ribbon.N;
    const pts = this.points;
    const count = Math.min(pts.length, n);
    this.mesh.visible = count >= 2;
    if (count < 2) return;
    const c = new Color(color);
    const hot = new Color(0xffffff).lerp(c, 0.35);
    for (let i = 0; i < n; i += 1) {
      const p = pts[Math.min(i, count - 1)];
      const q = pts[Math.min(i + 1, count - 1)];
      let dx = p.x - q.x;
      let dy = p.y - q.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const t = 1 - i / (n - 1);
      const w = width * (0.25 + 0.75 * t);
      const nx = dy;
      const ny = dx;
      const o = i * 9;
      this.pos.set([p.x + nx * w, -p.y + ny * w, 30], o);
      this.pos.set([p.x, -p.y, 30.5], o + 3);
      this.pos.set([p.x - nx * w, -p.y - ny * w, 30], o + 6);
      const a = 0.78 * t * t * intensity;
      this.col.set([c.r, c.g, c.b, 0], i * 12);
      this.col.set([hot.r * 1.4, hot.g * 1.4, hot.b * 1.4, a], i * 12 + 4);
      this.col.set([c.r, c.g, c.b, 0], i * 12 + 8);
    }
    (this.geo.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("color") as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

interface ProjectileVisual {
  group: Group;
  seen: number;
  look: string;
  spin: Group[];
  core?: Mesh;
}

/** Owns the WebGL scene (three.js) and a transparent Pixi overlay for HUD/announcer. */
export class GameView3D {
  readonly camera = new Camera();
  private readonly scene = new Scene();
  private readonly cam = new PerspectiveCamera(FOV, 16 / 9, 40, 16000);
  private readonly projector = new Projector(this.cam);
  private readonly renderer: WebGLRenderer;
  private readonly post: PostStack;
  private readonly fx: Fx3D;
  private readonly fxGroup = new Group();
  private readonly dynamic = new Group();
  private readonly hud: HudView;
  private readonly overlay: Application;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly glCanvas: HTMLCanvasElement;
  private readonly debugGfx = new Graphics();
  private readonly debugTexts: Text[] = [];
  private readonly screenLayer = new Container();
  private stage: Stage3D | null = null;
  private stageId = "";
  private models: FighterModel[] = [];
  private ribbons: Ribbon[] = [];
  private halos: Group[] = [];
  private readonly projectiles = new Map<number, ProjectileVisual>();
  private readonly items = new Map<number, { group: Group; seen: number }>();
  private settings: ViewSettings = DEFAULT_VIEW_SETTINGS;
  private time = 0;
  private lastWorld: World | null = null;
  private confettiTimer = 0;
  private emberTimer = 0;
  private moteTimer = 0;
  private hitMomentum = 0;
  private koFlash = 0;
  private koBlur = 0;
  private koX = 0.5;
  private koY = 0.5;
  private sizeW = 0;
  private sizeH = 0;
  private frameCounter = 0;
  /** Adaptive quality: 0 = full ... 4 = lowest. Only ever steps down when frames run long. */
  private quality = 0;
  private slowStreak = 0;
  private fastStreak = 0;
  private emaMs = 16.7;
  /** Materials and shader variants are compiled once per world, during the countdown, not mid-fight. */
  private warmed = false;
  private anchors: Group | null = null;
  private forcedLow = false;
  /** `?quality=N` pins the adaptive level (profiling / screenshots). */
  private pinnedQuality: number | null = (() => {
    try {
      const q = new URLSearchParams(window.location.search).get("quality");
      return q === null ? null : Math.max(0, Math.min(4, Number(q) || 0));
    } catch {
      return null;
    }
  })();
  private envTarget: WebGLRenderTarget | null = null;
  private baseVignette = 0.3;
  lastRenderMs = 0;

  private constructor(
    private readonly mount: HTMLElement,
    renderer: WebGLRenderer,
    overlay: Application,
    glCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
  ) {
    this.renderer = renderer;
    this.overlay = overlay;
    this.glCanvas = glCanvas;
    this.overlayCanvas = overlayCanvas;
    const w = Math.max(2, mount.clientWidth);
    const h = Math.max(2, mount.clientHeight);
    this.sizeW = w;
    this.sizeH = h;
    this.post = new PostStack(renderer, this.scene, this.cam, w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    this.fx = new Fx3D(this.fxGroup);
    this.hud = new HudView(createTextures());
    this.scene.add(this.dynamic, this.fxGroup);

    const pmrem = new PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.28;
    pmrem.dispose();

    this.screenLayer.addChild(this.hud.container, this.debugGfx);
    this.debugGfx.visible = false;
    overlay.stage.addChild(this.screenLayer);
  }

  static async create(mount: HTMLElement): Promise<GameView3D> {
    const glCanvas = document.createElement("canvas");
    glCanvas.className = "absolute inset-0 block h-full w-full";
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.className = "pointer-events-none absolute inset-0 block h-full w-full";
    mount.style.position = "relative";
    mount.append(glCanvas, overlayCanvas);

    const dpr = window.devicePixelRatio || 1;
    const renderer = new WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: "high-performance", alpha: false });
    renderer.setPixelRatio(Math.min(dpr, 1.75));
    renderer.setSize(Math.max(2, mount.clientWidth), Math.max(2, mount.clientHeight), false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.info.autoReset = false;

    const overlay = new Application();
    await overlay.init({
      canvas: overlayCanvas,
      resizeTo: mount,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(dpr, 2),
      autoDensity: true,
      autoStart: false,
    });
    overlay.ticker.stop();
    return new GameView3D(mount, renderer, overlay, glCanvas, overlayCanvas);
  }

  /** Renderer counters for profiling (draw calls / triangles per frame, live resources). */
  /** Names of the compiled shader programs (profiling: spot variants compiled mid-match). */
  programNames(): string[] {
    return (this.renderer.info.programs ?? []).map((p) => `${p.id}:${String((p as unknown as { cacheKey?: string }).cacheKey ?? p.name).slice(0, 140)}`);
  }

  stats(): Record<string, number> {
    const info = this.renderer.info;
    const count = (root: Group | null): { meshes: number; tris: number } => {
      let meshes = 0;
      let tris = 0;
      root?.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || !m.visible) return;
        meshes += 1;
        const g = m.geometry;
        const per = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
        tris += per * ((m as unknown as { count?: number }).count ?? 1);
      });
      return { meshes, tris };
    };
    const st = count(this.stage?.group ?? null);
    const fg = count(this.dynamic);
    const per: Record<string, number> = {};
    this.models.forEach((m, i) => {
      const c = count(m.root);
      per[`f${i}_${m.def.id}`] = Math.round(c.tris);
      per[`f${i}_meshes`] = c.meshes;
    });
    return {
      ...per,
      stageMeshes: st.meshes,
      stageTris: Math.round(st.tris),
      dynamicMeshes: fg.meshes,
      dynamicTris: Math.round(fg.tris),
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      quality: this.qualityLevel,
      renderMs: this.lastRenderMs,
    };
  }

  get width(): number {
    return this.sizeW;
  }
  get height(): number {
    return this.sizeH;
  }

  applySettings(settings: ViewSettings): void {
    this.settings = settings;
    this.camera.reducedShake = settings.reducedShake;
    this.fx.density = settings.reducedEffects ? 0.45 : 1;
    this.forcedLow = settings.reducedEffects;
    this.applyQuality();
    this.debugGfx.visible = settings.debug;
  }

  /* ---------------------------------------------------------------- QUALITY */

  get qualityLevel(): number {
    return this.forcedLow ? Math.max(2, this.quality) : this.quality;
  }

  /** Exposure, bloom, grade and a sky-derived reflection environment for the active stage. */
  private applyLook(stage: Stage3D): void {
    const look = stage.look;
    this.renderer.toneMappingExposure = look.exposure;
    this.post.setLook(look);
    this.baseVignette = look.grade.vignette;
    this.envTarget?.dispose();
    const pmrem = new PMREMGenerator(this.renderer);
    const hasSky = stage.envScene.children.length > 0;
    if (hasSky) {
      this.envTarget = pmrem.fromScene(stage.envScene, 0.02);
    } else {
      this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    }
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = look.envIntensity;
  }

  private applyQuality(): void {
    const level = this.qualityLevel;
    const dpr = window.devicePixelRatio || 1;
    // Each step renders fewer pixels: a pixel budget per level, capped by the screen's own density.
    const budget = PIXEL_BUDGET[Math.min(level, PIXEL_BUDGET.length - 1)];
    const pr = Math.max(0.5, Math.min(dpr, 1.75, Math.sqrt(budget / Math.max(1, this.sizeW * this.sizeH))));
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 0.01) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.sizeW, this.sizeH, false);
      this.post.setSize(this.sizeW * pr, this.sizeH * pr);
    }
    this.post.setMsaa(level === 0 ? 4 : level === 1 ? 2 : 0);
    this.post.setEffects(level >= 3);
    this.stage?.setShadows(level < 4);
    this.stage?.setDetail(level);
    for (const m of this.models) m.setDetail(level);
  }

  /** Step quality down if the frame time stays above budget for ~1.5 s. */
  private adapt(dtMs: number): void {
    if (this.pinnedQuality !== null) {
      if (this.quality !== this.pinnedQuality) {
        this.quality = this.pinnedQuality;
        this.applyQuality();
      }
      return;
    }
    const dt = Math.min(dtMs, 250);
    this.emaMs += (dt - this.emaMs) * 0.2;
    // A fighting game has to hold 60: step down as soon as frames run longer than one 60 Hz refresh
    // plus a little slack, rather than waiting for a visibly bad 40 fps.
    if (this.emaMs > SLOW_FRAME_MS) this.slowStreak += dt;
    else this.slowStreak = Math.max(0, this.slowStreak - dt * 2);
    // ...and take a level back after a long stretch of ample headroom (a 120/144 Hz display or a big GPU).
    if (this.emaMs < FAST_FRAME_MS) this.fastStreak += dt;
    else this.fastStreak = 0;
    if (this.slowStreak > 800 && this.quality < 4) {
      this.quality += 1;
      this.slowStreak = 0;
      this.fastStreak = 0;
      this.emaMs = 16.7;
      this.applyQuality();
    } else if (this.fastStreak > 12000 && this.quality > 0) {
      this.quality -= 1;
      this.fastStreak = 0;
      this.emaMs = 16.7;
      this.applyQuality();
    }
  }

  /* ----------------------------------------------------------------- SETUP */

  setWorld(world: World): void {
    this.reset();
    this.lastWorld = world;
    this.warmed = false;
    if (this.anchors) {
      this.scene.remove(this.anchors);
      this.anchors = null;
    }
    this.stageId = world.stage.id;
    this.stage = buildStage(world.stage);
    this.scene.add(this.stage.group);
    this.stage.setShadows(this.qualityLevel < 3);
    this.stage.setDetail(this.qualityLevel);
    this.scene.background = this.stage.background;
    this.scene.fog = this.stage.fog;
    this.applyLook(this.stage);
    // Fewer segments per part as the roster grows: duels get full detail, 8-player chaos stays smooth.
    const n = world.fighters.length;
    setSegScale(n <= 3 ? 1 : n <= 5 ? 0.8 : n <= 6 ? 0.68 : 0.58);
    this.models = world.fighters.map((f) => {
      const m = new FighterModel(f.def, slotStyle(f.slot));
      this.dynamic.add(m.root);
      const r = new Ribbon();
      this.dynamic.add(r.mesh);
      this.ribbons.push(r);
      this.halos.push(this.makeHalo(f.slot));
      const label = new Text({ text: "", style: { fontFamily: "monospace", fontSize: 12, fill: "#c8ffd6", stroke: { color: "#000", width: 3 } } });
      this.screenLayer.addChild(label);
      this.debugTexts.push(label);
      return m;
    });
    this.camera.x = 0;
    this.camera.y = -150;
    this.camera.zoom = 0.4;
    this.fx.clear();
    this.hitMomentum = 0;
  }

  private makeHalo(slot: number): Group {
    const g = new Group();
    const c = hexToNumber(slotStyle(slot).color);
    const disc = new Mesh(new CylinderGeometry(86, 92, 8, 32), new MeshStandardMaterial({ color: 0x141a33, metalness: 0.7, roughness: 0.3 }));
    disc.position.y = -4;
    const ring = new Mesh(new TorusGeometry(88, 3.4, 8, 48), new MeshBasicMaterial({ color: c }));
    ring.rotation.x = Math.PI / 2;
    const inner = new Mesh(new TorusGeometry(58, 2, 8, 40), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 1;
    const beam = new Mesh(
      new CylinderGeometry(34, 56, 900, 24, 1, true),
      new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    beam.position.y = 450;
    g.add(disc, ring, inner, beam);
    g.userData = { ring, inner, beam };
    g.visible = false;
    this.dynamic.add(g);
    return g;
  }

  reset(): void {
    this.hud.clear();
    this.fx.clear();
    for (const m of this.models) {
      m.root.removeFromParent();
      m.dispose();
    }
    this.models = [];
    for (const r of this.ribbons) {
      r.mesh.removeFromParent();
      r.dispose();
    }
    this.ribbons = [];
    for (const h of this.halos) {
      h.removeFromParent();
      h.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as MeshBasicMaterial).dispose();
        }
      });
    }
    this.halos = [];
    for (const v of this.projectiles.values()) this.disposeGroup(v.group);
    this.projectiles.clear();
    for (const v of this.items.values()) this.disposeGroup(v.group);
    this.items.clear();
    for (const t of this.debugTexts) t.destroy();
    this.debugTexts.length = 0;
    if (this.stage) {
      this.stage.group.removeFromParent();
      this.stage.dispose();
      this.stage = null;
    }
    this.scene.background = null;
    this.scene.fog = null;
    this.stageId = "";
    this.lastWorld = null;
    this.debugGfx.clear();
  }

  private disposeGroup(g: Group): void {
    g.removeFromParent();
    g.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as MeshBasicMaterial | MeshStandardMaterial;
        mat.dispose();
      }
    });
  }

  announce(text: string, color = "#ffffff", options: { size?: number; hold?: number } = {}): void {
    this.hud.announce(text, color, options);
  }

  /** Hide HUD cards/tags (model viewer, screenshots). */
  setHudVisible(visible: boolean): void {
    this.hud.container.visible = visible;
  }

  screenFlash(color: number, alpha: number): void {
    this.hud.flash(color, alpha);
  }

  /* ----------------------------------------------------------------- EVENTS */

  handleEvents(world: World): void {
    const fighterColor = (index: number): string => slotStyle(world.fighters[index]?.slot ?? 0).color;
    for (const e of world.events) this.handleEvent(world, e, fighterColor);
  }

  private handleEvent(world: World, e: SimEvent, color: (i: number) => string): void {
    const fx = this.fx;
    switch (e.type) {
      case "hit": {
        const stale = e.stale ?? 0;
        // A stale move lands weaker and duller, so repeating it is visibly worse than varying.
        const power = Math.min(1.6, e.kb / 95 + e.damage / 24) * (1 - 0.3 * stale);
        const attackerColor = stale > 0.45 ? "#98a2b3" : e.attacker >= 0 ? color(e.attacker) : "#ffb347";
        if (stale > 0.45 && e.attacker >= 0) this.hud.callout(e.x, e.y + 60, "STALE", "#aab4c5", { size: 30, hold: 22 });
        fx.hit(e.x, e.y, power, e.dx || 1, e.dy, attackerColor, e.fx);
        this.camera.shake(Math.min(26, 2 + power * 11), e.dx || 1, e.dy);
        if (power > 0.9) {
          this.camera.zoomPunch(0.012 + power * 0.012);
          this.camera.rollKick((e.dx >= 0 ? -1 : 1) * Math.min(0.03, 0.008 + power * 0.01));
        }
        this.hud.bumpPercent(e.victim);
        this.hitMomentum = Math.min(1, this.hitMomentum + power * 0.45);
        if (e.killing) {
          this.hud.flash(0xffffff, 0.3);
          this.camera.shake(26, e.dx || 1, e.dy);
          this.camera.rollKick((e.dx >= 0 ? -1 : 1) * 0.04);
        }
        break;
      }
      case "shieldHit":
        fx.shieldHit(e.x, e.y, color(e.victim));
        this.camera.shake(3);
        break;
      case "parry":
        fx.clash(e.x, e.y);
        fx.shieldHit(e.x, e.y, color(e.victim));
        this.camera.shake(9);
        this.hud.flash(0xdff6ff, 0.22);
        this.hud.callout(e.x, e.y + 70, "PARRY!", "#8be9ff", { size: 52, hold: 28 });
        break;
      case "shieldBreak":
        fx.shieldBreak(e.x, e.y);
        this.camera.shake(22);
        this.hud.flash(0xbcd8ff, 0.4);
        break;
      case "clash":
        fx.clash(e.x, e.y);
        this.camera.shake(8);
        break;
      case "jump":
        fx.jump(e.x, e.y, e.air, color(e.who));
        if (!e.air) fx.dust(e.x, e.y, 0, 0.6);
        break;
      case "land":
        fx.land(e.x, e.y, e.hard);
        if (e.hard) this.camera.shake(5);
        break;
      case "dash":
        fx.dust(e.x, e.y, e.dir, 1.2);
        break;
      case "dodge":
        fx.dodge(e.x, e.y, color(e.who));
        break;
      case "special": {
        const f = world.fighters[e.who];
        if (f) fx.shieldHit(e.x, e.y - f.def.height * 0.5, color(e.who));
        break;
      }
      case "projectile":
        fx.teleport(e.x, e.y, color(e.who), true);
        break;
      case "explosion":
        fx.explosion(e.x, e.y, e.radius);
        this.camera.shake(18);
        this.hud.flash(0xffe0a0, 0.25);
        break;
      case "grab":
        fx.clash(e.x, e.y);
        break;
      case "throw":
        fx.hit(e.x, e.y, 0.7, 1, 0, "#ffffff", "impact");
        this.camera.shake(8);
        break;
      case "ledge":
        fx.dodge(e.x, e.y - 40, "#ffffff");
        break;
      case "teleport":
        fx.teleport(e.x, e.y, color(e.who), e.appear);
        break;
      case "ko": {
        const victim = world.fighters[e.victim];
        const style = slotStyle(victim?.slot ?? 0);
        fx.ko(e.x, e.y, e.dx, e.dy, style.shape, style.color, e.final);
        this.camera.shake(e.final ? 46 : 30);
        this.camera.zoomPunch(e.final ? 0.1 : 0.05);
        this.hud.flash(0xffffff, e.final ? 0.7 : 0.45);
        this.koFlash = e.final ? 0.9 : 0.55;
        this.koBlur = e.final ? 0.09 : 0.05;
        const s = this.projector.toScreen(e.x, e.y, 1, 1);
        this.koX = Math.min(0.95, Math.max(0.05, s.x));
        this.koY = Math.min(0.95, Math.max(0.05, 1 - s.y));
        break;
      }
      case "respawn":
        fx.respawn(e.x, e.y, color(e.who));
        break;
      case "itemSpawn":
        fx.itemSpawn(e.x, e.y, ITEMS[e.kind].color);
        break;
      case "itemPickup": {
        const f = world.fighters[e.who];
        if (f) fx.itemPickup(f.x, f.y - f.def.height * 0.5, ITEMS[e.kind].color);
        break;
      }
      case "hazard":
        if (e.phase === "fire") this.camera.shake(10);
        break;
      default:
        break;
    }
  }

  /* ----------------------------------------------------------------- RENDER */

  private syncSize(): void {
    const w = Math.max(2, this.mount.clientWidth);
    const h = Math.max(2, this.mount.clientHeight);
    if (w === this.sizeW && h === this.sizeH) return;
    this.sizeW = w;
    this.sizeH = h;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.post.setSize(w * pr, h * pr);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  render(world: World | null, alpha: number, dtMs: number, hudOptions: HudOptions): void {
    const start = performance.now();
    this.renderer.info.reset();
    this.syncSize();
    const w = this.sizeW;
    const h = this.sizeH;
    const dtFrames = Math.min(3, dtMs / 16.667);
    this.time += dtFrames;
    this.hitMomentum = Math.max(0, this.hitMomentum - 0.02 * dtFrames);
    this.adapt(dtMs);
    this.koFlash = Math.max(0, this.koFlash - 0.06 * dtFrames);
    this.koBlur = Math.max(0, this.koBlur - 0.004 * dtFrames);

    if (world && world !== this.lastWorld) this.setWorld(world);
    if (!world || !this.stage) {
      this.post.render(dtMs / 1000);
      this.overlay.renderer.render(this.overlay.stage);
      this.lastRenderMs = performance.now() - start;
      return;
    }

    this.camera.inset = this.hud.cardInset;
    this.camera.update(world, world.stage, w, h, dtMs / 1000);
    this.placeCamera(w, h);

    const visibleH = h / this.camera.scale;
    this.stage.update(world, this.time, {
      x: this.camera.x,
      y: -this.camera.y,
      visibleW: visibleH * (w / h),
      visibleH,
    });

    for (const f of world.fighters) {
      let target: { x: number; y: number } | null = null;
      let best = Infinity;
      for (const o of world.fighters) {
        if (o === f || !o.alive || o.vanished || o.team === f.team) continue;
        const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y) * 0.5;
        if (d < best) {
          best = d;
          target = o;
        }
      }
      this.models[f.index]?.update(f, alpha, this.time, dtFrames, target);
    }
    this.updateHalos(world);
    this.updateRibbons(world);
    this.updateProjectiles(world, alpha);
    this.updateItems(world);
    this.ambient(world, dtFrames);
    this.motionEffects(world);
    if (this.settings.debug) this.drawDebug(world, w, h);
    if (world.phase === "over" || world.phase === "finishing") this.victoryConfetti(world, dtFrames);

    this.hud.setVignette(world.phase === "finishing" || world.slowmo > 0 ? 1 : 0);
    this.fx.update(dtFrames);
    this.hud.update(world, this.projector, w, h, dtFrames, { ...hudOptions, uiScale: this.settings.uiScale });

    if (!this.warmed) this.prewarm();
    this.post.setImpact(this.hitMomentum * 0.0035 + this.koFlash * 0.004, 0, [1, 1, 1], this.koBlur, this.koX, this.koY);
    this.post.setVignette(world.phase === "finishing" ? 0.55 : this.baseVignette);
    this.post.render(dtMs / 1000);
    this.overlay.renderer.render(this.overlay.stage);
    (window as unknown as { __airBrawlStats?: () => unknown }).__airBrawlStats = () => this.stats();
    (window as unknown as { __airBrawlPrograms?: () => string[] }).__airBrawlPrograms = () => this.programNames();
    this.frameCounter += 1;
    this.lastRenderMs = performance.now() - start;
  }

  /**
   * Compile every shader variant the match can need, once, while the countdown covers it.
   * Before this, the first KO, the first shield, the first ghosted respawn and the first item each
   * compiled a program mid-fight: a 100-800 ms freeze that eats inputs (the "lag spike").
   * Everything hidden is shown for one off-screen frame (the effects pool and ghosted fighters
   * included) and put back exactly as it was.
   */
  private prewarm(): void {
    this.warmed = true;
    const hidden: Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    // Ghosting (respawn, invulnerable, vanish) flips a material to transparent, which is a different
    // shader program. A program nobody currently uses is deleted by three, so the first ghost after
    // an all-opaque stretch recompiled it mid-fight. Anchor meshes keep every ghost variant alive.
    if (!this.anchors) {
      this.anchors = new Group();
      const tiny = new PlaneGeometry(0.01, 0.01);
      for (const m of this.models) {
        for (const mat of m.warmMaterials()) {
          const ghost = mat.clone();
          ghost.transparent = true;
          ghost.opacity = 0.5;
          const mesh = new Mesh(tiny, ghost);
          mesh.frustumCulled = false;
          this.anchors.add(mesh);
        }
      }
      this.scene.add(this.anchors);
      hidden.push(this.anchors);
      this.anchors.visible = true;
    }
    try {
      this.renderer.compile(this.scene, this.cam);
      this.post.render(0);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }

  private placeCamera(w: number, h: number): void {
    const z = this.camera.scale;
    this.projector.px = z;
    const visibleH = h / z;
    const dist = visibleH / (2 * Math.tan((FOV * Math.PI) / 360));
    const sx = this.camera.shakeX / z;
    const sy = -this.camera.shakeY / z;
    const lookX = this.camera.x + sx;
    const lookY = -this.camera.y + sy;
    this.cam.aspect = w / h;
    this.cam.position.set(lookX + this.camera.x * 0.05, lookY + dist * 0.06, dist);
    this.cam.up.set(Math.sin(this.camera.roll), Math.cos(this.camera.roll), 0);
    this.cam.lookAt(lookX, lookY, 0);
    this.cam.setViewOffset(w, h, 0, this.camera.inset / 2, w, h);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }

  /* --------------------------------------------------------------- DRAWING */

  private updateHalos(world: World): void {
    for (const f of world.fighters) {
      const halo = this.halos[f.index];
      if (!halo) continue;
      const on = f.alive && f.state === "respawn" && f.sf >= 70;
      halo.visible = on;
      if (!on) continue;
      halo.position.set(f.x, -f.y, 0);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 0.18);
      (halo.userData.inner as Mesh).scale.setScalar(1 + pulse * 0.3);
      ((halo.userData.beam as Mesh).material as MeshBasicMaterial).opacity = 0.12 + 0.08 * pulse;
    }
  }

  private updateRibbons(world: World): void {
    for (const f of world.fighters) {
      const ribbon = this.ribbons[f.index];
      if (!ribbon) continue;
      const move = f.alive ? currentMove(f) : null;
      let active = false;
      let color = 0xffffff;
      let radius = 20;
      if (move && f.hitlag === 0) {
        for (const box of move.hitboxes) {
          if (f.sf < box.from || f.sf > box.to || box.grab) continue;
          const x = f.x + (box.x2 !== undefined ? (box.x + box.x2) / 2 : box.x) * f.facing;
          const y = f.y + (box.y2 !== undefined ? (box.y + box.y2) / 2 : box.y);
          ribbon.points.unshift({ x, y });
          active = true;
          color = FX_COLOR[box.fx ?? "impact"];
          radius = box.r;
          this.fx.flashGlow(x, y, color, box.r * 2.4);
          break;
        }
      }
      if (!active && ribbon.points.length) ribbon.points.pop();
      if (ribbon.points.length > Ribbon.N) ribbon.points.length = Ribbon.N;
      ribbon.update(color, radius * 1.0, active ? 1 : 0.7);
    }
  }

  private updateProjectiles(world: World, alpha: number): void {
    const stamp = world.frame;
    for (const p of world.projectiles) {
      let v = this.projectiles.get(p.id);
      if (!v) {
        v = this.makeProjectile(p, world);
        this.projectiles.set(p.id, v);
        this.dynamic.add(v.group);
      }
      v.seen = stamp;
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      v.group.position.set(x, -y, 22);
      const t = world.frame + p.id * 7;
      for (const [i, s] of v.spin.entries()) {
        s.rotation.z = t * (0.2 + i * 0.07) * (i % 2 === 0 ? 1 : -1);
      }
      if (v.look === "mine" && v.core) {
        const armed = p.age >= (p.def.arm ?? 0);
        (v.core.material as MeshBasicMaterial).color.setHex(armed ? (Math.sin(t * 0.4) > 0 ? 0xff4d6d : 0x802030) : 0x6b6b88);
      }
      if (v.look === "bomb" && v.core) {
        const fuse = p.age / p.def.ttl;
        (v.core.material as MeshBasicMaterial).color.setHex(Math.sin(t * (0.3 + fuse * 1.4)) > 0 ? 0xffd23d : 0xff6a2d);
      }
      if (v.look === "rock") v.group.rotation.set(t * 0.07, t * 0.05, t * 0.09);
      if (v.look === "bolt") {
        const ang = Math.atan2(-p.vy, p.vx);
        v.group.rotation.z = ang;
        if (world.frame % 2 === 0) this.fx.trail(x, y, "#ffffff", p.def.radius * 2.6);
      }
      if (v.look === "orb" && world.frame % 3 === 0) this.fx.trail(x, y, "#ffffff", p.def.radius * 2.2);
    }
    for (const [id, v] of this.projectiles) {
      if (v.seen !== stamp) {
        this.disposeGroup(v.group);
        this.projectiles.delete(id);
      }
    }
  }

  private makeProjectile(p: ProjectileEntity, world: World): ProjectileVisual {
    const owner = world.fighters[p.ownerIndex];
    const c = hexToNumber(slotStyle(owner?.slot ?? 0).color);
    const r = p.def.radius;
    const g = new Group();
    const spin: Group[] = [];
    let core: Mesh | undefined;
    const glow = (color: number, size: number, opacity: number) => {
      const m = new Mesh(
        new PlaneGeometry(size, size),
        new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, map: this.glowMap() }),
      );
      m.renderOrder = 8;
      g.add(m);
    };
    switch (p.def.look) {
      case "bolt": {
        const body = new Mesh(new SphereGeometry(r, 18, 12), new MeshBasicMaterial({ color: 0xffffff }));
        body.scale.x = 1.7;
        g.add(body);
        const shell = new Mesh(new SphereGeometry(r * 1.35, 18, 12), new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
        shell.scale.x = 2.1;
        g.add(shell);
        glow(c, r * 6.4, 0.7);
        break;
      }
      case "orb": {
        const body = new Mesh(new SphereGeometry(r * 0.8, 18, 12), new MeshBasicMaterial({ color: 0xffffff }));
        g.add(body);
        const shell = new Mesh(new SphereGeometry(r * 1.2, 18, 12), new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false }));
        g.add(shell);
        const orbit = new Group();
        for (let i = 0; i < 3; i += 1) {
          const s = new Mesh(new SphereGeometry(r * 0.2, 8, 6), new MeshBasicMaterial({ color: 0xffffff }));
          const a = (i / 3) * Math.PI * 2;
          s.position.set(Math.cos(a) * r * 1.6, Math.sin(a) * r * 1.6, 0);
          orbit.add(s);
        }
        g.add(orbit);
        spin.push(orbit);
        glow(c, r * 6, 0.65);
        break;
      }
      case "disc": {
        const disc = new Group();
        const ring = new Mesh(new TorusGeometry(r, r * 0.16, 8, 32), new MeshBasicMaterial({ color: c }));
        disc.add(ring);
        for (let i = 0; i < 4; i += 1) {
          const blade = new Mesh(new OctahedronGeometry(r * 0.32), new MeshBasicMaterial({ color: 0xffffff }));
          const a = (i / 4) * Math.PI * 2;
          blade.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
          blade.scale.set(1.8, 0.5, 0.5);
          blade.rotation.z = a + Math.PI / 2;
          disc.add(blade);
        }
        g.add(disc);
        spin.push(disc);
        glow(c, r * 5, 0.5);
        break;
      }
      case "mine": {
        const shell = new Mesh(new SphereGeometry(r * 1.1, 16, 12), new MeshStandardMaterial({ color: 0x1a1230, metalness: 0.7, roughness: 0.3 }));
        g.add(shell);
        core = new Mesh(new SphereGeometry(r * 0.45, 12, 8), new MeshBasicMaterial({ color: 0x6b6b88 }));
        core.position.z = r * 0.7;
        g.add(core);
        const ring = new Mesh(new TorusGeometry(r * 1.25, r * 0.07, 6, 28), new MeshBasicMaterial({ color: c }));
        g.add(ring);
        break;
      }
      case "rock": {
        const geo = new IcosahedronGeometry(r, 1);
        g.add(new Mesh(geo, new MeshStandardMaterial({ color: 0x7a7f98, roughness: 0.9, metalness: 0.05, flatShading: true })));
        break;
      }
      case "bomb": {
        g.add(new Mesh(new SphereGeometry(r, 18, 12), new MeshStandardMaterial({ color: 0x14141f, metalness: 0.6, roughness: 0.35 })));
        core = new Mesh(new SphereGeometry(r * 0.28, 8, 6), new MeshBasicMaterial({ color: 0xff6a2d }));
        core.position.set(r * 0.2, r * 1.05, 0);
        g.add(core);
        glow(0xff7b3d, r * 4, 0.4);
        break;
      }
      default:
        g.add(new Mesh(new SphereGeometry(r, 14, 10), new MeshBasicMaterial({ color: c })));
    }
    return { group: g, seen: world.frame, look: p.def.look, spin, core };
  }

  private glowTex: CanvasTexture | null = null;
  private glowMap(): CanvasTexture {
    if (this.glowTex) return this.glowTex;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.4)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    this.glowTex = new CanvasTexture(c);
    return this.glowTex;
  }

  private updateItems(world: World): void {
    const stamp = world.frame;
    for (const item of world.items) {
      let entry = this.items.get(item.id);
      if (!entry) {
        const info = ITEMS[item.kind];
        const c = hexToNumber(info.color);
        const g = new Group();
        const gem = new Mesh(new OctahedronGeometry(15), new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.3 }));
        const ring = new Mesh(new TorusGeometry(26, 2.4, 8, 36), new MeshBasicMaterial({ color: c }));
        const shadow = new Mesh(new PlaneGeometry(50, 14), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
        shadow.rotation.x = -Math.PI / 2;
        g.add(gem, ring);
        g.userData = { gem, ring, shadow };
        this.dynamic.add(g, shadow);
        g.userData.shadowMesh = shadow;
        entry = { group: g, seen: stamp };
        this.items.set(item.id, entry);
      }
      entry.seen = stamp;
      const bob = Math.sin((world.frame + item.id * 11) * 0.09) * 6;
      const y = item.y - 34 + (item.grounded ? bob : 0);
      entry.group.position.set(item.x, -y, 10);
      (entry.group.userData.gem as Mesh).rotation.y = world.frame * 0.05 + item.id;
      (entry.group.userData.ring as Mesh).rotation.x = world.frame * 0.03;
      const shadow = entry.group.userData.shadowMesh as Mesh;
      shadow.position.set(item.x, -item.y + 2, 10);
      entry.group.visible = !(item.ttl < 300 && Math.floor(world.frame / 6) % 2 === 0);
    }
    for (const [id, v] of this.items) {
      if (v.seen !== stamp) {
        (v.group.userData.shadowMesh as Mesh).removeFromParent();
        this.disposeGroup(v.group);
        this.items.delete(id);
      }
    }
  }

  private ambient(world: World, dtFrames: number): void {
    const b = world.stage.camera;
    const decor = world.stage.theme.decor;
    this.emberTimer += dtFrames;
    if (decor === "foundry" && this.emberTimer > 1.4) {
      this.emberTimer = 0;
      this.fx.ambientEmber(b.left + Math.random() * (b.right - b.left), b.bottom - 40, Math.random() < 0.5 ? 0xff7a2d : 0xffc24d);
    }
    this.moteTimer += dtFrames;
    if (decor !== "foundry" && this.moteTimer > 3) {
      this.moteTimer = 0;
      const x = this.camera.x + (Math.random() - 0.5) * 1800;
      const y = this.camera.y + (Math.random() - 0.5) * 900;
      this.fx.ambientMote(x, y, decor === "skyline" ? 0xff9cf2 : 0xcfe6ff, -120 + Math.random() * 80);
    }
  }

  private motionEffects(world: World): void {
    for (const f of world.fighters) {
      if (!f.alive || f.vanished) continue;
      const style = slotStyle(f.slot);
      const speed = Math.hypot(f.vx, f.vy);
      if (f.state === "hitstun" && f.hitlag === 0 && speed > 9) {
        this.fx.launchTrail(f.x, f.y - f.def.height * 0.5, f.vx, f.vy, style.color);
        if (speed > 16 && world.frame % 2 === 0) this.fx.speedLines(f.x, f.y, f.vx > 0 ? 1 : -1, style.color);
      } else if (f.state === "run" && world.frame % 7 === 0) {
        this.fx.dust(f.x, f.y, Math.sign(f.vx), 0.7);
      } else if (f.buffSpeed > 0 && speed > 4 && world.frame % 3 === 0) {
        this.fx.trail(f.x, f.y - f.def.height * 0.5, "#37f2d0", 60);
      }
      if ((f.state === "special" || f.state === "airSpecial") && Math.abs(f.vx) > 12 && world.frame % 2 === 0) {
        this.fx.trail(f.x, f.y - f.def.height * 0.5, style.color, 90);
      }
      if (f.state === "respawn" && f.sf >= 70 && world.frame % 4 === 0) this.fx.beam(f.x, f.y, style.color);
    }
  }

  private victoryConfetti(world: World, dtFrames: number): void {
    this.confettiTimer += dtFrames;
    if (this.confettiTimer < 2.2) return;
    this.confettiTimer = 0;
    for (const index of world.winners) {
      const f = world.fighters[index];
      if (!f) continue;
      const style = slotStyle(f.slot);
      this.fx.confetti(f.x, f.y - 700, style.color, style.shape);
    }
  }

  private drawDebug(world: World, w: number, h: number): void {
    const g = this.debugGfx;
    g.clear();
    const P = (x: number, y: number) => this.projector.toScreen(x, y, w, h);
    const rect = (x0: number, y0: number, x1: number, y1: number, width: number, color: number, alpha: number) => {
      const a = P(x0, y0);
      const b = P(x1, y0);
      const c = P(x1, y1);
      const d = P(x0, y1);
      g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).stroke({ width, color, alpha });
    };
    const circle = (x: number, y: number, r: number, width: number, color: number) => {
      const p = P(x, y);
      g.circle(p.x, p.y, r * this.projector.scale).stroke({ width, color });
    };
    const b = world.stage.blast;
    rect(b.left, b.top, b.right, b.bottom, 3, 0xff3b3b, 0.8);
    const cb = world.stage.camera;
    rect(cb.left, cb.top, cb.right, cb.bottom, 2, 0x4aa8ff, 0.6);
    for (const p of world.platforms) rect(p.x, p.y, p.x + p.def.w, p.y + p.def.h, 2, p.def.solid ? 0xffffff : 0x9be8ff, 0.9);
    world.ledges.forEach((ledge) => {
      const p = world.platforms[ledge.platform];
      circle(ledge.side === -1 ? p.x : p.x + p.def.w, p.y, 10, 3, ledge.occupant >= 0 ? 0xff4d4d : 0x7dff5c);
    });
    for (const f of world.fighters) {
      if (!f.alive) continue;
      rect(f.x - f.def.halfWidth, f.y - f.def.height, f.x + f.def.halfWidth, f.y, 2, f.invuln > 0 ? 0x4aa8ff : 0x7dff5c, 0.95);
      const c = P(f.x, f.y - f.def.height / 2);
      const e = P(f.x + f.vx * 5, f.y - f.def.height / 2 + f.vy * 5);
      g.moveTo(c.x, c.y).lineTo(e.x, e.y).stroke({ width: 2, color: 0xffd23d });
      const move = currentMove(f);
      if (move) {
        for (const box of move.hitboxes) {
          if (f.sf < box.from || f.sf > box.to) continue;
          const samples = box.x2 !== undefined ? 3 : 1;
          for (let s = 0; s < samples; s += 1) {
            const t = samples === 1 ? 0 : s / (samples - 1);
            const bx = box.x + ((box.x2 ?? box.x) - box.x) * t;
            const by = box.y + ((box.y2 ?? box.y) - box.y) * t;
            circle(f.x + bx * f.facing, f.y + by, box.r, 3, 0xff3b3b);
          }
        }
      }
      const label = this.debugTexts[f.index];
      if (label) {
        label.text = `${f.def.id} ${f.state}${f.moveId ? `:${f.moveId}` : ""} f${f.sf}\n${Math.round(f.percent)}% v(${f.vx.toFixed(1)},${f.vy.toFixed(1)}) hl${f.hitlag} hs${f.hitstun}`;
        const lp = P(f.x - 60, f.y + 14);
        label.position.set(lp.x, lp.y);
      }
    }
  }

  destroy(): void {
    this.reset();
    this.fx.dispose();
    this.post.dispose();
    this.renderer.dispose();
    this.overlay.destroy(false, { children: true });
    this.glCanvas.remove();
    this.overlayCanvas.remove();
  }
}
