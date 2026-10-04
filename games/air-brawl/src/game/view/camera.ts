import type { StageDef, World } from "../sim/types";

/**
 * Shared dynamic camera. Frames every active fighter with padding, zooms out
 * as they separate and in as the fight tightens, never leaves the stage's
 * camera box, and is critically-damped so it never snaps or induces nausea.
 */
export class Camera {
  x = 0;
  y = -120;
  zoom = 0.8;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  shakeX = 0;
  shakeY = 0;
  private shakePower = 0;
  private impulseX = 0;
  private impulseY = 0;
  /** Current Dutch-angle roll (radians). */
  roll = 0;
  /** Extra zoom punch from impacts (decays). */
  private punch = 0;
  reducedShake = false;
  /** Debug/QA: pin the camera (used by the model viewer). */
  override: { x: number; y: number; zoom: number } | null = null;
  /** Pixels at the bottom reserved for HUD cards; the arena is framed above them. */
  inset = 0;

  /** Target zoom bounds (pixels per world unit) are derived from the viewport. */
  update(
    world: World | null,
    stage: StageDef,
    viewW: number,
    viewH: number,
    dtSec: number,
  ): void {
    if (this.override) {
      this.x = this.override.x;
      this.y = this.override.y;
      this.zoom = this.override.zoom;
      this.shakePower = 0;
      this.punch = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      this.impulseX = 0;
      this.impulseY = 0;
      this.roll = 0;
      return;
    }
    const fullH = viewH;
    viewH = Math.max(120, viewH - this.inset);
    let targetX = 0;
    let targetY = -150;
    let targetZoom = 0.7;
    const aspect = viewW / viewH;

    if (world) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let count = 0;
      for (const f of world.fighters) {
        if (!f.alive || f.vanished) continue;
        if (f.state === "respawn" && f.sf < 70) continue;
        // Fighters launched far outside the blast zone stop pulling the camera.
        const b = stage.blast;
        const out = Math.max(0, f.x - b.right, b.left - f.x, f.y - b.bottom, b.top - f.y);
        if (out > 40) continue;
        // Anticipate: frame where a fast fighter is heading, strongest for launched ones.
        const launched = f.state === "hitstun" && f.hitlag === 0;
        const leadX = Math.max(-260, Math.min(260, f.vx * (launched ? 16 : 7)));
        const leadY = Math.max(-160, Math.min(200, f.vy * (launched ? 9 : 4)));
        minX = Math.min(minX, f.x, f.x + leadX);
        maxX = Math.max(maxX, f.x, f.x + leadX);
        minY = Math.min(minY, f.y - f.def.height, f.y + leadY - f.def.height);
        maxY = Math.max(maxY, f.y, f.y + leadY);
        count += 1;
      }
      if (count > 0) {
        // Duels frame tighter; crowds loosen up so nobody is lost at the edge.
        const crowd = Math.min(1, Math.max(0, (count - 2) / 4));
        const padX = 250 + crowd * 150;
        const padTop = 250 + crowd * 70;
        const padBottom = 190 + crowd * 50;
        const boxW = Math.max(1120, maxX - minX + padX * 2);
        const boxH = Math.max(630, maxY - minY + padTop + padBottom);
        targetX = (minX + maxX) / 2;
        targetY = (minY + maxY) / 2 + (padBottom - padTop) / 2;
        targetZoom = Math.min(viewW / boxW, viewH / boxH);
      } else {
        targetX = 0;
        targetY = -100;
        targetZoom = Math.min(viewW / 1700, viewH / 960);
      }
      if (world.spotlight && world.spotlight.frames > 0) {
        const s = world.spotlight;
        targetX = targetX * 0.35 + s.x * 0.65;
        targetY = targetY * 0.35 + s.y * 0.65;
        targetZoom = Math.max(targetZoom, Math.min(viewW / 1000, viewH / 560) * 1.05);
      }
    }

    // Zoom limits: never farther than the stage camera box, never closer than a tight fight.
    const box = stage.camera;
    const maxView = Math.min(viewW / (box.right - box.left), viewH / (box.bottom - box.top));
    const minZoom = Math.max(0.12, maxView * 0.92);
    const maxZoom = Math.min(viewW / 1120, viewH / 630);
    targetZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));

    // Keep the view inside the camera box.
    const halfW = viewW / (2 * targetZoom);
    const halfH = viewH / (2 * targetZoom);
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    targetX = halfW * 2 >= box.right - box.left ? cx : Math.max(box.left + halfW, Math.min(box.right - halfW, targetX));
    targetY = halfH * 2 >= box.bottom - box.top ? cy : Math.max(box.top + halfH, Math.min(box.bottom - halfH, targetY));
    void aspect;
    void fullH;

    // Critically damped spring (frame-rate independent).
    const dt = Math.min(0.05, dtSec);
    const omega = 4.6;
    const step = (cur: number, target: number, vel: number, w: number): [number, number] => {
      const x = cur - target;
      const exp = Math.exp(-w * dt);
      const temp = (vel + w * x) * dt;
      return [target + (x + temp) * exp, (vel - w * temp) * exp];
    };
    [this.x, this.vx] = step(this.x, targetX, this.vx, omega);
    [this.y, this.vy] = step(this.y, targetY, this.vy, omega);
    [this.zoom, this.vz] = step(this.zoom, targetZoom, this.vz, omega * 0.8);

    this.shakePower *= Math.exp(-9 * dt);
    this.punch *= Math.exp(-8 * dt);
    this.impulseX *= Math.exp(-10 * dt);
    this.impulseY *= Math.exp(-10 * dt);
    this.roll *= Math.exp(-5.5 * dt);
    const damp = this.reducedShake ? 0.2 : 1;
    const amp = this.shakePower * damp;
    // A kick along the knockback axis plus a little isotropic rattle: heavy hits read as directional.
    this.shakeX = (Math.random() - 0.5) * 2 * amp * 0.55 + this.impulseX * damp;
    this.shakeY = (Math.random() - 0.5) * 2 * amp * 0.55 + this.impulseY * damp;
  }

  /** Impact camera kick. (dx, dy) is the knockback direction in sim space (y down). */
  shake(power: number, dx = 0, dy = 0): void {
    this.shakePower = Math.min(46, this.shakePower + power);
    const len = Math.hypot(dx, dy);
    if (len > 0.01) {
      const k = power * 1.1;
      this.impulseX = Math.max(-60, Math.min(60, this.impulseX + (dx / len) * k));
      this.impulseY = Math.max(-60, Math.min(60, this.impulseY + (dy / len) * k));
    }
  }

  /** Brief Dutch-angle snap on big hits (radians, decays). */
  rollKick(angle: number): void {
    if (this.reducedShake) return;
    this.roll = Math.max(-0.06, Math.min(0.06, this.roll + angle));
  }

  zoomPunch(amount: number): void {
    this.punch = Math.min(0.12, this.punch + (this.reducedShake ? amount * 0.25 : amount));
  }

  /** Apply to the world container. */
  apply(target: { scale: { set: (v: number) => void }; position: { set: (x: number, y: number) => void } }, viewW: number, viewH: number): void {
    const z = this.zoom * (1 + this.punch);
    target.scale.set(z);
    target.position.set(viewW / 2 - this.x * z + this.shakeX, (viewH - this.inset) / 2 - this.y * z + this.shakeY);
  }

  /** World → screen projection (for HUD anchors). */
  toScreen(wx: number, wy: number, viewW: number, viewH: number): { x: number; y: number } {
    const z = this.zoom * (1 + this.punch);
    return { x: viewW / 2 + (wx - this.x) * z + this.shakeX, y: (viewH - this.inset) / 2 + (wy - this.y) * z + this.shakeY };
  }

  get scale(): number {
    return this.zoom * (1 + this.punch);
  }
}
