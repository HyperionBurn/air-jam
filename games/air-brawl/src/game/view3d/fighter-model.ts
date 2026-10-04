import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
  type MeshStandardMaterial,
} from "three";
import { ITEMS } from "../data/items";
import type { Fighter, FighterDef, FighterId } from "../sim/types";
import { hexToNumber, mixHex, type SlotStyle } from "../view/palette";
import { cone, ellipsoid, limbGeometry, mesh, roundedBox, stdMat } from "./geo";
import { PoseDriver, type PoseSpec } from "./pose";

/** Turn angle: 3/4 view so the body reads in depth rather than as a flat card. */
const YAW = 1.2;

interface Palette {
  main: number;
  dark: number;
  light: number;
  accent: number;
  suit: number;
  skin: number;
}

const paletteFor = (id: FighterId, style: SlotStyle): Palette => {
  const main = hexToNumber(style.color);
  const light = hexToNumber(style.light);
  const dark = hexToNumber(mixHex(style.dark, "#1b2038", 0.35));
  const suitOf = (mix: string, t: number) => hexToNumber(mixHex(style.color, mix, t));
  switch (id) {
    case "volt":
      return { main, dark, light, accent: 0xffe14d, suit: suitOf("#1c2540", 0.7), skin: 0xf2c6a0 };
    case "bulwark":
      return { main, dark, light, accent: 0xffa24d, suit: suitOf("#2a2f40", 0.66), skin: 0xd9a77e };
    case "wisp":
      return { main, dark, light, accent: 0xf4d4ff, suit: suitOf("#2a1a55", 0.6), skin: 0x120a24 };
    case "nova":
    default:
      return { main, dark, light, accent: 0x7cf0ff, suit: suitOf("#222a45", 0.62), skin: 0xf0c9a8 };
  }
};

const shieldMaterial = (color: number): ShaderMaterial =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { c: { value: new Color(color) }, k: { value: 1 }, t: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 c; uniform float k; uniform float t; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float hex = 0.5 + 0.5*sin(vP.y*7.0 + t) * sin(vP.x*7.0 - t*0.7);
        float a = (0.1 + f*1.15 + hex*0.07) * k;
        gl_FragColor = vec4(c * (0.7 + f), a);
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
  upper: Group;
  fore: Group;
  hand: Group;
}
interface LegRig {
  thigh: Group;
  shin: Group;
}
interface Mats {
  suit: MeshStandardMaterial;
  armor: MeshStandardMaterial;
  armorDark: MeshStandardMaterial;
  trim: MeshStandardMaterial;
  skin: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  hair: MeshStandardMaterial;
}

function latheOf(profile: [number, number][], segments = 28): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
}

export class FighterModel {
  readonly root = new Group();
  private readonly facingGroup = new Group();
  private readonly body = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
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
  private facing = 1;
  private lastX = 0;
  private lastVx = 0;
  private transparent = false;
  private flashed = false;
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
  readonly palette: Palette;

  constructor(
    readonly def: FighterDef,
    readonly style: SlotStyle,
  ) {
    const H = def.height * def.scale * 1.04;
    const u = H / 100;
    this.u = u;
    this.palette = paletteFor(def.id, style);
    this.floats = def.id === "wisp";

    const dims = {
      nova: { hip: 47, thigh: 24, shin: 23, upper: 15.5, fore: 14.5 },
      volt: { hip: 49, thigh: 25.5, shin: 24, upper: 15, fore: 14.5 },
      bulwark: { hip: 41, thigh: 21, shin: 20.5, upper: 16.5, fore: 15 },
      wisp: { hip: 35, thigh: 20, shin: 20, upper: 14, fore: 13 },
    }[def.id];
    this.hipH = dims.hip * u;
    this.L1 = dims.thigh * u;
    this.L2 = dims.shin * u;
    this.A1 = dims.upper * u;
    this.A2 = dims.fore * u;
    this.shoulderUp = this.hipH + 29 * u;

    this.root.add(this.facingGroup);
    this.facingGroup.add(this.body);
    this.body.position.y = this.hipH;
    this.body.add(this.torso);
    this.torso.position.y = 3 * u;

    const built = this.build(u);
    this.arms = built.arms;
    this.legs = built.legs;
    this.head = built.head;

    this.shieldMat = shieldMaterial(hexToNumber(style.color));
    this.shield = new Mesh(new SphereGeometry(1, 32, 20), this.shieldMat);
    this.shield.visible = false;
    this.shield.renderOrder = 5;
    this.root.add(this.shield);
    this.auraMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: BackSide });
    this.aura = new Mesh(new SphereGeometry(1, 20, 14), this.auraMat);
    this.aura.scale.set(def.halfWidth * 1.8, H * 0.62, def.halfWidth * 1.8);
    this.aura.position.y = H * 0.5;
    this.aura.renderOrder = 4;
    this.root.add(this.aura);
    this.heldItem = new Mesh(new SphereGeometry(def.halfWidth * 0.3, 14, 10), new MeshBasicMaterial({ color: 0xffffff }));
    this.heldItem.visible = false;
    this.root.add(this.heldItem);

    this.driver = new PoseDriver(this.poseSpec());
  }

  private poseSpec(): PoseSpec {
    return { shoulderX: 4, shoulderY: -this.shoulderUp, armLen: this.A1 + this.A2, floats: this.floats };
  }

  private mat(color: number, o: Parameters<typeof stdMat>[1] = {}): MeshStandardMaterial {
    const m = stdMat(color, o);
    this.mats.push(m);
    return m;
  }

  /* ------------------------------------------------------------------ BUILD */

  private build(u: number): { arms: [ArmRig, ArmRig]; legs: [LegRig, LegRig]; head: Group } {
    const id = this.def.id;
    const p = this.palette;
    const bulky = id === "bulwark";
    const lean = id === "volt";
    const wisp = id === "wisp";
    const rimC = p.light;

    const m: Mats = {
      suit: this.mat(p.suit, { roughness: 0.58, metalness: 0.12, rim: rimC, rimStrength: 0.22, envMapIntensity: 1.2 }),
      armor: this.mat(p.main, { roughness: 0.27, metalness: 0.38, rim: rimC, rimStrength: 0.3, envMapIntensity: 1.5 }),
      armorDark: this.mat(p.dark, { roughness: 0.38, metalness: 0.5, rim: rimC, rimStrength: 0.22, envMapIntensity: 1.3 }),
      trim: this.mat(p.accent, { roughness: 0.3, metalness: 0.2, emissive: p.accent, emissiveIntensity: 1.35, rim: 0xffffff, rimStrength: 0.1 }),
      hair: this.mat(p.accent, { roughness: 0.4, metalness: 0.1, emissive: p.accent, emissiveIntensity: 0.18, rim: 0xfff4b0, rimStrength: 0.25 }),
      skin: this.mat(p.skin, { roughness: 0.7, metalness: 0, rim: 0xffe0cc, rimStrength: 0.12, envMapIntensity: 0.6 }),
      glass: this.mat(0x0b1228, { roughness: 0.08, metalness: 0.9, rim: rimC, rimStrength: 0.35, envMapIntensity: 2.2 }),
    };

    const k = bulky ? 1.5 : lean ? 0.88 : wisp ? 0.8 : 1; // limb thickness
    const sx = bulky ? 20 : lean ? 12.8 : wisp ? 12.5 : 15; // shoulder half-width
    const hipW = bulky ? 12 : lean ? 8.2 : 9.4;

    /* ---- pelvis & legs ---- */
    if (!wisp) {
      const pelvis = mesh(ellipsoid(hipW * u, 5.4 * u, (bulky ? 8.5 : 6.6) * u, 22), m.suit);
      this.body.add(pelvis);
      const belt = mesh(roundedBox(hipW * 2.1 * u, 3.2 * u, (bulky ? 17 : 13.4) * u, 1.2 * u), bulky ? m.trim : m.armorDark);
      belt.position.y = 3.8 * u;
      this.body.add(belt);
      if (id === "nova" || bulky) {
        for (const s of [-1, 1]) {
          const pouch = mesh(roundedBox(3.4 * u, 5 * u, 5.4 * u, 1 * u), m.armorDark);
          pouch.position.set(s * (hipW + 1.2) * u, 0.4 * u, 1 * u);
          this.body.add(pouch);
        }
      }
    }
    const makeLeg = (side: number): LegRig => {
      const thigh = new Group();
      thigh.position.set(side * hipW * 0.62 * u, -1.5 * u, 0);
      this.body.add(thigh);
      const shin = new Group();
      shin.position.y = -this.L1;
      thigh.add(shin);
      if (wisp) {
        thigh.visible = false;
        return { thigh, shin };
      }
      const rT = 6.9 * k * u;
      const rK = 5 * k * u;
      const rA = 3.5 * k * u;
      thigh.add(mesh(limbGeometry(this.L1, rT, rK), m.suit));
      shin.add(mesh(limbGeometry(this.L2, rK, rA), m.suit));
      // Thigh plate, knee cap, long greave and boot.
      const thighPlate = mesh(limbGeometry(this.L1 * 0.55, rT * 1.14, rK * 1.14), id === "volt" ? m.suit : m.armor);
      thighPlate.position.y = -this.L1 * 0.08;
      thigh.add(thighPlate);
      const kneeCap = mesh(ellipsoid(rK * 1.18, rK * 1.0, rK * 1.25, 16), id === "volt" ? m.armorDark : m.armor);
      kneeCap.position.set(0, 0.2 * u, rK * 0.55);
      shin.add(kneeCap);
      const greave = mesh(limbGeometry(this.L2 * 0.62, rK * 1.2, rA * 1.3), id === "volt" ? m.suit : m.armor);
      greave.position.y = -this.L2 * 0.18;
      shin.add(greave);
      const boot = mesh(roundedBox(rA * 2.5, 4.2 * u, (bulky ? 17 : 14) * u, 1.4 * u), id === "volt" ? m.armor : m.armorDark);
      boot.position.set(0, -this.L2 - 0.6 * u, 3.4 * u);
      shin.add(boot);
      const toe = mesh(ellipsoid(rA * 1.3, 2.4 * u, 3.4 * u), id === "volt" ? m.armor : m.armor);
      toe.position.set(0, -this.L2 - 0.2 * u, 9.6 * u);
      shin.add(toe);
      const sole = mesh(roundedBox(rA * 2.6, 1.1 * u, (bulky ? 17.4 : 14.4) * u, 0.4 * u), m.trim, false);
      sole.position.set(0, -this.L2 - 3 * u, 3.4 * u);
      shin.add(sole);
      return { thigh, shin };
    };
    const legs: [LegRig, LegRig] = [makeLeg(-1), makeLeg(1)];

    /* ---- torso ---- */
    const abd = mesh(ellipsoid(hipW * 0.82 * u, 6.4 * u, (bulky ? 8.8 : 6) * u, 22), m.suit);
    abd.position.y = 6 * u;
    this.torso.add(abd);
    const chestRX = (bulky ? 16 : lean ? 10 : 11.4) * u;
    const chestRY = (bulky ? 11.5 : 9.4) * u;
    const chestRZ = (bulky ? 11 : lean ? 6.4 : 7.6) * u;
    const chestY = 19 * u;
    const chest = mesh(ellipsoid(chestRX, chestRY, chestRZ, 28), m.suit);
    chest.position.y = chestY;
    this.torso.add(chest);
    const girdle = mesh(ellipsoid(chestRX * 1.1, 4.4 * u, chestRZ * 0.86, 24), m.suit);
    girdle.position.y = 26.5 * u;
    this.torso.add(girdle);

    if (id === "nova") {
      const plate = mesh(roundedBox(chestRX * 1.62, chestRY * 1.55, chestRZ * 0.95, 2.4 * u), m.armor);
      plate.position.set(0, chestY + 0.5 * u, chestRZ * 0.52);
      plate.rotation.x = -0.08;
      this.torso.add(plate);
      const core = mesh(new SphereGeometry(3.4 * u, 18, 12), m.trim, false);
      core.position.set(0, chestY + 2 * u, chestRZ * 1.02);
      core.scale.z = 0.5;
      this.torso.add(core);
      const ring = mesh(new TorusGeometry(4.6 * u, 0.7 * u, 8, 24), m.armorDark, false);
      ring.position.copy(core.position);
      this.torso.add(ring);
      for (let i = 0; i < 3; i += 1) {
        const ab = mesh(roundedBox(10.5 * u - i * 1.2 * u, 2.6 * u, 6.2 * u, 0.9 * u), m.armorDark);
        ab.position.set(0, (10.5 - i * 2.9) * u, 5.2 * u);
        this.torso.add(ab);
      }
      const pack = mesh(roundedBox(chestRX * 1.3, 17 * u, 8 * u, 2 * u), m.armorDark);
      pack.position.set(0, chestY - 0.5 * u, -chestRZ * 1.12);
      this.torso.add(pack);
      for (const s of [-1, 1]) {
        const t = mesh(new SphereGeometry(2.2 * u, 12, 8), m.trim, false);
        t.position.set(s * chestRX * 0.4, chestY - 9.5 * u, -chestRZ * 1.2);
        this.torso.add(t);
      }
    } else if (id === "volt") {
      const vest = mesh(ellipsoid(chestRX * 1.06, chestRY * 0.8, chestRZ * 1.12, 22), m.armor);
      vest.position.set(0, chestY + 1.2 * u, chestRZ * 0.12);
      this.torso.add(vest);
      const bolt = new Shape();
      bolt.moveTo(0.22, 1).lineTo(-0.5, -0.05).lineTo(-0.05, -0.05).lineTo(-0.28, -1).lineTo(0.5, 0.1).lineTo(0.06, 0.1).closePath();
      const boltGeo = new ExtrudeGeometry(bolt, { depth: 0.25, bevelEnabled: false });
      boltGeo.scale(5 * u, 5 * u, 5 * u);
      const boltMesh = mesh(boltGeo, m.trim, false);
      boltMesh.position.set(0, chestY, chestRZ * 1.12);
      this.torso.add(boltMesh);
    } else if (bulky) {
      const plate = mesh(roundedBox(chestRX * 1.78, chestRY * 1.6, chestRZ * 1.1, 3.4 * u), m.armor);
      plate.position.set(0, chestY + 1.2 * u, chestRZ * 0.5);
      this.torso.add(plate);
      for (let i = 0; i < 3; i += 1) {
        const rivet = mesh(new SphereGeometry(1.1 * u, 8, 6), m.trim, false);
        rivet.position.set((-0.55 + i * 0.55) * chestRX, chestY + chestRY * 0.85, chestRZ * 1.08);
        this.torso.add(rivet);
      }
      const plate2 = mesh(roundedBox(chestRX * 1.2, 5 * u, chestRZ * 0.9, 1.4 * u), m.armorDark);
      plate2.position.set(0, 9 * u, chestRZ * 0.6);
      this.torso.add(plate2);
      const buckle = mesh(roundedBox(7 * u, 5.5 * u, 2.6 * u, 1 * u), m.trim, false);
      buckle.position.set(0, 3.6 * u - 3 * u, 8.8 * u);
      this.torso.add(buckle);
      for (const s of [-1, 1]) {
        const skirt = mesh(roundedBox(9 * u, 14 * u, 2.4 * u, 1 * u), m.armorDark);
        skirt.position.set(s * 6.4 * u, -8 * u, 7 * u);
        skirt.rotation.x = 0.1;
        this.body.add(skirt);
      }
    } else {
      // Wisp: flowing robe (lathe) with a glowing sash and gem, trailing wisps below.
      const robe = mesh(
        latheOf(
          [
            [0.01, 44 * u],
            [10.5 * u, 42 * u],
            [14.5 * u, 30 * u],
            [17 * u, 14 * u],
            [19.5 * u, -2 * u],
            [19 * u, -16 * u],
            [14 * u, -26 * u],
            [8 * u, -31 * u],
            [0.01, -34 * u],
          ],
          32,
        ),
        m.suit,
      );
      robe.scale.z = 0.78;
      this.torso.add(robe);
      const sash = mesh(new TorusGeometry(13.5 * u, 1.3 * u, 8, 32), m.trim, false);
      sash.rotation.x = Math.PI / 2;
      sash.scale.set(1, 0.78, 1);
      sash.position.y = 3 * u;
      this.torso.add(sash);
      const gem = mesh(new SphereGeometry(3.2 * u, 16, 12), m.trim, false);
      gem.position.set(0, chestY - 2 * u, chestRZ * 0.9);
      this.torso.add(gem);
      const collar = mesh(latheOf([[0.01, 0], [13 * u, 1 * u], [12 * u, 6 * u], [6 * u, 9 * u]], 28), m.armor);
      collar.position.y = 22 * u;
      collar.scale.z = 0.8;
      this.torso.add(collar);
      const halo = new Group();
      halo.add(mesh(new TorusGeometry(27 * u, 0.9 * u, 8, 56), m.trim, false));
      for (let i = 0; i < 3; i += 1) {
        const spark = mesh(new SphereGeometry(2.2 * u, 10, 8), m.trim, false);
        const a = (i / 3) * Math.PI * 2;
        spark.position.set(Math.cos(a) * 27 * u, Math.sin(a) * 27 * u, 0);
        halo.add(spark);
      }
      halo.position.set(0, chestY + 9 * u, -11 * u);
      halo.rotation.y = Math.PI / 2;
      this.torso.add(halo);
      this.spinners.push(halo);
      const tail = new Chain(4, (i, g) => {
        const r = (10 - i * 2.2) * u;
        const t = mesh(ellipsoid(r, r * 1.6, r * 0.8), m.suit);
        t.position.y = -r * 1.1;
        g.add(t);
        return r * 2.1;
      });
      tail.root.position.set(0, -33 * u, 0);
      this.torso.add(tail.root);
      this.chains.push({ chain: tail, kind: "tail", base: 0 });
    }

    /* ---- neck & head ---- */
    if (!wisp) {
      const neck = mesh(limbGeometry(5 * u, 2.9 * k * u, 2.9 * k * u), m.skin);
      neck.position.y = 33 * u;
      this.torso.add(neck);
    }
    const head = new Group();
    head.position.y = 40 * u;
    this.torso.add(head);
    this.buildHead(head, m, u);

    /* ---- arms ---- */
    const shoulderY = 26 * u;
    const makeArm = (side: number): ArmRig => {
      const upper = new Group();
      upper.position.set(side * sx * u, shoulderY, 0);
      this.torso.add(upper);
      const fore = new Group();
      fore.position.y = -this.A1;
      upper.add(fore);
      const hand = new Group();
      hand.position.y = -this.A2;
      fore.add(hand);
      const rU = 4.5 * k * u;
      const rF = 3.7 * k * u;
      const sleeve = id === "volt" ? m.armorDark : m.suit;
      upper.add(mesh(limbGeometry(this.A1, rU * 1.05, rU * 0.88), sleeve));
      fore.add(mesh(limbGeometry(this.A2, rU * 0.88, rF * 0.82), sleeve));
      if (!wisp) {
        const bracer = mesh(limbGeometry(this.A2 * 0.72, rF * (bulky ? 1.36 : 1.22), rF * (bulky ? 1.18 : 1.0)), m.armor);
        bracer.position.y = -this.A2 * 0.2;
        fore.add(bracer);
        const fist = mesh(ellipsoid(rF * (bulky ? 1.4 : 1.2), rF * 1.2, rF * 1.28, 14), id === "volt" ? m.armor : m.armorDark);
        fist.position.y = -rF * 0.6;
        hand.add(fist);
        const knuckle = mesh(ellipsoid(rF * 0.7, rF * 0.4, rF * 0.5, 10), m.trim, false);
        knuckle.position.set(0, -rF * 0.45, rF * 1.05);
        hand.add(knuckle);
        const pr = (bulky ? 9.4 : lean ? 5.2 : 7.2) * u;
        const paul = mesh(new SphereGeometry(pr, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.64), lean ? m.armorDark : m.armor);
        paul.position.set(side * rU * 0.25, rU * 0.55, 0);
        paul.rotation.z = -side * 0.4;
        upper.add(paul);
        if (bulky) {
          const spike = mesh(cone(2.4 * u, 7 * u, 8), m.trim, false);
          spike.position.set(side * 6.2 * u, 8 * u, 0);
          spike.rotation.z = -side * 0.5;
          upper.add(spike);
        } else if (id === "nova") {
          const stripe = mesh(new TorusGeometry(pr * 0.78, 0.55 * u, 6, 20, Math.PI), m.trim, false);
          stripe.position.set(side * rU * 0.25, rU * 0.5, 0);
          stripe.rotation.set(0, Math.PI / 2, side * 0.2);
          upper.add(stripe);
        }
      } else {
        const orb = mesh(new SphereGeometry(rF * 1.6, 14, 10), m.trim, false);
        orb.position.y = -rF * 0.8;
        hand.add(orb);
        const cuff = mesh(limbGeometry(this.A2 * 0.45, rF * 1.7, rF * 1.35), m.armor);
        cuff.position.y = -this.A2 * 0.42;
        fore.add(cuff);
      }
      return { upper, fore, hand };
    };
    const arms: [ArmRig, ArmRig] = [makeArm(-1), makeArm(1)];

    if (id === "volt") {
      const scarf = new Chain(6, (i, g) => {
        const w = 6.2 * u;
        const t = mesh(roundedBox(w, 7 * u, 1.1 * u, 0.4 * u, 2), i % 2 === 0 ? m.armor : m.trim, false);
        t.position.y = -3.2 * u;
        g.add(t);
        return 6.6 * u;
      });
      scarf.root.position.set(0, 33 * u, -4.2 * u);
      scarf.root.rotation.x = Math.PI * 0.62;
      this.torso.add(scarf.root);
      this.chains.push({ chain: scarf, kind: "scarf", base: 0 });
    }
    if (id === "nova") {
      const cape = new Chain(3, (i, g) => {
        const t = mesh(roundedBox((18 - i * 2.6) * u, 10 * u, 1.1 * u, 0.4 * u, 2), i === 2 ? m.trim : m.armorDark, false);
        t.position.y = -4.6 * u;
        g.add(t);
        return 9.4 * u;
      });
      cape.root.position.set(0, 32 * u, -chestRZ * 1.0);
      this.torso.add(cape.root);
      this.chains.push({ chain: cape, kind: "cape", base: 0.12 });
    }
    return { arms, legs, head };
  }

  private buildHead(head: Group, m: Mats, u: number): void {
    const id = this.def.id;
    if (id === "nova") {
      const helmet = mesh(ellipsoid(8.9 * u, 9.5 * u, 9.6 * u, 30), m.armor);
      head.add(helmet);
      const jaw = mesh(ellipsoid(6.8 * u, 4.2 * u, 7.6 * u, 20), m.armorDark);
      jaw.position.set(0, -6 * u, 1.4 * u);
      head.add(jaw);
      const visor = mesh(ellipsoid(7.6 * u, 3.4 * u, 5.2 * u, 22), m.glass, false);
      visor.position.set(0, 0.8 * u, 6 * u);
      head.add(visor);
      const visorGlow = mesh(ellipsoid(6.9 * u, 1.6 * u, 4.4 * u, 18), m.trim, false);
      visorGlow.position.set(0, 0.9 * u, 6.8 * u);
      head.add(visorGlow);
      for (const s of [-1, 1]) {
        const fin = mesh(cone(2.4 * u, 9.5 * u, 8), m.armorDark);
        fin.position.set(s * 7.4 * u, 3.4 * u, -1.2 * u);
        fin.rotation.set(-0.7, 0, -s * 0.5);
        head.add(fin);
        const ear = mesh(ellipsoid(1.8 * u, 3.6 * u, 3.6 * u, 12), m.trim, false);
        ear.position.set(s * 9 * u, -0.4 * u, 0);
        head.add(ear);
      }
      const crest = mesh(roundedBox(1.8 * u, 3.6 * u, 14 * u, 0.7 * u), m.armorDark);
      crest.position.set(0, 9.2 * u, -0.5 * u);
      head.add(crest);
    } else if (id === "volt") {
      const face = mesh(ellipsoid(7.6 * u, 8.9 * u, 8.2 * u, 26), m.skin);
      head.add(face);
      const hair = mesh(ellipsoid(8.4 * u, 6.9 * u, 8.8 * u, 20), m.hair);
      hair.position.set(0, 2.8 * u, -1.4 * u);
      head.add(hair);
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 7 - 0.5) * 2.4;
        const spike = mesh(cone(2.6 * u, (7.6 + (i % 2) * 3.6) * u, 8), m.hair);
        spike.position.set(Math.sin(a) * 6.4 * u, 7.4 * u, Math.cos(a) * 2 * u - 3.4 * u);
        spike.rotation.set(-0.55 - Math.abs(a) * 0.12, 0, -a * 0.75);
        head.add(spike);
      }
      const strap = mesh(new TorusGeometry(8.5 * u, 0.9 * u, 6, 30), m.armorDark, false);
      strap.rotation.x = Math.PI / 2;
      strap.position.y = 3.6 * u;
      head.add(strap);
      for (const s of [-1, 1]) {
        const lens = mesh(ellipsoid(3.2 * u, 2.8 * u, 1.6 * u, 14), m.trim, false);
        lens.position.set(s * 3.8 * u, 3.4 * u, 7.8 * u);
        head.add(lens);
        const eye = mesh(new SphereGeometry(1.2 * u, 8, 6), m.glass, false);
        eye.position.set(s * 3.2 * u, -1.6 * u, 7.6 * u);
        head.add(eye);
      }
      const smirk = mesh(roundedBox(3.4 * u, 0.7 * u, 0.7 * u, 0.3 * u, 2), m.glass, false);
      smirk.position.set(0.6 * u, -4.6 * u, 8 * u);
      smirk.rotation.z = 0.12;
      head.add(smirk);
    } else if (id === "bulwark") {
      const helm = mesh(roundedBox(20 * u, 18 * u, 20 * u, 5.4 * u), m.armorDark);
      head.add(helm);
      const brow = mesh(roundedBox(21 * u, 4.4 * u, 14 * u, 1.6 * u), m.armor);
      brow.position.set(0, 4.8 * u, 3.4 * u);
      head.add(brow);
      const visor = mesh(roundedBox(15 * u, 3.4 * u, 2.2 * u, 0.9 * u), m.trim, false);
      visor.position.set(0, 0.8 * u, 10 * u);
      head.add(visor);
      const crest = mesh(roundedBox(3.2 * u, 5 * u, 17 * u, 1 * u), m.armor);
      crest.position.set(0, 11 * u, 0);
      head.add(crest);
      for (const s of [-1, 1]) {
        const cheek = mesh(roundedBox(3.2 * u, 11 * u, 13 * u, 1.3 * u), m.armor);
        cheek.position.set(s * 10.4 * u, -1.4 * u, 1 * u);
        head.add(cheek);
      }
      const chin = mesh(roundedBox(13 * u, 4 * u, 9 * u, 1.4 * u), m.armor);
      chin.position.set(0, -8.4 * u, 5 * u);
      head.add(chin);
    } else {
      const hood = mesh(latheOf([[0.01, 13 * u], [7.4 * u, 11 * u], [11.4 * u, 2 * u], [10.8 * u, -6.4 * u], [6.6 * u, -11 * u], [0.01, -9 * u]], 28), m.suit);
      hood.scale.set(1, 1, 1.08);
      head.add(hood);
      const tip = mesh(cone(3.6 * u, 13 * u, 10), m.suit);
      tip.position.set(0, 10 * u, -3 * u);
      tip.rotation.x = -0.75;
      head.add(tip);
      const rimOfHood = mesh(new TorusGeometry(8.2 * u, 1.1 * u, 8, 28), m.armor, false);
      rimOfHood.position.set(0, -0.4 * u, 4.6 * u);
      rimOfHood.scale.set(1, 1.1, 0.6);
      head.add(rimOfHood);
      const faceVoid = mesh(ellipsoid(7.6 * u, 7.9 * u, 6.4 * u, 22), this.mat(0x07040f, { roughness: 1, metalness: 0, rimStrength: 0 }), false);
      faceVoid.position.set(0, -0.4 * u, 3.4 * u);
      head.add(faceVoid);
      for (const s of [-1, 1]) {
        const eye = mesh(new SphereGeometry(1.8 * u, 10, 8), m.trim, false);
        eye.position.set(s * 3.4 * u, 0.4 * u, 9 * u);
        head.add(eye);
      }
    }
  }

  /* ----------------------------------------------------------------- UPDATE */

  update(f: Fighter, alpha: number, time: number, dtFrames: number): void {
    const def = this.def;
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
    const near = this.arms[nearIndex];
    const far = this.arms[1 - nearIndex];
    const nearLeg = this.legs[nearIndex];
    const farLeg = this.legs[1 - nearIndex];

    const pose = this.driver.compute(f, time);

    const bendFor = (angle: number): number => 0.1 + Math.max(0, -angle) * 0.85 + pose.crouch * 0.9 + (angle > 0.5 ? (angle - 0.5) * 0.4 : 0);
    const placeLeg = (leg: LegRig, angle: number, bend: number): number => {
      leg.thigh.rotation.x = -(angle + bend * 0.5);
      leg.shin.rotation.x = bend;
      return this.L1 * Math.cos(angle + bend * 0.5) + this.L2 * Math.cos(angle - bend * 0.5);
    };
    const hF = placeLeg(nearLeg, pose.legF, bendFor(pose.legF));
    const hB = placeLeg(farLeg, pose.legB, bendFor(pose.legB));
    let hip = this.hipH;
    if (!this.floats) {
      const foot = 3.2 * this.u;
      hip = f.grounded ? Math.min(hF, hB) + foot : Math.min(this.hipH * (1 - pose.crouch * 0.12), Math.max(hF, hB) + foot);
    } else {
      hip = this.hipH + pose.bob;
    }

    const lunge = pose.strike > 0 ? pose.strike * def.halfWidth * 0.35 : pose.strike * def.halfWidth * 0.12;
    this.body.position.set(0, hip + (this.floats ? 0 : pose.bob), lunge);
    this.body.scale.set(pose.squashX, pose.squashY, pose.squashX);
    this.body.rotation.x = pose.lean + pose.rotate;
    this.torso.rotation.y = pose.twist * 0.55;
    this.torso.rotation.x = pose.crouch * 0.18 + pose.lean * 0.25;
    this.head.rotation.x = -pose.lean * 0.6 - pose.crouch * 0.1;
    this.head.rotation.y = -pose.twist * 0.4;

    const placeArm = (rig: ArmRig, angle: number, ext: number, outward: number): void => {
      const bend = Math.max(0.2, (1.15 - Math.min(1.2, ext)) * 1.1 + 0.24) + pose.guard * 1.15;
      rig.upper.rotation.set(angle + bend * 0.5 - pose.guard * 0.55 - Math.PI / 2, 0, outward * 0.12);
      rig.fore.rotation.x = -bend;
      const stretch = Math.max(1, ext);
      rig.upper.scale.y = stretch;
      rig.fore.scale.y = stretch;
    };
    placeArm(near, pose.armF, pose.armFExt, nearIndex === 0 ? 1 : -1);
    placeArm(far, pose.armB, pose.armBExt, nearIndex === 0 ? -1 : 1);

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
