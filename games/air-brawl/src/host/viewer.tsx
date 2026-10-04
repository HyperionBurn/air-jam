/**
 * Developer-only animation/model viewer (route `/viewer`, not linked anywhere).
 * Runs the real simulation with scripted inputs up to an exact frame and renders
 * it through the production renderer, so art/animation review is deterministic.
 *
 *   /viewer?fighter=nova&stage=proving-ground&script=jab&frame=26&zoom=5
 *
 * script: idle | run | jab | ftilt | fsmash | usmash | jump | fair | special | shield | hit | dash
 * fighter: nova | volt | bulwark | wisp (index 0); the others stand idle for context.
 */
import { useEffect, useRef } from "react";
import { BTN, createWorld, stepWorld, type FighterId, type InputFrame, type StageId, applyHit } from "../game/sim";
import { GameView3D } from "../game/view3d/game-view3d";

const input = (p: Partial<InputFrame> = {}): InputFrame => ({ mx: 0, my: 0, held: 0, taps: 0, ...p });

const scriptFor = (name: string, frame: number): InputFrame => {
  const f = frame - 20;
  switch (name) {
    case "run":
      return input({ mx: 1, held: 0 });
    case "dash":
      return frame < 21 ? input({ mx: 0 }) : input({ mx: 1 });
    case "jab":
      return f === 0 ? input({ held: BTN.ATTACK, taps: BTN.ATTACK }) : input();
    case "ftilt":
      return f === 0 ? input({ mx: 0.55, held: BTN.ATTACK, taps: BTN.ATTACK }) : input({ mx: 0.1 });
    case "fsmash":
      if (f === -1) return input({ mx: 0.1 });
      if (f === 0) return input({ mx: 1, held: BTN.ATTACK, taps: BTN.ATTACK });
      return input({ mx: 1 });
    case "usmash":
      if (f === 0) return input({ my: -1, held: BTN.ATTACK, taps: BTN.ATTACK });
      return input({ my: -1 });
    case "jump":
      return f === 0 ? input({ held: BTN.JUMP, taps: BTN.JUMP }) : f > 0 && f < 24 ? input({ held: BTN.JUMP }) : input();
    case "fair":
      if (f === 0) return input({ held: BTN.JUMP, taps: BTN.JUMP });
      if (f > 0 && f < 24) return input({ held: BTN.JUMP });
      if (f === 26) return input({ mx: 0.7, held: BTN.ATTACK, taps: BTN.ATTACK });
      return input({ mx: 0.2 });
    case "special":
      return f === 0 ? input({ held: BTN.SPECIAL, taps: BTN.SPECIAL }) : input();
    case "shield":
      return f >= 0 ? input({ held: BTN.SHIELD }) : input();
    default:
      return input();
  }
};

export function ModelViewer() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fighter = (q.get("fighter") ?? "nova") as FighterId;
    const stage = (q.get("stage") ?? "proving-ground") as StageId;
    const script = q.get("script") ?? "idle";
    const target = Number(q.get("frame") ?? 40);
    const zoom = Number(q.get("zoom") ?? 4.5);
    const focus = Number(q.get("focus") ?? 0);
    const others = (q.get("others") ?? "volt,bulwark,wisp").split(",") as FighterId[];
    let view: GameView3D | null = null;
    let cancelled = false;

    const roster = [fighter, ...others].slice(0, 4).map((fighterId, slot) => ({ id: `v${slot}`, name: `P${slot + 1}`, fighterId, slot, team: slot }));
    const world = createWorld({ stageId: stage, countdownFrames: 0, hazards: false, seed: 9 }, roster);
    // Space fighters out so each can be framed alone.
    world.fighters.forEach((f, i) => {
      f.x = -300 + i * 240;
      f.px = f.x;
      f.invuln = 0;
      f.facing = 1;
    });

    const mount = mountRef.current;
    if (!mount) return;
    GameView3D.create(mount).then((v) => {
      if (cancelled) {
        v.destroy();
        return;
      }
      view = v;
      v.setHudVisible(false);
      v.applySettings({ reducedShake: true, reducedEffects: false, uiScale: 1, debug: q.get("debug") === "1" });
      for (let i = 0; i < target; i += 1) {
        const inputs = world.fighters.map((_, idx) => (idx === 0 ? scriptFor(script, i) : input()));
        if (script === "hit" && i === 25) {
          const f0 = world.fighters[0];
          applyHit(world, f0, { damage: 14, angle: 40, baseKb: 60, growth: 90, hitlag: 10, stun: 30, fx: "impact", sfx: "heavy" }, { attacker: 1, moveId: "viewer", dirSign: -1, x: f0.x, y: f0.y - 40 });
        }
        stepWorld(world, inputs);
        v.handleEvents(world);
      }
      const f = world.fighters[focus] ?? world.fighters[0];
      const hudOptions = { teams: false, timed: false, names: {}, offline: new Set<string>(), uiScale: 1, showTags: false };
      v.camera.override = { x: f.x + 30, y: f.y - f.def.height * 0.5, zoom };
      v.setWorld(world);
      for (let i = 0; i < 24; i += 1) v.render(world, 1, 16.7, hudOptions);
      (window as unknown as { __viewerReady?: boolean }).__viewerReady = true;
      const loop = () => {
        if (cancelled) return;
        v.render(world, 1, 16.7, hudOptions);
        requestAnimationFrame(loop);
      };
      loop();
    });
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, []);

  return <div ref={mountRef} className="h-screen w-screen bg-black" />;
}
