import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Tapered capsule hanging from its pivot (y = 0) down to y = -length. */
export const limbGeometry = (length: number, rTop: number, rBottom: number, segments = 18): BufferGeometry => {
  const pts: Vector2[] = [];
  const cap = 5;
  // Top hemisphere (centred on the pivot).
  for (let i = 0; i <= cap; i += 1) {
    const a = Math.PI / 2 - (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(Math.cos(a) * rTop, Math.sin(a) * rTop));
  }
  const body = 4;
  for (let i = 1; i <= body; i += 1) {
    const t = i / body;
    const swell = Math.sin(t * Math.PI) * Math.min(rTop, rBottom) * 0.1;
    pts.push(new Vector2(rTop + (rBottom - rTop) * t + swell, -length * t));
  }
  // Bottom hemisphere.
  for (let i = 1; i <= cap; i += 1) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(Math.cos(a) * rBottom, -length - Math.sin(a) * rBottom));
  }
  return new LatheGeometry(pts, segments);
};

export const roundedBox = (w: number, h: number, d: number, radius: number, segments = 3): BufferGeometry =>
  new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, Math.min(w, h, d) / 2 - 0.001));

export const ellipsoid = (rx: number, ry: number, rz: number, seg = 20): BufferGeometry => {
  const g = new SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7)));
  g.scale(rx, ry, rz);
  return g;
};

/** Lathe from a (radius, y) profile. */
export const lathe = (profile: [number, number][], segments = 24): BufferGeometry =>
  new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );

export const cone = (r: number, h: number, seg = 10): BufferGeometry => {
  const g = new CylinderGeometry(0, r, h, seg, 1);
  g.translate(0, h / 2, 0);
  return g;
};

/** Simple vertical gradient baked into vertex colours (cheap fake AO / sheen). */
export const bakeGradient = (geo: BufferGeometry, bottom: Color, top: Color, minY: number, maxY: number): void => {
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) - minY) / Math.max(1e-6, maxY - minY)));
    c.lerpColors(bottom, top, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
};

export const mesh = (geo: BufferGeometry, mat: Material, cast = true, receive = false): Mesh => {
  const m = new Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
};

export interface MatOptions {
  metalness?: number;
  roughness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  rim?: number;
  rimStrength?: number;
  vertexColors?: boolean;
  envMapIntensity?: number;
}

/**
 * Standard material with an added fresnel rim term. Rim light is what makes a
 * character read against dark backdrops without outlines.
 */
export const stdMat = (color: number, o: MatOptions = {}): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({
    color,
    metalness: o.metalness ?? 0.25,
    roughness: o.roughness ?? 0.5,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    vertexColors: o.vertexColors ?? false,
    envMapIntensity: o.envMapIntensity ?? 1,
  });
  const rimColor = new Color(o.rim ?? 0x9fd8ff);
  const rimStrength = o.rimStrength ?? 0.55;
  m.userData.rim = { color: rimColor, strength: rimStrength };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimStrength = { value: rimStrength };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;")
      .replace(
        "#include <opaque_fragment>",
        `float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.6);
         outgoingLight += rimColor * rimF * rimStrength;
         #include <opaque_fragment>`,
      );
  };
  return m;
};
