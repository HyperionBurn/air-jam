import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { glowCard, type BuildCtx } from "./stage-common";

interface HazardVisual {
  group: Group;
  beam: Mesh;
  beamMat: MeshBasicMaterial;
  core: MeshBasicMaterial;
  warn: Mesh;
  warnMat: MeshBasicMaterial;
  flare: Mesh;
  laser: Mesh;
  laserMat: MeshBasicMaterial;
  glow: PointLight;
  drone?: Group;
  kind: "beam" | "geyser";
}

/**
 * Telegraphed hazards for every stage: a drone strike (beam) or a molten geyser.
 * Warn phase = ground ring + aiming laser / bubbling vent; fire phase = column, flare and light.
 */
export const buildHazards = (ctx: BuildCtx, colors: { beam: number; geyser: number } = { beam: 0xff5ad8, geyser: 0xff7a2d }): void => {
  const { def, group, track } = ctx;
  const droneBody = track(new SphereGeometry(26, 20, 14));
  const droneMat = track(new MeshStandardMaterial({ color: 0x3a3558, roughness: 0.3, metalness: 0.85 }));
  const visuals: HazardVisual[] = def.hazards.map((h) => {
    const color = h.kind === "beam" ? colors.beam : colors.geyser;
    const hg = new Group();
    const height = h.bottom - h.top;
    const beamMat = track(new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }));
    const beam = new Mesh(track(new CylinderGeometry(h.w * 0.5, h.w * 0.5, height, 28, 1, true)), beamMat);
    beam.position.y = -(h.top + h.bottom) / 2;
    beam.visible = false;
    const coreMat = track(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false, fog: false }));
    beam.add(new Mesh(track(new CylinderGeometry(h.w * 0.2, h.w * 0.2, height, 16, 1, true)), coreMat));
    const halo = new Mesh(
      track(new CylinderGeometry(h.w * 0.85, h.w * 0.85, height, 24, 1, true)),
      track(new MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false })),
    );
    beam.add(halo);
    const warnMat = track(new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }));
    const warn = new Mesh(track(new TorusGeometry(h.w * 0.55, 3.5, 6, 44)), warnMat);
    warn.rotation.x = Math.PI / 2;
    warn.visible = false;
    const flare = glowCard(color, h.w * 4.2, h.w * 4.2, 0.8, false);
    flare.visible = false;
    const laserMat = track(new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, fog: false }));
    const laser = new Mesh(track(new BoxGeometry(2.2, height, 2.2)), laserMat);
    laser.position.y = -(h.top + h.bottom) / 2;
    laser.visible = false;
    const glow = new PointLight(color, 0, 700, 1.6);
    hg.add(beam, warn, flare, laser, glow);
    let drone: Group | undefined;
    if (h.kind === "beam") {
      drone = new Group();
      const body = new Mesh(droneBody, droneMat);
      body.scale.set(1.6, 0.62, 1);
      body.castShadow = true;
      drone.add(body);
      const eye = new Mesh(track(new SphereGeometry(9, 12, 8)), track(new MeshBasicMaterial({ color, fog: false })));
      eye.position.set(0, -10, 20);
      drone.add(eye);
      for (const s of [-1, 1]) {
        const fin = new Mesh(track(new BoxGeometry(44, 4, 18)), droneMat);
        fin.position.set(s * 40, 4, 0);
        fin.rotation.z = s * 0.18;
        drone.add(fin);
        const thr = glowCard(0x9be8ff, 60, 60, 0.8, false);
        thr.position.set(s * 52, -6, 8);
        drone.add(thr);
      }
      drone.position.y = -h.top - 20;
      hg.add(drone);
    }
    hg.visible = false;
    group.add(hg);
    return { group: hg, beam, beamMat, core: coreMat, warn, warnMat, flare, laser, laserMat, glow, drone, kind: h.kind };
  });

  ctx.animators.push((world, time) => {
    def.hazards.forEach((h, i) => {
      const hv = visuals[i];
      const hs = world.hazardState[i];
      if (!hv || !hs) return;
      if (hs.phase === "idle") {
        hv.group.visible = false;
        hv.glow.intensity = 0;
        return;
      }
      hv.group.visible = true;
      const x = h.xs[hs.lane % h.xs.length];
      hv.group.position.set(x, 0, 0);
      const groundY = h.kind === "beam" ? 4 : -h.bottom * 0.2;
      if (hv.drone) hv.drone.position.x = Math.sin(time * 0.05) * 6;
      if (hs.phase === "warn") {
        hv.beam.visible = false;
        hv.flare.visible = false;
        hv.warn.visible = true;
        hv.warn.position.y = groundY;
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(time * 0.35));
        hv.warnMat.opacity = 0.35 + 0.55 * pulse;
        hv.warn.scale.setScalar(1 + 0.18 * Math.sin(time * 0.5));
        hv.laser.visible = h.kind === "beam";
        hv.laserMat.opacity = 0.25 + 0.35 * pulse;
        hv.glow.intensity = 6e4 * (0.4 + 0.3 * pulse);
        hv.glow.position.set(0, 20, 60);
      } else {
        hv.beam.visible = true;
        hv.warn.visible = false;
        hv.laser.visible = false;
        hv.flare.visible = true;
        hv.flare.position.set(0, groundY + 30, 30);
        hv.flare.scale.setScalar(1 + 0.12 * Math.sin(time * 2.4));
        hv.beamMat.opacity = 0.62 + 0.2 * Math.sin(time * 1.4);
        hv.beam.scale.x = hv.beam.scale.z = 1 + 0.07 * Math.sin(time * 2.2);
        hv.glow.intensity = 3e5;
        hv.glow.position.set(0, 120, 80);
      }
    });
  });
};
