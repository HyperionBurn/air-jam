import {
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** Colour grade, vignette and impact chromatic aberration, applied in linear light before tone mapping. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.32 },
    aberration: { value: 0 },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    flash: { value: 0 },
    flashColor: { value: [1, 1, 1] },
    center: { value: new Vector2(0.5, 0.5) },
    zoomBlur: { value: 0 },
    tint: { value: [1, 1, 1] },
    lift: { value: [0, 0, 0] },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float aberration; uniform float saturation; uniform float contrast;
    uniform float flash; uniform vec3 flashColor; uniform vec2 center; uniform float zoomBlur; uniform vec3 tint; uniform vec3 lift; varying vec2 vUv;
    void main(){
      vec2 d = vUv - center;
      vec2 off = d * aberration;
      vec3 col;
      if (zoomBlur > 0.001) {
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 8; i++) { float k = float(i) / 8.0; acc += texture2D(tDiffuse, vUv - d * zoomBlur * k).rgb; }
        col = acc / 8.0;
      } else {
        col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.18) * contrast + 0.18;
      col = col * tint + lift * (1.0 - clamp(l * 2.0, 0.0, 1.0));
      float v = smoothstep(0.95, 0.25, length(d) * 1.25);
      col *= mix(1.0 - vignette, 1.0, v);
      col = mix(col, flashColor * 3.0, flash);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class PostStack {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  bloomEnabled = true;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    width: number,
    height: number,
  ) {
    const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(width, height), 0.5, 0.65, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  /**
   * Multisampling of the scene target (4 = full, 0 = off). A 4x half-float target is the single biggest
   * fill cost on an integrated GPU, so the quality governor steps it down first.
   */
  setMsaa(samples: number): void {
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples === samples) continue;
      target.samples = samples;
      target.dispose();
    }
  }

  /** Apply a stage's authored grade and bloom character. */
  setLook(look: { bloom: { strength: number; radius: number; threshold: number }; grade: { saturation: number; contrast: number; tint: [number, number, number]; lift: [number, number, number]; vignette: number } }): void {
    this.bloom.strength = look.bloom.strength;
    this.bloom.radius = look.bloom.radius;
    this.bloom.threshold = look.bloom.threshold;
    const u = this.grade.uniforms;
    u.saturation.value = look.grade.saturation;
    u.contrast.value = look.grade.contrast;
    u.tint.value = look.grade.tint;
    u.lift.value = look.grade.lift;
    this.baseVignette = look.grade.vignette;
    u.vignette.value = look.grade.vignette;
  }

  baseVignette = 0.3;

  setEffects(reduced: boolean): void {
    this.bloomEnabled = !reduced;
    this.bloom.enabled = !reduced;
  }

  /** Impact aberration (0..1), screen flash (0..1) and radial zoom blur (0..0.1). */
  setImpact(aberration: number, flash: number, flashColor: [number, number, number], zoomBlur: number, cx = 0.5, cy = 0.5): void {
    const u = this.grade.uniforms;
    u.aberration.value = aberration;
    u.flash.value = flash;
    u.flashColor.value = flashColor;
    u.zoomBlur.value = zoomBlur;
    u.center.value.set(cx, cy);
  }

  setVignette(v: number): void {
    this.grade.uniforms.vignette.value = v;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}

export type { Scene };
