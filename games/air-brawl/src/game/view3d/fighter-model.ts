import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
  type MeshStandardMaterial,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ITEMS } from "../data/items";
import type { Fighter, FighterDef, FighterId } from "../sim/types";
import { hexToNumber, mixHex, type SlotStyle } from "../view/palette";
import { PoseDriver, type ArmPose, type LegPose, type Pose } from "./anim";
import { cone, ellipsoid, mesh, roundedBox, seg, stdMat } from "./geo";
import { makeLimb } from "./skin";

const sphere = (r: number, w = 16, h = 12): SphereGeometry => new SphereGeometry(r, seg(w, 8), seg(h, 6));

/** Turn angle: 3/4 view so the body reads in depth rather than as a flat card. */
const YAW = 1.2;
const PI = Math.PI;

interface Palette {
  main: number;
  dark: number;
  light: number;
  accent: number;
  suit: number;
  skin: number;
  /** Secondary fighter colour (trim panels) independent of the player's slot colour. */
  alt: number;
}

const paletteFor = (id: FighterId, style: SlotStyle): Palette => {
  const main = hexToNumber(style.color);
  const light = hexToNumber(style.light);
  const dark = hexToNumber(mixHex(style.dark, "#1b2038", 0.35));
  const suitOf = (mix: string, t: number) => hexToNumber(mixHex(style.color, mix, t));
  switch (id) {
    case "volt":
      return { main, dark, light, accent: 0xffe14d, suit: suitOf("#1c2540", 0.72), skin: 0xf2c6a0, alt: 0xf4f0e6 };
    case "bulwark":
      return { main, dark, light, accent: 0xffa24d, suit: suitOf("#2a2f40", 0.68), skin: 0xd9a77e, alt: 0xcfc6b4 };
    case "wisp":
      return { main, dark, light, accent: 0xf4d4ff, suit: suitOf("#2a1a55", 0.6), skin: 0x120a24, alt: 0xe6dcff };
    case "nova":
    default:
      return { main, dark, light, accent: 0x7cf0ff, suit: suitOf("#222a45", 0.64), skin: 0xf0c9a8, alt: 0xe9eef8 };
  }
};

const shieldMaterial = (color: number): ShaderMaterial =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { c: { value: new Color(color) }, k: { value: 1 }, t: { value: 0 }, hit: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 c; uniform float k; uniform float t; uniform float hit; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float hexLine(vec2 p){
        p *= 3.2; vec2 q = vec2(p.x*1.1547, p.y + p.x*0.5773);
        vec2 f = abs(fract(q) - 0.5);
        return smoothstep(0.42, 0.5, max(f.x, f.y));
      }
      void main(){
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float hx = hexLine(vP.xy * 0.045 + vec2(t * 0.05, 0.0)) * (0.6 + 0.4*sin(vP.y*0.07 - t*0.9));
        float wobble = 0.5 + 0.5 * sin(vP.y * 0.12 + vP.x * 0.09 - t * 1.4);
        float a = (0.09 + fr*1.25 + hx*0.2 + wobble*0.04 + hit*0.55) * k;
        gl_FragColor = vec4(c * (0.75 + fr + hit*0.8), a);
      }`,
  });

/** Spring-chain used for scarves, tails and capes. Swings in the model's forward/up plane. */
class Chain {
  readonly root = new Group();
  private readonly links: Group[] = [];
  private readonly angle: number[];
  private readonly vel: number[];
  constructor(count: number, build: (i: number, parent: Group) => number) {
    this.angle = new Array(count).fill(0);
    this.vel = new Array(count).fill(0);
    let parent: Group = this.root;
    const lengths: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const link = new Group();
      lengths.push(build(i, link));
      parent.add(link);
      this.links.push(link);
      parent = link;
    }
    for (let i = 1; i < count; i += 1) this.links[i].position.y = -lengths[i - 1];
  }
  update(time: number, base: number, drive: number, stiffness: number, wave: number): void {
    let carry = 0;
    for (let i = 0; i < this.links.length; i += 1) {
      const target = base * (1 - i * 0.12) + drive * (0.5 + i * 0.35) + Math.sin(time * 0.14 - i * 0.7) * wave * (1 + i * 0.35);
      const accel = (target - this.angle[i] - carry * 0.15) * stiffness;
      this.vel[i] = (this.vel[i] + accel) * 0.86;
      this.angle[i] += this.vel[i];
      this.links[i].rotation.x = this.angle[i] - (i > 0 ? this.angle[i - 1] : 0) * 0.35;
      carry = this.angle[i];
    }
  }
}

interface ArmRig {
  upper: Object3D;
  fore: Object3D;
  hand: Group;
  side: number;
}
interface LegRig {
  thigh: Object3D;
  shin: Object3D;
  foot: Group;
}
interface Mats {
  suit: MeshStandardMaterial;
  armor: MeshStandardMaterial;
  armorDark: MeshStandardMaterial;
  alt: MeshStandardMaterial;
  trim: MeshStandardMaterial;
  skin: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  hair: MeshStandardMaterial;
  white: MeshStandardMaterial;
  dark: MeshStandardMaterial;
}

interface FaceRig {
  eyes: { m: Mesh; sx: number; sy: number; sz: number; ry: number; side: number }[];
  pupils: { m: Mesh; x: number; y: number; s: number; reach: number }[];
  brows: { m: Mesh; side: number; y: number; rz: number }[];
  mouth?: { m: Mesh; sx: number; sy: number };
  glowMats: MeshStandardMaterial[];
}

interface Dims {
  hip: number;
  thigh: number;
  shin: number;
  upper: number;
  fore: number;
  shoulder: number;
  hipW: number;
  limb: number;
}

const DIMS: Record<FighterId, Dims> = {
  nova: { hip: 46, thigh: 24, shin: 22.5, upper: 15, fore: 14, shoulder: 13.5, hipW: 9.6, limb: 1.0 },
  volt: { hip: 48, thigh: 25, shin: 23.5, upper: 14.5, fore: 14, shoulder: 11.6, hipW: 8.4, limb: 0.9 },
  bulwark: { hip: 39, thigh: 20.5, shin: 19.5, upper: 16.5, fore: 15.5, shoulder: 19, hipW: 12, limb: 1.55 },
  wisp: { hip: 36, thigh: 18, shin: 18, upper: 14, fore: 13, shoulder: 12, hipW: 8, limb: 0.82 },
};

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function latheOf(profile: [number, number][], segments = 28): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
}

/** Merge the static meshes directly under `group` by material (keeps `userData.keep` meshes live). */
const bake = (group: Object3D): void => {
  const buckets = new Map<Material, BufferGeometry[]>();
  const casts = new Map<Material, boolean>();
  const move: Mesh[] = [];
  for (const child of group.children) {
    const m = child as Mesh;
    if (!m.isMesh || (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh || m.userData.keep || Array.isArray(m.material)) continue;
    move.push(m);
  }
  for (const m of move) {
    m.updateMatrix();
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    if (!g.getAttribute("uv")) {
      const n = g.getAttribute("position").count;
      g.setAttribute("uv", new (g.getAttribute("position").constructor as new (a: Float32Array, n: number) => never)(new Float32Array(n * 2), 2));
    }
    g = g.applyMatrix4(new Matrix4().copy(m.matrix));
    const list = buckets.get(m.material as Material) ?? [];
    list.push(g);
    buckets.set(m.material as Material, list);
    casts.set(m.material as Material, m.castShadow || casts.get(m.material as Material) === true);
    group.remove(m);
  }
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mm = new Mesh(merged, mat);
    mm.castShadow = casts.get(mat) ?? true;
    group.add(mm);
  }
};

export class FighterModel {
  readonly root = new Group();
  private readonly pivot = new Group();
  private readonly stretchA = new Group();
  private readonly stretchB = new Group();
  private readonly stretchC = new Group();
  private readonly offset = new Group();
  private readonly facingGroup = new Group();
  private readonly body = new Group();
  private readonly pelvis = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly detail = new Group();
  private readonly arms: [ArmRig, ArmRig];
  private readonly legs: [LegRig, LegRig];
  private readonly chains: { chain: Chain; kind: "scarf" | "tail" | "cape"; base: number }[] = [];
  private readonly spinners: Group[] = [];
  private readonly shield: Mesh;
  private readonly shieldMat: ShaderMaterial;
  private readonly aura: Mesh;
  private readonly auraMat: MeshBasicMaterial;
  private readonly heldItem: Mesh;
  private readonly mats: MeshStandardMaterial[] = [];
  private readonly driver: PoseDriver;
  private face: FaceRig;
  private facing = 1;
  private lastX = 0;
  private lastVx = 0;
  private transparent = false;
  private flashed = false;
  private blink = 0;
  private blinkClock = 90;
  private lookX = 0;
  private lookY = 0;
  private lastPercent = 0;
  private hitSquash = 0;
  /** Latest smoothed pose (read by the view to place smears/after-images). */
  pose: Pose | null = null;
  readonly trail: { x: number; y: number }[] = [];

  /** Unit = 1 % of visual height. */
  private readonly u: number;
  private readonly hipH: number;
  private readonly L1: number;
  private readonly L2: number;
  private readonly A1: number;
  private readonly A2: number;
  private readonly shoulderUp: number;
  private readonly floats: boolean;
  private readonly H: number;
  readonly palette: Palette;

  constructor(
    readonly def: FighterDef,
    readonly style: SlotStyle,
  ) {
    const H = def.height * def.scale * 1.04;
    const u = H / 100;
    this.u = u;
    this.H = H;
    this.palette = paletteFor(def.id, style);
    this.floats = def.id === "wisp";
    const dims = DIMS[def.id];
    this.hipH = dims.hip * u;
    this.L1 = dims.thigh * u;
    this.L2 = dims.shin * u;
    this.A1 = dims.upper * u;
    this.A2 = dims.fore * u;
    this.shoulderUp = this.hipH + 29 * u;

    this.root.add(this.pivot);
    this.pivot.position.y = H * 0.5;
    this.pivot.add(this.stretchA);
    this.stretchA.add(this.stretchB);
    this.stretchB.add(this.stretchC);
    this.stretchC.add(this.offset);
    this.offset.position.y = -H * 0.5;
    this.offset.add(this.facingGroup);
    this.facingGroup.add(this.body);
    this.body.position.y = this.hipH;
    this.body.add(this.pelvis);
    this.pelvis.add(this.torso);
    this.torso.position.y = 3 * u;
    this.torso.rotation.order = "YXZ";
    this.body.add(this.detail);

    const built = this.build(u, dims);
    this.arms = built.arms;
    this.legs = built.legs;
    this.head = built.head;
    this.face = built.face;

    this.shieldMat = shieldMaterial(hexToNumber(style.color));
    this.shield = new Mesh(sphere(1, 40, 24), this.shieldMat);
    this.shield.visible = false;
    this.shield.renderOrder = 5;
    this.root.add(this.shield);
    this.auraMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: BackSide });
    this.aura = new Mesh(sphere(1, 20, 14), this.auraMat);
    this.aura.scale.set(def.halfWidth * 1.8, H * 0.62, def.halfWidth * 1.8);
    this.aura.position.y = H * 0.5;
    this.aura.renderOrder = 4;
    this.root.add(this.aura);
    this.heldItem = new Mesh(sphere(def.halfWidth * 0.3, 14, 10), new MeshBasicMaterial({ color: 0xffffff }));
    this.heldItem.visible = false;
    this.root.add(this.heldItem);

    this.driver = new PoseDriver({ shoulderX: 4, shoulderY: -this.shoulderUp, armLen: this.A1 + this.A2, hipHeight: this.hipH }, def.id);
  }

  private mat(color: number, o: Parameters<typeof stdMat>[1] = {}): MeshStandardMaterial {
    const m = stdMat(color, o);
    this.mats.push(m);
    return m;
  }

  /* ------------------------------------------------------------------ BUILD */

  private build(u: number, dims: Dims): { arms: [ArmRig, ArmRig]; legs: [LegRig, LegRig]; head: Group; face: FaceRig } {
    const id = this.def.id;
    const p = this.palette;
    const bulky = id === "bulwark";
    const lean = id === "volt";
    const wisp = id === "wisp";
    const rimC = p.light;

    const m: Mats = {
      suit: this.mat(p.suit, { roughness: 0.56, metalness: 0.1, rim: rimC, rimStrength: 0.24, envMapIntensity: 1.1 }),
      armor: this.mat(p.main, { roughness: 0.26, metalness: 0.4, rim: rimC, rimStrength: 0.32, envMapIntensity: 1.5 }),
      armorDark: this.mat(p.dark, { roughness: 0.36, metalness: 0.5, rim: rimC, rimStrength: 0.22, envMapIntensity: 1.3 }),
      alt: this.mat(p.alt, { roughness: 0.4, metalness: 0.15, rim: 0xffffff, rimStrength: 0.18, envMapIntensity: 1.1 }),
      trim: this.mat(p.accent, { roughness: 0.3, metalness: 0.2, emissive: p.accent, emissiveIntensity: 1.3, rim: 0xffffff, rimStrength: 0.1 }),
      hair: this.mat(p.accent, { roughness: 0.4, metalness: 0.1, emissive: p.accent, emissiveIntensity: 0.18, rim: 0xfff4b0, rimStrength: 0.25 }),
      skin: this.mat(p.skin, { roughness: 0.66, metalness: 0, rim: 0xffe0cc, rimStrength: 0.14, envMapIntensity: 0.6 }),
      glass: this.mat(0x0b1228, { roughness: 0.08, metalness: 0.9, rim: rimC, rimStrength: 0.35, envMapIntensity: 2.2 }),
      white: this.mat(0xf4f6ff, { roughness: 0.3, metalness: 0, rim: 0xffffff, rimStrength: 0.1 }),
      dark: this.mat(0x14121c, { roughness: 0.5, metalness: 0.3, rimStrength: 0.1 }),
    };

    const k = dims.limb;
    const sx = dims.shoulder;
    const hipW = dims.hipW;

    /* ---- pelvis & legs ---- */
    if (!wisp) {
      const pelvisMesh = mesh(ellipsoid(hipW * 1.02 * u, 5.8 * u, (bulky ? 8.8 : 6.8) * u, 22), m.suit);
      this.pelvis.add(pelvisMesh);
      const belt = mesh(roundedBox(hipW * 2.15 * u, 3.4 * u, (bulky ? 17.5 : 13.8) * u, 1.3 * u), bulky ? m.trim : m.armorDark);
      belt.position.y = 4 * u;
      this.pelvis.add(belt);
      const buckle = mesh(roundedBox(4.4 * u, 3.2 * u, 1.8 * u, 0.7 * u), m.trim, false);
      buckle.position.set(0, 4 * u, (bulky ? 8.9 : 7.1) * u);
      this.pelvis.add(buckle);
      if (id === "nova" || bulky) {
        for (const s of [-1, 1]) {
          const pouch = mesh(roundedBox(3.8 * u, 5.4 * u, 5.8 * u, 1 * u), m.armorDark);
          pouch.position.set(s * (hipW + 1.4) * u, 0.4 * u, 1 * u);
          this.pelvis.add(pouch);
        }
      }
      if (lean) {
        const hip = mesh(roundedBox(hipW * 2.3 * u, 2.6 * u, 3 * u, 0.8 * u), m.alt);
        hip.position.set(0, 1.5 * u, -6 * u);
        this.pelvis.add(hip);
      }
    }
    const makeLeg = (side: number): LegRig => {
      const pivot = new Group();
      pivot.position.set(side * hipW * 0.62 * u, -1.5 * u, 0);
      this.pelvis.add(pivot);
      const L1 = this.L1;
      const L2 = this.L2;
      const foot = new Group();
      if (wisp) {
        const stub = makeLimb({ l1: L1, l2: L2, radius: (t) => (5.5 - t * 3.5) * k * u }, m.suit);
        stub.mesh.visible = false;
        pivot.add(stub.mesh);
        stub.fore.add(foot);
        foot.position.y = -L2;
        return { thigh: stub.upper, shin: stub.fore, foot };
      }
      const swell = bulky ? 0.2 : lean ? 0.04 : 0.15;
      const legArmor = id === "volt" ? m.suit : m.armor;
      const limb = makeLimb(
        {
          l1: L1,
          l2: L2,
          radius: (t) => {
            const thigh = 8.4 - t * 5.0;
            const calf = Math.sin(Math.min(1, Math.max(0, (t - 0.5) * 3.1))) * 0.9;
            const bulge = 1 + swell * (smooth(0.03, 0.12, t) - smooth(0.34, 0.42, t)) + swell * 1.2 * (smooth(0.5, 0.6, t) - smooth(0.84, 0.92, t));
            return (thigh + calf) * k * u * bulge;
          },
          band: (t) => (t < 0.05 ? 0 : t < 0.37 ? 1 : t < 0.5 ? 0 : t < 0.86 ? 2 : 3),
        },
        [m.suit, legArmor, id === "volt" ? m.armorDark : m.armor, m.armorDark],
      );
      pivot.add(limb.mesh);
      const rK = 5.6 * k * u;
      const rA = 4.0 * k * u;
      const kneeCap = mesh(ellipsoid(rK * 1.0, rK * 0.95, rK * 0.5, 14), id === "volt" ? m.armorDark : m.armor);
      kneeCap.position.set(0, -L1 + 0.6 * u, rK * 1.0);
      limb.upper.add(kneeCap);
      // Boot: heel block + rounded toe cap, sole stripe.
      const boot = mesh(roundedBox(rA * 2.7, 5 * u, (bulky ? 18 : 15) * u, 1.8 * u), id === "volt" ? m.alt : m.armorDark);
      boot.position.set(0, -L2 - 0.2 * u, 3.6 * u);
      foot.add(boot);
      const toe = mesh(ellipsoid(rA * 1.45, 3 * u, 4.4 * u), id === "volt" ? m.alt : m.armor);
      toe.position.set(0, -L2 + 0.3 * u, 10.2 * u);
      foot.add(toe);
      const sole = mesh(roundedBox(rA * 2.8, 1.2 * u, (bulky ? 18.4 : 15.4) * u, 0.5 * u), m.trim, false);
      sole.position.set(0, -L2 - 2.8 * u, 3.6 * u);
      foot.add(sole);
      limb.fore.add(foot);
      foot.position.y = 0;
      bake(foot);
      return { thigh: limb.upper, shin: limb.fore, foot };
    };
    const legs: [LegRig, LegRig] = [makeLeg(-1), makeLeg(1)];

    /* ---- torso ---- */
    const abd = mesh(ellipsoid(hipW * 0.86 * u, 6.8 * u, (bulky ? 9.2 : 6.4) * u, 22), m.suit);
    abd.position.y = 6 * u;
    this.torso.add(abd);
    const chestRX = (bulky ? 16.5 : lean ? 10.4 : 11.8) * u;
    const chestRY = (bulky ? 11.8 : 9.8) * u;
    const chestRZ = (bulky ? 11.4 : lean ? 6.8 : 8) * u;
    const chestY = 19 * u;
    const chest = mesh(ellipsoid(chestRX, chestRY, chestRZ, 28), m.suit);
    chest.position.y = chestY;
    this.torso.add(chest);
    const girdle = mesh(ellipsoid(chestRX * 1.08, 4.6 * u, chestRZ * 0.88, 24), m.suit);
    girdle.position.y = 26.8 * u;
    this.torso.add(girdle);

    if (id === "nova") {
      const plate = mesh(roundedBox(chestRX * 1.66, chestRY * 1.62, chestRZ * 1.0, 2.6 * u), m.armor);
      plate.position.set(0, chestY + 0.5 * u, chestRZ * 0.55);
      plate.rotation.x = -0.08;
      this.torso.add(plate);
      const stripe = mesh(roundedBox(chestRX * 0.34, chestRY * 1.5, chestRZ * 0.2, 0.8 * u), m.alt);
      stripe.position.set(0, chestY + 0.5 * u, chestRZ * 1.08);
      this.torso.add(stripe);
      const core = mesh(sphere(3.6 * u, 18, 12), m.trim, false);
      core.position.set(0, chestY + 2 * u, chestRZ * 1.04);
      core.scale.z = 0.5;
      this.torso.add(core);
      const ring = mesh(new TorusGeometry(4.8 * u, 0.75 * u, 8, 24), m.armorDark, false);
      ring.position.copy(core.position);
      this.torso.add(ring);
      for (let i = 0; i < 3; i += 1) {
        const ab = mesh(roundedBox(10.8 * u - i * 1.3 * u, 2.7 * u, 6.4 * u, 0.9 * u), m.armorDark);
        ab.position.set(0, (10.5 - i * 3) * u, 5.4 * u);
        this.torso.add(ab);
      }
      const pack = mesh(roundedBox(chestRX * 1.36, 18 * u, 8.4 * u, 2 * u), m.armorDark);
      pack.position.set(0, chestY - 0.5 * u, -chestRZ * 1.15);
      this.torso.add(pack);
      for (const s of [-1, 1]) {
        const t = mesh(sphere(2.4 * u, 12, 8), m.trim, false);
        t.position.set(s * chestRX * 0.4, chestY - 9.8 * u, -chestRZ * 1.25);
        this.torso.add(t);
        const strap = mesh(roundedBox(2.4 * u, chestRY * 1.9, 1 * u, 0.4 * u), m.alt);
        strap.position.set(s * chestRX * 0.55, chestY + 1 * u, chestRZ * 0.98);
        strap.rotation.z = s * 0.12;
        this.torso.add(strap);
      }
    } else if (id === "volt") {
      const vest = mesh(ellipsoid(chestRX * 1.08, chestRY * 0.82, chestRZ * 1.14, 22), m.armor);
      vest.position.set(0, chestY + 1.2 * u, chestRZ * 0.12);
      this.torso.add(vest);
      const collar = mesh(new TorusGeometry(chestRX * 0.52, 1.7 * u, 8, 20), m.alt);
      collar.rotation.x = PI / 2;
      collar.position.set(0, chestY + chestRY * 0.85, 0);
      this.torso.add(collar);
      const bolt = new Shape();
      bolt.moveTo(0.22, 1).lineTo(-0.5, -0.05).lineTo(-0.05, -0.05).lineTo(-0.28, -1).lineTo(0.5, 0.1).lineTo(0.06, 0.1).closePath();
      const boltGeo = new ExtrudeGeometry(bolt, { depth: 0.25, bevelEnabled: false });
      boltGeo.scale(5.4 * u, 5.4 * u, 5.4 * u);
      const boltMesh = mesh(boltGeo, m.trim, false);
      boltMesh.position.set(0, chestY - 0.5 * u, chestRZ * 1.14);
      this.torso.add(boltMesh);
      for (const s of [-1, 1]) {
        const stripe = mesh(roundedBox(1.6 * u, chestRY * 1.5, 1.2 * u, 0.5 * u), m.alt);
        stripe.position.set(s * chestRX * 0.72, chestY, chestRZ * 0.95);
        this.torso.add(stripe);
      }
    } else if (bulky) {
      const plate = mesh(roundedBox(chestRX * 1.84, chestRY * 1.66, chestRZ * 1.12, 3.6 * u), m.armor);
      plate.position.set(0, chestY + 1.2 * u, chestRZ * 0.52);
      this.torso.add(plate);
      for (let i = 0; i < 3; i += 1) {
        const rivet = mesh(sphere(1.2 * u, 8, 6), m.trim, false);
        rivet.position.set((-0.55 + i * 0.55) * chestRX, chestY + chestRY * 0.85, chestRZ * 1.1);
        this.torso.add(rivet);
      }
      const plate2 = mesh(roundedBox(chestRX * 1.3, 5.4 * u, chestRZ * 0.95, 1.5 * u), m.armorDark);
      plate2.position.set(0, 9 * u, chestRZ * 0.62);
      this.torso.add(plate2);
      const emblem = mesh(new TorusGeometry(5 * u, 1.1 * u, 8, 6), m.trim, false);
      emblem.position.set(0, chestY + 1 * u, chestRZ * 1.1);
      this.torso.add(emblem);
      const buckle = mesh(roundedBox(7.4 * u, 5.8 * u, 2.8 * u, 1 * u), m.trim, false);
      buckle.position.set(0, 0.6 * u, 9.2 * u);
      this.torso.add(buckle);
      for (const s of [-1, 1]) {
        const skirt = mesh(roundedBox(9.6 * u, 15 * u, 2.6 * u, 1 * u), m.armorDark);
        skirt.position.set(s * 6.8 * u, -8 * u, 7.4 * u);
        skirt.rotation.x = 0.1;
        this.pelvis.add(skirt);
      }
      const back = mesh(roundedBox(chestRX * 1.5, 16 * u, 6 * u, 2 * u), m.armorDark);
      back.position.set(0, chestY, -chestRZ * 1.1);
      this.torso.add(back);
    } else {
      // Wisp: bell-shaped spirit robe - slim shoulders flaring into a wide hem, ribbon tails, floating halo.
      const robe = mesh(
        latheOf(
          [
            [0.01, 45 * u],
            [8.6 * u, 43.5 * u],
            [11.2 * u, 37 * u],
            [10.2 * u, 28 * u],
            [10.6 * u, 18 * u],
            [12.6 * u, 8 * u],
            [16.6 * u, -3 * u],
            [22 * u, -15 * u],
            [27 * u, -26 * u],
            [29.5 * u, -34 * u],
            [28 * u, -37 * u],
          ],
          40,
        ),
        m.suit,
      );
      robe.scale.z = 0.8;
      this.torso.add(robe);
      const hem = mesh(new TorusGeometry(28.8 * u, 1.9 * u, 8, 48), m.alt);
      hem.rotation.x = PI / 2;
      hem.scale.set(1, 0.8, 1);
      hem.position.y = -36 * u;
      this.torso.add(hem);
      const hem2 = mesh(new TorusGeometry(22.6 * u, 1.1 * u, 6, 40), m.trim, false);
      hem2.rotation.x = PI / 2;
      hem2.scale.set(1, 0.8, 1);
      hem2.position.y = -15.5 * u;
      this.torso.add(hem2);
      const sash = mesh(new TorusGeometry(11.6 * u, 1.9 * u, 8, 32), m.trim, false);
      sash.rotation.x = PI / 2;
      sash.scale.set(1, 0.8, 1);
      sash.position.y = 6 * u;
      this.torso.add(sash);
      const gem = mesh(sphere(3.4 * u, 16, 12), m.trim, false);
      gem.position.set(0, 6 * u, 9.6 * u);
      this.torso.add(gem);
      const collar = mesh(latheOf([[0.01, 0], [13.4 * u, 1 * u], [12 * u, 6.4 * u], [6 * u, 9.6 * u]], 28), m.armor);
      collar.position.y = 22.5 * u;
      collar.scale.z = 0.8;
      this.torso.add(collar);
      const halo = new Group();
      halo.add(mesh(new TorusGeometry(27 * u, 0.9 * u, 8, 56), m.trim, false));
      for (let i = 0; i < 3; i += 1) {
        const spark = mesh(sphere(2.4 * u, 10, 8), m.trim, false);
        const a2 = (i / 3) * PI * 2;
        spark.position.set(Math.cos(a2) * 27 * u, Math.sin(a2) * 27 * u, 0);
        halo.add(spark);
      }
      halo.position.set(0, chestY + 9 * u, -11 * u);
      halo.rotation.y = PI / 2;
      this.torso.add(halo);
      this.spinners.push(halo);
      // Ribbon tails fanned around the hem.
      for (let r = 0; r < 5; r += 1) {
        const ang = (r / 4 - 0.5) * 2.2;
        const tail = new Chain(4, (i, g) => {
          const w = (6.4 - i * 1.0) * u;
          const t = mesh(ellipsoid(w, (7.5 - i * 0.6) * u, 0.9 * u), r % 2 ? m.suit : m.alt);
          t.position.y = -7 * u;
          g.add(t);
          return 13 * u;
        });
        tail.root.position.set(Math.sin(ang) * 24 * u, -36 * u, Math.cos(ang) * 18 * u - 4 * u);
        this.torso.add(tail.root);
        this.chains.push({ chain: tail, kind: "tail", base: 0.05 * r });
      }
    }

    /* ---- neck & head ---- */
    if (!wisp) {
      const neck = mesh(ellipsoid(3.4 * k * u, 3.4 * u, 3.4 * k * u, 12), m.skin);
      neck.position.y = 33 * u;
      this.torso.add(neck);
    }
    const head = new Group();
    head.position.y = 41 * u;
    this.torso.add(head);
    const face = this.buildHead(head, m, u);

    /* ---- arms ---- */
    const shoulderY = 26.5 * u;
    const makeArm = (side: number): ArmRig => {
      const pivot = new Group();
      pivot.position.set(side * sx * u, shoulderY, 0);
      this.torso.add(pivot);
      const A1 = this.A1;
      const A2 = this.A2;
      const armSwell = wisp ? 0.1 : bulky ? 0.3 : lean ? 0.14 : 0.24;
      const limb = makeLimb(
        {
          l1: A1,
          l2: A2,
          radius: (t) => {
            const base = 5.0 - t * 1.8;
            const bulge = Math.sin(Math.min(1, t * 2.1) * PI) * 0.7;
            const bracer = 1 + armSwell * (smooth(0.48, 0.58, t) - smooth(0.86, 0.93, t));
            if (wisp) return (4.6 + smooth(0.4, 0.98, t) * 5.4) * k * u;
            return (base + bulge) * k * u * bracer;
          },
          band: (t) => (t < 0.5 ? 0 : t < 0.9 ? 1 : 2),
          blend: 0.14,
        },
        wisp ? [m.suit, m.suit, m.armor] : [m.suit, id === "volt" ? m.armorDark : m.armor, id === "volt" ? m.trim : m.armorDark],
      );
      pivot.add(limb.mesh);
      const rF = 3.6 * k * u;
      const hand = new Group();
      limb.fore.add(hand);
      hand.position.y = -A2;
      if (!wisp) {
        const sleeve = id === "volt" ? m.armorDark : m.suit;
        void sleeve;
        // Fist: palm block, curled finger row, thumb.
        const palm = mesh(roundedBox(rF * (bulky ? 2.9 : 2.5), rF * 2.2, rF * (bulky ? 2.9 : 2.5), rF * 0.7), id === "volt" ? m.alt : m.armorDark);
        palm.position.y = -rF * 0.9;
        hand.add(palm);
        const fingers = mesh(roundedBox(rF * (bulky ? 3.0 : 2.6), rF * 0.95, rF * 1.05, rF * 0.35), id === "volt" ? m.alt : m.armor);
        fingers.position.set(0, -rF * 1.55, rF * 0.95);
        hand.add(fingers);
        const thumb = mesh(ellipsoid(rF * 0.55, rF * 0.55, rF * 0.9, 10), id === "volt" ? m.alt : m.armor);
        thumb.position.set(-side * rF * 1.05, -rF * 0.55, rF * 0.7);
        hand.add(thumb);
        const knuckle = mesh(ellipsoid(rF * 0.9, rF * 0.38, rF * 0.5, 10), m.trim, false);
        knuckle.position.set(0, -rF * 0.5, rF * 1.4);
        hand.add(knuckle);
        const pr = (bulky ? 10.4 : lean ? 5.8 : 7.8) * u;
        const paul = mesh(new SphereGeometry(pr, 22, 14, 0, PI * 2, 0, PI * 0.66), lean ? m.armorDark : m.armor);
        paul.position.set(side * 0.6 * u, 1.4 * u, 0);
        paul.rotation.z = -side * 0.36;
        limb.upper.add(paul);
        if (bulky) {
          for (let s2 = 0; s2 < 3; s2 += 1) {
            const spike = mesh(cone(2.2 * u, (6 - s2) * u, 8), m.trim, false);
            spike.position.set(side * (6 + s2 * 1.4) * u, (7.4 - s2 * 1.8) * u, (s2 - 1) * 2.4 * u);
            spike.rotation.z = -side * (0.6 + s2 * 0.25);
            limb.upper.add(spike);
          }
        } else if (id === "nova") {
          const band = mesh(new TorusGeometry(pr * 0.82, 0.62 * u, 6, 20, PI), m.trim, false);
          band.position.set(side * 0.6 * u, 1.2 * u, 0);
          band.rotation.set(0, PI / 2, side * 0.2);
          limb.upper.add(band);
        }
        bake(hand);
      } else {
        // Wisp: glove with a floating orb that can hold light.
        const orb = mesh(sphere(rF * 1.7, 14, 10), m.trim, false);
        orb.position.y = -rF * 0.9;
        hand.add(orb);
      }
      return { upper: limb.upper, fore: limb.fore, hand, side };
    };
    const arms: [ArmRig, ArmRig] = [makeArm(-1), makeArm(1)];

    if (id === "volt") {
      const scarf = new Chain(7, (i, g) => {
        const w = 6.6 * u;
        const t = mesh(roundedBox(w, 7.4 * u, 1.1 * u, 0.4 * u, 2), i % 2 === 0 ? m.armor : m.trim, false);
        t.position.y = -3.4 * u;
        g.add(t);
        return 7 * u;
      });
      scarf.root.position.set(0, 33 * u, -4.4 * u);
      scarf.root.rotation.x = PI * 0.62;
      this.torso.add(scarf.root);
      this.chains.push({ chain: scarf, kind: "scarf", base: 0 });
    }
    if (id === "nova") {
      const cape = new Chain(3, (i, g) => {
        const t = mesh(roundedBox((19 - i * 2.8) * u, 10.4 * u, 1.1 * u, 0.4 * u, 2), i === 2 ? m.trim : m.armorDark, false);
        t.position.y = -4.8 * u;
        g.add(t);
        return 9.8 * u;
      });
      cape.root.position.set(0, 32 * u, -chestRZ * 1.0);
      this.torso.add(cape.root);
      this.chains.push({ chain: cape, kind: "cape", base: 0.12 });
    }

    bake(this.pelvis);
    bake(this.torso);
    bake(head);
    return { arms, legs, head, face };
  }

  private buildHead(head: Group, m: Mats, u: number): FaceRig {
    const id = this.def.id;
    const face: FaceRig = { eyes: [], pupils: [], brows: [], glowMats: [] };
    const eye = (mesh_: Mesh, side: number): void => {
      mesh_.userData.keep = true;
      face.eyes.push({ m: mesh_, sx: mesh_.scale.x, sy: mesh_.scale.y, sz: mesh_.scale.z, ry: mesh_.position.y, side });
    };
    if (id === "nova") {
      const helmet = mesh(ellipsoid(10.2 * u, 10.6 * u, 10.6 * u, 32), m.armor);
      head.add(helmet);
      const jaw = mesh(ellipsoid(7.4 * u, 4.6 * u, 8.2 * u, 20), m.armorDark);
      jaw.position.set(0, -6.4 * u, 1.6 * u);
      head.add(jaw);
      const visor = mesh(ellipsoid(8.4 * u, 4.2 * u, 5.8 * u, 24), m.glass, false);
      visor.position.set(0, 0.8 * u, 6.2 * u);
      head.add(visor);
      for (const s of [-1, 1]) {
        const g = new Mesh(ellipsoid(2.5 * u, 1.9 * u, 0.9 * u, 14), m.trim);
        g.position.set(s * 3.5 * u, 1.0 * u, 8.9 * u);
        g.scale.set(1, 1, 1);
        g.rotation.z = -s * 0.12;
        head.add(g);
        eye(g, s);
        const fin = mesh(cone(2.6 * u, 10.4 * u, 8), m.armorDark);
        fin.position.set(s * 8 * u, 3.4 * u, -1.2 * u);
        fin.rotation.set(-0.7, 0, -s * 0.5);
        head.add(fin);
        const ear = mesh(ellipsoid(2.0 * u, 4 * u, 4 * u, 12), m.trim, false);
        ear.position.set(s * 9.9 * u, -0.4 * u, 0);
        head.add(ear);
        const cheek = mesh(roundedBox(1.6 * u, 4.4 * u, 5.2 * u, 0.6 * u), m.alt);
        cheek.position.set(s * 8.8 * u, -3.4 * u, 3.4 * u);
        head.add(cheek);
      }
      const crest = mesh(roundedBox(2 * u, 4 * u, 15 * u, 0.8 * u), m.armorDark);
      crest.position.set(0, 10 * u, -0.5 * u);
      head.add(crest);
      const brow = mesh(roundedBox(14 * u, 1.6 * u, 3 * u, 0.6 * u), m.armorDark);
      brow.position.set(0, 4.4 * u, 8.2 * u);
      brow.rotation.x = -0.15;
      head.add(brow);
      const antenna = mesh(cone(0.6 * u, 8 * u, 6), m.alt);
      antenna.position.set(-5 * u, 9 * u, -3 * u);
      antenna.rotation.z = 0.25;
      head.add(antenna);
      face.glowMats.push(m.trim);
    } else if (id === "volt") {
      const skull = mesh(ellipsoid(8.2 * u, 9.4 * u, 8.8 * u, 28), m.skin);
      head.add(skull);
      const jawM = mesh(ellipsoid(6.4 * u, 3.8 * u, 6.2 * u, 18), m.skin);
      jawM.position.set(0, -5.4 * u, 1.4 * u);
      head.add(jawM);
      const hair = mesh(ellipsoid(9 * u, 7.2 * u, 9.4 * u, 22), m.hair);
      hair.position.set(0, 3.2 * u, -1.6 * u);
      head.add(hair);
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 8 - 0.5) * 2.5;
        const spike = mesh(cone(2.8 * u, (8 + (i % 2) * 4) * u, 8), m.hair);
        spike.position.set(Math.sin(a) * 6.8 * u, 7.8 * u, Math.cos(a) * 2 * u - 3.6 * u);
        spike.rotation.set(-0.55 - Math.abs(a) * 0.12, 0, -a * 0.75);
        head.add(spike);
      }
      const bang = mesh(cone(2.6 * u, 8 * u, 6), m.hair);
      bang.position.set(1.5 * u, 6.6 * u, 6.6 * u);
      bang.rotation.set(1.6, 0, -0.5);
      head.add(bang);
      // Goggles pushed up on the forehead.
      const strap = mesh(new TorusGeometry(9 * u, 1 * u, 6, 30), m.armorDark, false);
      strap.rotation.x = PI / 2;
      strap.position.y = 4.4 * u;
      head.add(strap);
      for (const s of [-1, 1]) {
        const lens = mesh(ellipsoid(3.8 * u, 3.4 * u, 1.9 * u, 14), m.trim, false);
        lens.position.set(s * 4.3 * u, 6.4 * u, 7.4 * u);
        lens.rotation.x = -0.5;
        head.add(lens);
        const frame = mesh(new TorusGeometry(3.7 * u, 0.7 * u, 6, 18), m.alt, false);
        frame.position.copy(lens.position);
        frame.position.z += 0.9 * u;
        frame.rotation.x = -0.5;
        head.add(frame);
        // Eyes: sclera + pupil + brow.
        const sclera = new Mesh(ellipsoid(2.5 * u, 3 * u, 1.3 * u, 14), m.white);
        sclera.position.set(s * 3.4 * u, 0.4 * u, 7.9 * u);
        head.add(sclera);
        eye(sclera, s);
        const pupil = new Mesh(ellipsoid(1.3 * u, 1.6 * u, 0.8 * u, 10), m.dark);
        pupil.position.set(s * 3.4 * u, 0.4 * u, 8.7 * u);
        pupil.userData.keep = true;
        head.add(pupil);
        face.pupils.push({ m: pupil, x: pupil.position.x, y: pupil.position.y, s: 1, reach: 0.9 * u });
        const brow = new Mesh(roundedBox(4 * u, 0.9 * u, 0.9 * u, 0.3 * u), m.hair);
        brow.position.set(s * 3.5 * u, 3.9 * u, 8.1 * u);
        brow.rotation.z = -s * 0.1;
        brow.userData.keep = true;
        head.add(brow);
        face.brows.push({ m: brow, side: s, y: brow.position.y, rz: brow.rotation.z });
        const ear = mesh(ellipsoid(1.6 * u, 2.6 * u, 1.8 * u, 10), m.skin);
        ear.position.set(s * 8.3 * u, -0.2 * u, -0.2 * u);
        head.add(ear);
      }
      const nose = mesh(ellipsoid(1 * u, 1.2 * u, 1.6 * u, 8), m.skin, false);
      nose.position.set(0, -1.6 * u, 8.7 * u);
      head.add(nose);
      const mouth = new Mesh(ellipsoid(2.8 * u, 1.1 * u, 0.7 * u, 12), m.dark);
      mouth.position.set(0.4 * u, -4.7 * u, 8 * u);
      mouth.userData.keep = true;
      head.add(mouth);
      face.mouth = { m: mouth, sx: mouth.scale.x, sy: mouth.scale.y };
    } else if (id === "bulwark") {
      const helm = mesh(roundedBox(21 * u, 18.6 * u, 21 * u, 5.8 * u), m.armorDark);
      head.add(helm);
      const brow = mesh(roundedBox(22 * u, 4.8 * u, 15 * u, 1.8 * u), m.armor);
      brow.position.set(0, 5 * u, 3.6 * u);
      head.add(brow);
      const slit = mesh(roundedBox(16 * u, 4 * u, 2.4 * u, 1 * u), m.dark, false);
      slit.position.set(0, 0.9 * u, 10.2 * u);
      head.add(slit);
      for (const s of [-1, 1]) {
        const g = new Mesh(roundedBox(5.4 * u, 1.9 * u, 1.2 * u, 0.5 * u), m.trim);
        g.position.set(s * 4.2 * u, 0.9 * u, 11.2 * u);
        g.rotation.z = -s * 0.18;
        head.add(g);
        eye(g, s);
        const cheek = mesh(roundedBox(3.4 * u, 11.6 * u, 13.6 * u, 1.3 * u), m.armor);
        cheek.position.set(s * 11 * u, -1.4 * u, 1 * u);
        head.add(cheek);
        const tusk = mesh(cone(1.5 * u, 5 * u, 6), m.alt);
        tusk.position.set(s * 4.4 * u, -9.2 * u, 8.6 * u);
        tusk.rotation.x = -0.3;
        head.add(tusk);
        const horn = mesh(cone(2.4 * u, 9 * u, 8), m.alt);
        horn.position.set(s * 9 * u, 8.6 * u, 0);
        horn.rotation.z = -s * 0.7;
        head.add(horn);
      }
      const crest = mesh(roundedBox(3.4 * u, 5.4 * u, 18 * u, 1 * u), m.armor);
      crest.position.set(0, 11.6 * u, 0);
      head.add(crest);
      const chin = mesh(roundedBox(14 * u, 4.4 * u, 9.6 * u, 1.5 * u), m.armor);
      chin.position.set(0, -8.8 * u, 5.4 * u);
      head.add(chin);
      const grille = new Mesh(roundedBox(8 * u, 2.4 * u, 0.9 * u, 0.4 * u), m.dark);
      grille.position.set(0, -7.4 * u, 10.9 * u);
      grille.userData.keep = true;
      head.add(grille);
      face.mouth = { m: grille, sx: grille.scale.x, sy: grille.scale.y };
      face.glowMats.push(m.trim);
    } else {
      const hood = mesh(latheOf([[0.01, 13.4 * u], [7.8 * u, 11.4 * u], [12 * u, 2 * u], [11.4 * u, -6.6 * u], [7 * u, -11.4 * u], [0.01, -9.4 * u]], 28), m.suit);
      hood.scale.set(1, 1, 1.1);
      head.add(hood);
      const tip = mesh(cone(3.8 * u, 14 * u, 10), m.suit);
      tip.position.set(0, 10.4 * u, -3 * u);
      tip.rotation.x = -0.75;
      head.add(tip);
      const rimOfHood = mesh(new TorusGeometry(8.6 * u, 1.2 * u, 8, 28), m.armor, false);
      rimOfHood.position.set(0, -0.4 * u, 4.8 * u);
      rimOfHood.scale.set(1, 1.1, 0.6);
      head.add(rimOfHood);
      const faceVoid = mesh(ellipsoid(8 * u, 8.3 * u, 6.6 * u, 22), this.mat(0x07040f, { roughness: 1, metalness: 0, rimStrength: 0 }), false);
      faceVoid.position.set(0, -0.4 * u, 3.6 * u);
      head.add(faceVoid);
      for (const s of [-1, 1]) {
        const g = new Mesh(ellipsoid(1.9 * u, 2.6 * u, 1.2 * u, 12), m.trim);
        g.position.set(s * 3.4 * u, 0.6 * u, 9.3 * u);
        g.rotation.z = -s * 0.22;
        head.add(g);
        eye(g, s);
        const brow = new Mesh(roundedBox(3.8 * u, 0.7 * u, 0.7 * u, 0.25 * u), m.armor);
        brow.position.set(s * 3.4 * u, 3.5 * u, 9.1 * u);
        brow.rotation.z = -s * 0.1;
        brow.userData.keep = true;
        head.add(brow);
        face.brows.push({ m: brow, side: s, y: brow.position.y, rz: brow.rotation.z });
      }
      const mouth = new Mesh(ellipsoid(1.5 * u, 0.5 * u, 0.5 * u, 8), m.trim);
      mouth.position.set(0, -3.4 * u, 9.1 * u);
      mouth.userData.keep = true;
      head.add(mouth);
      face.mouth = { m: mouth, sx: mouth.scale.x, sy: mouth.scale.y };
    }
    return face;
  }

  /* ----------------------------------------------------------------- UPDATE */

  /** The materials that can flip to a ghost/transparent variant mid-match (pre-compiled at match start). */
  warmMaterials(): MeshStandardMaterial[] {
    return this.mats;
  }

  /** Quality hook: hide fine geometry at low settings. */
  setDetail(level: number): void {
    this.detail.visible = level < 2;
  }

  private applyFace(pose: Pose, f: Fighter, dtFrames: number): void {
    this.blinkClock -= dtFrames;
    if (this.blinkClock <= 0) {
      this.blink = 1;
      this.blinkClock = 70 + ((f.slot * 37 + (f.sf % 53)) % 120);
    }
    this.blink = Math.max(0, this.blink - dtFrames * 0.22);
    const blinkAmt = this.blink > 0 ? Math.sin(this.blink * PI) : 0;
    const e = pose.expr;
    const face = this.face;
    const u = this.u;
    for (const eyeRig of face.eyes) {
      const s = eyeRig.m;
      const squint = 1 - e.anger * 0.3;
      const widen = 1 + e.wide * 0.38;
      s.scale.set(eyeRig.sx * (1 + e.wide * 0.1), eyeRig.sy * widen * squint * (1 - blinkAmt * 0.92), eyeRig.sz);
      s.rotation.z = -eyeRig.side * (0.12 + e.anger * 0.38) * (this.def.id === "volt" ? 0 : 1);
    }
    for (const pr of face.pupils) {
      pr.m.position.x = pr.x + this.lookX * pr.reach;
      pr.m.position.y = pr.y + this.lookY * pr.reach;
      pr.m.scale.setScalar(1 + e.wide * 0.3);
    }
    for (const b of face.brows) {
      b.m.rotation.z = b.rz + b.side * e.anger * 0.5 - b.side * e.wide * 0.12;
      b.m.position.y = b.y + e.wide * 1.1 * u - e.anger * 0.7 * u;
    }
    if (face.mouth) {
      face.mouth.m.scale.set(face.mouth.sx * (1 - e.open * 0.18), face.mouth.sy * (0.4 + e.open * 2.4), 1);
    }
    for (const g of face.glowMats) g.emissiveIntensity = 1.3 + e.anger * 0.9 + e.wide * 0.6;
  }

  update(f: Fighter, alpha: number, time: number, dtFrames: number, lookAt?: { x: number; y: number } | null): void {
    const def = this.def;
    const u = this.u;
    let x = f.px + (f.x - f.px) * alpha;
    let y = f.py + (f.y - f.py) * alpha;
    if (Math.abs(f.x - f.px) > 140 || Math.abs(f.y - f.py) > 140) {
      x = f.x;
      y = f.y;
    }
    const shaking = f.hitlag > 0 && f.state === "hitstun";
    this.root.position.set(x + (shaking ? (Math.random() - 0.5) * 6 : 0), -y + (shaking ? (Math.random() - 0.5) * 4 : 0), 0);
    this.root.visible = f.alive && !f.vanished;

    this.facing += (f.facing - this.facing) * Math.min(1, 0.4 * dtFrames);
    if (Math.abs(this.facing - f.facing) < 0.03) this.facing = f.facing;
    this.facingGroup.rotation.y = this.facing * YAW;
    const nearIndex = this.facing >= 0 ? 0 : 1;
    const nearSign = nearIndex === 0 ? 1 : -1;
    const near = this.arms[nearIndex];
    const far = this.arms[1 - nearIndex];
    const nearLeg = this.legs[nearIndex];
    const farLeg = this.legs[1 - nearIndex];

    const pose = this.driver.update(f, time, dtFrames);
    this.pose = pose;

    // Percent just increased → squash on impact.
    if (f.percent > this.lastPercent + 0.4 && f.hitlag > 0) this.hitSquash = 1;
    this.lastPercent = f.percent;
    this.hitSquash = Math.max(0, this.hitSquash - dtFrames * 0.12);

    const placeLeg = (leg: LegRig, lp: LegPose, side: number): number => {
      leg.thigh.rotation.set(-lp.hip, 0, side * lp.ab);
      leg.shin.rotation.x = lp.knee;
      leg.foot.rotation.x = lp.hip - lp.knee + lp.ankle;
      return this.L1 * Math.cos(lp.hip) + this.L2 * Math.cos(lp.hip - lp.knee);
    };
    const sideNear = nearIndex === 0 ? -1 : 1;
    const hF = placeLeg(nearLeg, pose.leg[0], sideNear);
    const hB = placeLeg(farLeg, pose.leg[1], -sideNear);
    let hip: number;
    if (this.floats) hip = this.hipH + pose.hipY * u;
    else if (f.grounded) hip = Math.min(hF, hB) + 3.4 * u + pose.hipY * u;
    else hip = this.hipH * 0.97 + pose.hipY * u;

    const lunge = pose.strike > 0 ? pose.strike * def.halfWidth * 0.34 : pose.strike * def.halfWidth * 0.14;
    const sq = this.hitSquash;
    this.body.position.set(0, hip, lunge + pose.hipZ * u);
    this.body.scale.set(pose.squashX * (1 + sq * 0.12), pose.squashY * (1 - sq * 0.14), pose.squashX * (1 + sq * 0.12));
    this.body.rotation.x = pose.pitch + pose.roll;
    this.pelvis.rotation.set(0, pose.pelvisYaw * nearSign, pose.pelvisRoll * nearSign);
    this.torso.rotation.set(pose.spine, pose.chestYaw * nearSign, pose.chestRoll * nearSign);
    this.head.rotation.x = pose.headPitch - pose.pitch * 0.5 - pose.spine * 0.5;

    // Head tracks the opponent: eyes lead, head follows within a comfortable range.
    let ly = 0;
    let lx = 0;
    if (lookAt && f.alive) {
      const dx = (lookAt.x - f.x) * f.facing;
      const dy = lookAt.y - (f.y - def.height * 0.6);
      const behind = dx < -40;
      lx = Math.max(-1, Math.min(1, behind ? -1 : dx / 400));
      ly = Math.max(-1, Math.min(1, dy / 260));
      this.head.rotation.x += -ly * 0.2 * (this.driver.style.look);
    }
    this.lookX += (lx - this.lookX) * Math.min(1, 0.18 * dtFrames);
    this.lookY += (ly - this.lookY) * Math.min(1, 0.18 * dtFrames);
    this.head.rotation.y = pose.headYaw * nearSign - pose.chestYaw * nearSign * 0.5 + (this.lookX < 0 ? this.lookX * 0.5 * nearSign : 0);
    this.head.rotation.z = pose.headRoll;

    const placeArm = (rig: ArmRig, a: ArmPose): void => {
      rig.upper.rotation.set(a.sh - PI / 2, 0, rig.side * a.ab);
      rig.fore.rotation.x = -a.el;
      rig.hand.rotation.x = a.wr;
      const stretch = Math.max(0.6, a.ext);
      rig.upper.scale.y = stretch;
      rig.fore.scale.y = stretch;
    };
    placeArm(near, pose.arm[0]);
    placeArm(far, pose.arm[1]);

    // Stretch along the flight direction (launch deformation).
    const speed = Math.hypot(f.vx, f.vy);
    if (pose.stretch > 0.02 && speed > 1) {
      const ang = Math.atan2(-f.vy, f.vx);
      this.stretchA.rotation.z = ang;
      this.stretchC.rotation.z = -ang;
      this.stretchB.scale.set(1 + pose.stretch * 0.22, 1 - pose.stretch * 0.12, 1 - pose.stretch * 0.12);
    } else {
      this.stretchA.rotation.z = 0;
      this.stretchC.rotation.z = 0;
      this.stretchB.scale.set(1, 1, 1);
    }

    this.applyFace(pose, f, dtFrames);

    const vx = (x - this.lastX) / Math.max(0.2, dtFrames);
    this.lastX = x;
    const accel = vx - this.lastVx;
    this.lastVx = vx;
    for (const c of this.chains) {
      const dir = f.facing;
      const push = -(vx * dir) * 0.045 - accel * dir * 0.1 + (f.grounded ? 0 : f.vy * -0.012);
      if (c.kind === "tail") c.chain.update(time, 0.0, -push * 0.5, 0.18, 0.12);
      else if (c.kind === "scarf") c.chain.update(time, 0.0, push, 0.2, 0.1);
      else c.chain.update(time, c.base, push * 0.6, 0.16, 0.05);
    }
    for (const s of this.spinners) s.rotation.z = time * 0.05;

    const shielding = f.state === "shield" || f.state === "shieldStun";
    this.shield.visible = shielding;
    if (shielding) {
      const ratio = Math.max(0.2, f.shield / def.shieldMax);
      const size = (def.height * 0.72 + def.halfWidth * 0.5) * (0.6 + 0.4 * ratio);
      this.shield.position.set(0, def.height * 0.5, 0);
      this.shield.scale.set(size, size, size);
      this.shieldMat.uniforms.t.value = time * 0.12;
      this.shieldMat.uniforms.k.value = 0.85 + 0.2 * Math.sin(time * 0.3) + (f.state === "shieldStun" ? 0.4 : 0);
      this.shieldMat.uniforms.hit.value = f.state === "shieldStun" ? Math.max(0, 1 - f.sf / 10) : 0;
    }

    let aura = 0;
    let auraColor = hexToNumber(this.style.color);
    if (f.chargeFrames > 0) aura = 0.25 + 0.3 * (f.chargeFrames / 52) + 0.1 * Math.sin(time * 0.8);
    if (f.buffPower > 0) {
      aura = Math.max(aura, 0.4);
      auraColor = 0xff6a3d;
    } else if (f.buffSpeed > 0) {
      aura = Math.max(aura, 0.35);
      auraColor = 0x37f2d0;
    } else if (f.buffAegis > 0) {
      aura = Math.max(aura, 0.35);
      auraColor = 0x7cb8ff;
    }
    if (f.state === "respawn") {
      aura = 0.55;
      auraColor = 0xfff2a8;
    }
    this.auraMat.opacity = aura;
    this.auraMat.color.setHex(auraColor);
    this.aura.visible = aura > 0.01;

    const flash = f.hitlag > 2 && f.state === "hitstun";
    const ghost = pose.alpha < 0.99;
    if (flash !== this.flashed || ghost !== this.transparent || ghost) {
      for (const mt of this.mats) {
        if (mt.userData.e0 === undefined) {
          mt.userData.e0 = mt.emissive.getHex();
          mt.userData.i0 = mt.emissiveIntensity;
        }
        if (flash !== this.flashed) {
          mt.emissive.setHex(flash ? 0xffffff : (mt.userData.e0 as number));
          mt.emissiveIntensity = flash ? 0.85 : (mt.userData.i0 as number);
        }
        if (ghost !== this.transparent) {
          mt.transparent = ghost;
          mt.needsUpdate = true;
        }
        mt.opacity = ghost ? pose.alpha : 1;
      }
      this.flashed = flash;
      this.transparent = ghost;
    }

    this.heldItem.visible = f.heldItem !== null;
    if (f.heldItem) {
      (this.heldItem.material as MeshBasicMaterial).color.setHex(hexToNumber(ITEMS[f.heldItem].color));
      this.heldItem.position.set(def.halfWidth * 0.9 * f.facing, def.height * 0.75 + Math.sin(time * 0.2) * 3, 0);
    }
  }

  dispose(): void {
    const geos = new Set<BufferGeometry>();
    const mats = new Set<Material>();
    this.root.traverse((o) => {
      const mm = o as Mesh;
      if (mm.isMesh) {
        geos.add(mm.geometry);
        if (Array.isArray(mm.material)) mm.material.forEach((x) => mats.add(x));
        else mats.add(mm.material);
      }
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((mt) => mt.dispose());
  }
}
