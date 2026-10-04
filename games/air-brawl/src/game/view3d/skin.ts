import { seg as scaleSeg } from "./geo";
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  type Material,
} from "three";

/**
 * Two-bone skinned tube (arm or leg). The mesh is one continuous surface whose vertices blend between
 * the upper and lower bone around the joint, so elbows/knees bend smoothly instead of showing the seam
 * of two capsules. Rest pose hangs along -Y from the pivot at the origin.
 */

export interface LimbSpec {
  /** Upper and lower segment lengths. */
  l1: number;
  l2: number;
  /** Radius profile sampled along 0 (shoulder/hip) .. 1 (wrist/ankle). */
  radius: (t: number) => number;
  segments?: number;
  rings?: number;
  /** Fraction of total length over which the weights cross-fade around the joint. */
  blend?: number;
  /** Material slot for the surface at 0..1 along the limb (armor bands, cuffs...). */
  band?: (t: number) => number;
}

export interface Limb {
  mesh: SkinnedMesh;
  upper: Bone;
  fore: Bone;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const limbGeometry2 = (spec: LimbSpec): BufferGeometry => {
  const seg = scaleSeg(spec.segments ?? 16, 8);
  const rings = scaleSeg(spec.rings ?? 20, 10);
  const capRings = scaleSeg(4, 2);
  const total = spec.l1 + spec.l2;
  const joint = spec.l1 / total;
  const blend = spec.blend ?? 0.16;
  const pos: number[] = [];
  const idx: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];

  const weightAt = (t: number): number => smooth(joint - blend * 0.5, joint + blend * 0.5, t);
  const pushVertex = (x: number, y: number, z: number, t: number): void => {
    pos.push(x, y, z);
    const w = weightAt(t);
    skinIndex.push(0, 1, 0, 0);
    skinWeight.push(1 - w, w, 0, 0);
  };

  // Rounded top cap (shoulder ball), body rings, rounded bottom cap.
  const rows: { y: number; r: number; t: number }[] = [];
  const r0 = spec.radius(0);
  // Top cap: a hemisphere from +r0 down to the pivot plane.
  for (let i = 0; i < capRings; i += 1) {
    const a = (i / capRings) * (Math.PI / 2);
    rows.push({ y: r0 * Math.cos(a), r: Math.max(0.001, r0 * Math.sin(a)), t: 0 });
  }
  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    rows.push({ y: -total * t, r: spec.radius(t), t });
  }
  const rEnd = spec.radius(1);
  for (let i = 1; i <= capRings; i += 1) {
    const a = (i / capRings) * (Math.PI / 2);
    rows.push({ y: -total - rEnd * Math.sin(a), r: Math.max(0.001, rEnd * Math.cos(a)), t: 1 });
  }

  for (const row of rows) {
    for (let s = 0; s < seg; s += 1) {
      const a = (s / seg) * Math.PI * 2;
      pushVertex(Math.cos(a) * row.r, row.y, Math.sin(a) * row.r, row.t);
    }
  }
  const groups: { start: number; count: number; mat: number }[] = [];
  for (let r = 0; r < rows.length - 1; r += 1) {
    const start = idx.length;
    for (let s = 0; s < seg; s += 1) {
      const a = r * seg + s;
      const b = r * seg + ((s + 1) % seg);
      const c = (r + 1) * seg + s;
      const d = (r + 1) * seg + ((s + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
    const mid = (rows[r].t + rows[r + 1].t) / 2;
    const mat = spec.band ? spec.band(mid) : 0;
    const last = groups[groups.length - 1];
    if (last && last.mat === mat) last.count += idx.length - start;
    else groups.push({ start, count: idx.length - start, mat });
  }
  const geo = new BufferGeometry();
  for (const g of groups) geo.addGroup(g.start, g.count, g.mat);
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new Float32BufferAttribute(skinWeight, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
};

export const makeLimb = (spec: LimbSpec, material: Material | Material[]): Limb => {
  const geo = limbGeometry2(spec);
  const mesh = new SkinnedMesh(geo, material);
  const upper = new Bone();
  const fore = new Bone();
  fore.position.y = -spec.l1;
  upper.add(fore);
  mesh.add(upper);
  mesh.bind(new Skeleton([upper, fore]));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return { mesh, upper, fore };
};
