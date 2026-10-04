import { Texture } from "pixi.js";
import { SLOT_STYLES, shapePoints, type SlotShape } from "./palette";

export interface GameTextures {
  glow: Texture;
  dot: Texture;
  ring: Texture;
  streak: Texture;
  star: Texture;
  smoke: Texture;
  shapes: Record<SlotShape, Texture>;
}

const makeCanvas = (size: number, height = size): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for texture generation");
  return [canvas, ctx];
};

/** Generate all procedural textures once. White-on-transparent so sprites can be tinted. */
export const createTextures = (): GameTextures => {
  // Soft radial glow.
  const [glowCanvas, g] = makeCanvas(128);
  {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.14)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }

  // Crisp dot with soft edge.
  const [dotCanvas, d] = makeCanvas(32);
  {
    const grad = d.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.95)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    d.fillStyle = grad;
    d.fillRect(0, 0, 32, 32);
  }

  // Ring.
  const [ringCanvas, r] = makeCanvas(128);
  {
    r.strokeStyle = "rgba(255,255,255,1)";
    r.lineWidth = 7;
    r.beginPath();
    r.arc(64, 64, 56, 0, Math.PI * 2);
    r.stroke();
    r.strokeStyle = "rgba(255,255,255,0.35)";
    r.lineWidth = 14;
    r.beginPath();
    r.arc(64, 64, 52, 0, Math.PI * 2);
    r.stroke();
  }

  // Horizontal streak (tapers to a point on the right).
  const [streakCanvas, s] = makeCanvas(128, 24);
  {
    const grad = s.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.65)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    s.fillStyle = grad;
    s.beginPath();
    s.moveTo(0, 12);
    s.lineTo(100, 2);
    s.lineTo(128, 12);
    s.lineTo(100, 22);
    s.closePath();
    s.fill();
  }

  // Four-point star flash.
  const [starCanvas, st] = makeCanvas(128);
  {
    const cx = 64;
    const cy = 64;
    const grad = st.createRadialGradient(cx, cy, 0, cx, cy, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    st.fillStyle = grad;
    st.beginPath();
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      const rad = i % 4 === 0 ? 64 : i % 2 === 0 ? 24 : 12;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i === 0) st.moveTo(x, y);
      else st.lineTo(x, y);
    }
    st.closePath();
    st.fill();
  }

  // Smoke puff.
  const [smokeCanvas, sm] = makeCanvas(64);
  {
    const grad = sm.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,0.7)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    sm.fillStyle = grad;
    sm.fillRect(0, 0, 64, 64);
  }

  // One texture per slot shape.
  const shapes = {} as Record<SlotShape, Texture>;
  for (const style of SLOT_STYLES) {
    const [canvas, c] = makeCanvas(64);
    const pts = shapePoints(style.shape);
    c.fillStyle = "#ffffff";
    c.strokeStyle = "rgba(255,255,255,0.4)";
    c.lineWidth = 3;
    c.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const x = 32 + pts[i] * 24;
      const y = 32 + pts[i + 1] * 24;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.stroke();
    shapes[style.shape] = Texture.from(canvas);
  }

  return {
    glow: Texture.from(glowCanvas),
    dot: Texture.from(dotCanvas),
    ring: Texture.from(ringCanvas),
    streak: Texture.from(streakCanvas),
    star: Texture.from(starCanvas),
    smoke: Texture.from(smokeCanvas),
    shapes,
  };
};
