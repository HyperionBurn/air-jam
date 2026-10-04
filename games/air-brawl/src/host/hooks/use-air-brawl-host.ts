import { useAirJamHost, useAudio, useGetInput, useHostTick, useSendSignal } from "@air-jam/sdk";
import type { ControllerPresenceNotice } from "@air-jam/sdk/protocol";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AirBrawlSoundId } from "../../game/contracts/sounds";
import { gameInputSchema } from "../../game/net/input-codec";
import { createDiagnostics, type HostDiagnostics } from "../../game/net/diagnostics";
import { MatchRunner } from "../../game/session/match-runner";
import { handlePadMenu, type PadMenuActions } from "../../game/session/pad-menu";
import { useMatchStore } from "../../game/session/store";
import type { MatchSpec, RosterSync } from "../../game/session/types";
import { createWorld, stepWorld } from "../../game/sim/world";
import { GameView3D } from "../../game/view3d/game-view3d";
import type { HudOptions } from "../../game/view/hud";
import { FeedbackRouter } from "../runtime/feedback";
import { isPadId, localPads, useLocalPads } from "../runtime/local-pads";
import { useHostSettings } from "../runtime/host-settings";
import { BotBrain } from "../../game/ai/bot-brain";
import type { World } from "../../game/sim/types";

const ATTRACT_FIGHTERS = ["nova", "volt", "bulwark", "wisp"] as const;
const TICK_MS = 1000 / 60;
const HUD_SYNC_TICKS = 15;
const MAX_STEPS_PER_FRAME = 4;

const rosterFromControllers = (controllers: ControllerPresenceNotice[]): RosterSync[] =>
  controllers.map((c) => ({
    id: c.controllerId,
    name: (c.player?.label ?? c.nickname ?? "Player").slice(0, 24),
    connected: c.connected,
  }));

export interface AirBrawlHost {
  diagnostics: HostDiagnostics;
  /** Re-run the audio runtime unlock (browser autoplay policies). */
  runnerRef: React.MutableRefObject<MatchRunner | null>;
}

/**
 * Host runtime: owns the renderer, the active match, the fixed-step loop and the
 * bridge between Air Jam (controllers, store, signals) and the pure simulation.
 * Nothing in the hot path touches React state.
 */
export function useAirBrawlHost(mountRef: React.RefObject<HTMLElement | null>): AirBrawlHost {
  const host = useAirJamHost();
  const getInput = useGetInput<typeof gameInputSchema>();
  const sendSignal = useSendSignal();
  const audio = useAudio<AirBrawlSoundId>();
  const settings = useHostSettings();
  const actions = useMatchStore.useActions();
  const matchPhase = useMatchStore((s) => s.matchPhase);
  const matchSpec = useMatchStore((s) => s.matchSpec);
  const players = useMatchStore((s) => s.players);
  const telemetry = useMatchStore((s) => s.telemetry);
  const eventMode = useMatchStore((s) => s.settings.eventMode);
  const pads = useLocalPads();

  const viewRef = useRef<GameView3D | null>(null);
  const runnerRef = useRef<MatchRunner | null>(null);
  const attractRef = useRef<{ world: World; brain: BotBrain } | null>(null);
  const feedbackRef = useRef<FeedbackRouter | null>(null);
  const diagRef = useRef<HostDiagnostics>(createDiagnostics());
  const settingsRef = useRef(settings);
  const hostRef = useRef(host);
  const playersRef = useRef(players);
  const phaseRef = useRef(matchPhase);
  const telemetryRef = useRef(telemetry);
  const offlineRef = useRef<Set<string>>(new Set());
  const namesRef = useRef<Record<string, string>>({});
  const teamsRef = useRef(false);
  const timedRef = useRef(false);
  const tickCountRef = useRef(0);
  const lastFrameAtRef = useRef(performance.now());
  const fpsWindowRef = useRef({ frames: 0, since: performance.now() });
  const probeRef = useRef({ id: 0, last: 0 });
  const hudOptionsRef = useRef<HudOptions>({ teams: false, timed: false, names: {}, offline: new Set(), uiScale: 1, showTags: true });
  const endedRef = useRef(false);
  /** Controllers that are silent mid-match (lost Wi-Fi / app backgrounded): shown as OFFLINE on the HUD. */
  const silentRef = useRef<Set<string>>(new Set());
  const offlineUnionRef = useRef<Set<string>>(new Set());

  // Read-only snapshot for QA scripts (headless gamepad / flow checks). No behaviour depends on it.
  useEffect(() => {
    (window as unknown as { __airBrawlState?: () => unknown }).__airBrawlState = () => ({
      phase: phaseRef.current,
      players: Object.values(playersRef.current).map((p) => ({ id: p.id, name: p.name, fighter: p.fighterId, ready: p.ready, local: !!p.local, connected: p.connected, slot: p.slot })),
      fighters: runnerRef.current?.world.fighters.map((f) => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), vx: f.vx, facing: f.facing, state: f.state, moveId: f.moveId, percent: f.percent })) ?? [],
    });
    return () => {
      delete (window as unknown as { __airBrawlState?: unknown }).__airBrawlState;
    };
  }, []);

  settingsRef.current = settings;
  hostRef.current = host;
  playersRef.current = players;
  phaseRef.current = matchPhase;
  telemetryRef.current = telemetry;

  /* ----------------------------------------------------------- RENDERER SETUP */

  const hapticFn = useCallback(
    (controllerId: string, payload: { pattern: "light" | "medium" | "heavy" | "success" | "failure" | "custom" }) => {
      // Pads plugged into this machine rumble locally; everyone else gets the signal over the wire.
      if (isPadId(controllerId)) localPads.rumble(controllerId, payload.pattern);
      else sendSignal("HAPTIC", payload, controllerId);
    },
    [sendSignal],
  );

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) return;
    GameView3D.create(mount)
      .then((view) => {
        if (cancelled) {
          view.destroy();
          return;
        }
        viewRef.current = view;
        view.applySettings(settingsRef.current);
        feedbackRef.current = new FeedbackRouter(audio, hapticFn, view);
        feedbackRef.current.hapticsEnabled = settingsRef.current.haptics;
      })
      .catch((error) => {
        console.error("Air Brawl: renderer failed to start", error);
      });
    return () => {
      cancelled = true;
      feedbackRef.current = null;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Renderer is created once per mount; audio/haptic handles are stable enough to read lazily below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountRef]);

  useEffect(() => {
    viewRef.current?.applySettings(settings);
    if (feedbackRef.current) feedbackRef.current.hapticsEnabled = settings.haptics;
  }, [settings]);

  /* ---------------------------------------------------------------- ROSTER */

  useEffect(() => {
    const remote =
      host.controllers.length > 0
        ? rosterFromControllers(host.controllers)
        : host.players.map((p) => ({ id: p.id, name: p.label, connected: true }));
    // Gamepads on this machine are first-class players alongside phones.
    void actions.syncRoster({ controllers: [...remote, ...localPads.roster()] });
    // `pads` changes whenever a pad joins, leaves or drops, which is when the roster must be re-sent.
  }, [host.controllers, host.players, actions, pads]);

  useEffect(() => {
    const offline = new Set<string>();
    const names: Record<string, string> = {};
    for (const p of Object.values(players)) {
      if (!p.isBot && !p.connected) offline.add(p.id);
      names[p.id] = p.name;
    }
    offlineRef.current = offline;
    namesRef.current = names;
  }, [players]);

  /* ------------------------------------------------------------ MATCH LIFE */

  const specRef = useRef<MatchSpec | null>(null);
  useEffect(() => {
    if (!matchSpec) {
      specRef.current = null;
      if (runnerRef.current) {
        runnerRef.current = null;
        viewRef.current?.reset();
      }
      return;
    }
    if (matchPhase === "countdown" && specRef.current?.matchId !== matchSpec.matchId) {
      specRef.current = matchSpec;
      const runner = new MatchRunner(matchSpec);
      runnerRef.current = runner;
      attractRef.current = null;
      endedRef.current = false;
      teamsRef.current = matchSpec.teams;
      timedRef.current = matchSpec.mode === "timed";
      tickCountRef.current = 0;
      const view = viewRef.current;
      view?.setHudVisible(true);
      view?.setWorld(runner.world);
      view?.announce("3", "#ffe27a", { size: 220, hold: 26 });
      audio.play("countdown");
    }
  }, [matchSpec, matchPhase, audio]);

  // Lobby attract mode: four CPU fighters brawl behind the room code.
  useEffect(() => {
    const view = viewRef.current;
    if (matchPhase !== "lobby" || !settings.attract) {
      attractRef.current = null;
      view?.setHudVisible(true);
      return;
    }
    if (attractRef.current) return;
    let cancelled = false;
    const start = () => {
      const v = viewRef.current;
      if (cancelled) return;
      if (!v) {
        // Renderer still booting; retry shortly.
        window.setTimeout(start, 150);
        return;
      }
      const stage = (["proving-ground", "skyline-rush", "foundry"] as const)[Math.floor(Math.random() * 3)];
      const roster = ATTRACT_FIGHTERS.map((fighterId, i) => ({ id: `attract-${i}`, name: fighterId, fighterId, slot: i, team: i }));
      const world = createWorld({ stageId: stage, stocks: 99, countdownFrames: 0, hazards: false, seed: 77 + Date.now() % 1000, items: "off" }, roster);
      attractRef.current = { world, brain: new BotBrain("medium", 5) };
      runnerRef.current = null;
      v.setWorld(world);
      v.setHudVisible(false);
    };
    start();
    return () => {
      cancelled = true;
    };
  }, [matchPhase, settings.attract]);

  /* ------------------------------------------------------------ MUSIC/TIMERS */

  const musicRef = useRef<{ key: string | null }>({ key: null });
  useEffect(() => {
    const want = matchPhase === "countdown" || matchPhase === "playing" ? "battleMusic" : "menuMusic";
    if (musicRef.current.key === want) return;
    audio.stop("menuMusic");
    audio.stop("battleMusic");
    audio.play(want, { loop: true, fadeInMs: 600 });
    musicRef.current.key = want;
  }, [matchPhase, audio, host.runtimeState]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const state = useMatchStore.getState();
      const now = Date.now();
      if (state.matchPhase === "lobby" && state.autoStartAtMs && now >= state.autoStartAtMs) {
        void actions.startMatch({});
      } else if (state.matchPhase === "ended" && state.rematchAtMs && now >= state.rematchAtMs && eventMode) {
        void actions.rematch();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [actions, eventMode]);

  /* --------------------------------------------------------------- AGENT */

  useMatchStore.useHostActionListener((event) => {
    const runner = runnerRef.current;
    if (!runner) return;
    const actor = event.context.actorId;
    if (event.actionName === "agentControl") runner.control(actor, event.payload as never);
    else if (event.actionName === "agentSetup") runner.setup(actor, event.payload as never);
    else if (event.actionName === "agentStep") {
      const frames = Math.max(1, Math.min(1200, Math.round((event.payload as { frames: number }).frames)));
      const view = viewRef.current;
      const fb = feedbackRef.current;
      if (fb) fb.muted = frames > 8;
      for (let i = 0; i < frames && runner.world.phase !== "over"; i += 1) {
        const inputs = runner.buildInputs(() => undefined, performance.now(), offlineRef.current);
        const events = runner.stepOnce(inputs);
        view?.handleEvents(runner.world);
        if (events.length) {
          fb?.handle(runner.world, events);
          processEvents(runner, events);
        }
      }
      if (fb) fb.muted = false;
      void actions.updateHud({ hud: runner.hud(true) });
    }
  });

  /* ----------------------------------------------------------- EVENT → STORE */

  const processEvents = useCallback(
    (runner: MatchRunner, events: readonly { type: string }[]) => {
      for (const e of events) {
        if (e.type === "fightStart") {
          void actions.beginFight();
        } else if (e.type === "matchEnd" && !endedRef.current) {
          endedRef.current = true;
          void actions.updateHud({ hud: runner.hud(telemetryRef.current) });
          void actions.endMatch({ summary: runner.summary() });
        }
      }
    },
    [actions],
  );

  /* ------------------------------------------------------------- MAIN LOOP */

  const readInput = useCallback((id: string) => (isPadId(id) ? localPads.wire(id, performance.now()) : getInput(id)), [getInput]);

  const padActions = useMemo<PadMenuActions>(
    () => ({
      setFighter: (playerId, fighterId) => void actions.setFighter({ fighterId, playerId }),
      setReady: (playerId, ready) => void actions.setReady({ ready, playerId }),
      setTeam: (playerId, team) => void actions.setTeam({ team, playerId }),
      voteStage: (playerId, stage) => void actions.voteStage({ stage, playerId }),
      updateSettings: (patch) => void actions.updateSettings({ patch }),
      startMatch: (force) => void actions.startMatch({ force }),
      rematch: () => void actions.rematch(),
      returnToLobby: () => void actions.returnToLobby(),
    }),
    [actions],
  );
  const padActionsRef = useRef(padActions);
  padActionsRef.current = padActions;

  useHostTick({
    enabled: true,
    mode: "fixed",
    intervalMs: TICK_MS,
    maxStepsPerFrame: MAX_STEPS_PER_FRAME,
    onTick: ({ now }) => {
      const diag = diagRef.current;
      const t0 = performance.now();
      const runner = runnerRef.current;
      const paused = hostRef.current.runtimeState === "paused";
      diag.stepsPerFrame += 1;

      // Local gamepads: poll once per tick; in the lobby / results they also drive the menus.
      const phase = phaseRef.current;
      const padEdges = localPads.sample(now, phase === "lobby");
      if (phase === "lobby" || phase === "ended") {
        const state = useMatchStore.getState();
        for (const { id, edges } of padEdges) handlePadMenu(id, edges, state, padActionsRef.current);
      }

      if (runner && !paused) {
        const inputs = runner.buildInputs(readInput, now, offlineRef.current);
        const events = runner.advance(inputs);
        if (events) {
          const view = viewRef.current;
          view?.handleEvents(runner.world);
          if (events.length) {
            feedbackRef.current?.handle(runner.world, events);
            processEvents(runner, events);
          }
          tickCountRef.current += 1;
          if (tickCountRef.current % HUD_SYNC_TICKS === 0 && (phaseRef.current === "playing" || phaseRef.current === "countdown")) {
            void actions.updateHud({ hud: runner.hud(telemetryRef.current) });
          }
        }
      } else if (attractRef.current && phaseRef.current === "lobby") {
        const { world, brain } = attractRef.current;
        const inputs = world.fighters.map((_, i) => brain.think(world, i));
        stepWorld(world, inputs);
        // The attract brawl never ends: revive anyone who gets eliminated.
        for (const f of world.fighters) {
          if (!f.alive) {
            f.alive = true;
            f.stocks = 99;
            f.state = "respawn";
            f.sf = 0;
          }
        }
        viewRef.current?.handleEvents(world);
      }

      diag.tickMs.push(performance.now() - t0);
      diag.simFrame = runner?.world.frame ?? 0;
    },
    onFrame: ({ fixedStepAlpha, deltaMs, now }) => {
      const diag = diagRef.current;
      const view = viewRef.current;
      const runner = runnerRef.current;
      const attract = attractRef.current;
      const world = runner?.world ?? attract?.world ?? null;
      diag.frameMs.push(deltaMs);
      if (deltaMs > 25) diag.droppedFrames += 1;
      diag.stepsPerFrame = 0;
      const win = fpsWindowRef.current;
      win.frames += 1;
      if (now - win.since >= 1000) {
        diag.fps = Math.round((win.frames * 1000) / (now - win.since));
        win.frames = 0;
        win.since = now;
        diag.controllers = collectControllerDiag(runner, namesRef.current);
        const silent = new Set<string>();
        for (const c of diag.controllers) if (c.stale && c.inputAgeMs > 2000) silent.add(c.id);
        silentRef.current = silent;
        diag.packetsPerSec = diag.controllers.reduce((n, c) => n + c.packetRate, 0);
      }
      if (!view) return;
      const o = hudOptionsRef.current;
      o.teams = teamsRef.current;
      o.timed = timedRef.current;
      o.names = namesRef.current;
      const union = offlineUnionRef.current;
      union.clear();
      for (const id of offlineRef.current) union.add(id);
      if (runner && phaseRef.current === "playing") for (const id of silentRef.current) union.add(id);
      o.offline = union;
      o.showTags = settingsRef.current.tags;
      o.uiScale = settingsRef.current.uiScale;
      const useAttractHud = !runner && !!attract;
      if (useAttractHud) {
        o.showTags = false;
      }
      view.render(world, fixedStepAlpha, deltaMs, o);
      diag.renderMs.push(view.lastRenderMs);
      diag.quality = view.qualityLevel;
      lastFrameAtRef.current = now;

      // Latency probes (RTT) only while the debug overlay is open.
      if (settingsRef.current.debug && now - probeRef.current.last > 1000) {
        probeRef.current.last = now;
        const id = (probeRef.current.id = (probeRef.current.id + 1) % 100000);
        if (runner) for (const pid of runner.humanIds) runner.decoder(pid)?.noteProbe(id, now);
        hostRef.current.sendState({ message: `probe:${id}` });
      }
    },
  });

  return useMemo(() => ({ diagnostics: diagRef.current, runnerRef }), []);
}

const collectControllerDiag = (runner: MatchRunner | null, names: Record<string, string>) => {
  if (!runner) return [];
  return runner.humanIds.map((id) => {
    const d = runner.decoder(id);
    return {
      id,
      name: names[id] ?? id,
      packetRate: d?.packetRate ?? 0,
      inputAgeMs: Math.round(d?.inputAgeMs ?? 0),
      jitterMs: Math.round((d?.jitterMs ?? 0) * 10) / 10,
      rttMs: d?.rttMs ?? -1,
      stale: d?.stale ?? true,
    };
  });
};

