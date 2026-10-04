/**
 * Host surface: one full-bleed canvas (the arena) with DOM overlays for the
 * lobby, results and tooling. The host owns the authoritative simulation; this
 * file only composes the runtime hook and the screens.
 */
import { AudioRuntime, useAudioRuntimeControls, useAudioRuntimeStatus } from "@air-jam/sdk";
import { HostPreviewControllerWorkspace } from "@air-jam/sdk/preview";
import { useEffect, useRef, useState } from "react";
import { AIR_BRAWL_SOUNDS } from "../game/contracts/sounds";
import { useMatchStore } from "../game/session/store";
import { DebugOverlay } from "./components/debug-overlay";
import { HostMenu } from "./components/host-menu";
import { RoomChip } from "./components/room-chip";
import { useAirBrawlHost } from "./hooks/use-air-brawl-host";
import { useHostSettings, hostSettings } from "./runtime/host-settings";
import { LobbyScreen } from "./screens/lobby-screen";
import { ResultsScreen } from "./screens/results-screen";

export function HostView() {
  return (
    <AudioRuntime manifest={AIR_BRAWL_SOUNDS}>
      <AirBrawlHost />
    </AudioRuntime>
  );
}

const SoundGate = () => {
  const status = useAudioRuntimeStatus();
  const { retry } = useAudioRuntimeControls();
  if (status === "ready") return null;
  return (
    <button
      type="button"
      onClick={() => void retry()}
      className="absolute top-4 left-1/2 z-50 -translate-x-1/2 rounded-full border-2 border-amber-300/70 bg-black/70 px-5 py-2 text-sm font-black tracking-[0.18em] text-amber-200 uppercase shadow-lg backdrop-blur"
    >
      Click to enable sound
    </button>
  );
};

function AirBrawlHost() {
  const mountRef = useRef<HTMLDivElement>(null);
  const phase = useMatchStore((s) => s.matchPhase);
  const settings = useHostSettings();
  const { diagnostics } = useAirBrawlHost(mountRef);
  const [menuOpen, setMenuOpen] = useState(false);

  // Hidden developer tooling: ` toggles the debug overlay; Esc/M opens the host menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "`" || event.key === "~") hostSettings.set({ debug: !hostSettings.get().debug });
      else if (event.key === "Escape") setMenuOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#05060f] text-white">
      <div className="absolute inset-0">
        <div ref={mountRef} className="h-full w-full" />
      </div>
      <SoundGate />
      {phase === "lobby" && <LobbyScreen />}
      {phase === "ended" && <ResultsScreen />}
      {(phase === "playing" || phase === "countdown") && <RoomChip />}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="Host menu"
        className="absolute right-3 bottom-3 z-40 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[11px] font-bold tracking-[0.2em] text-white/70 uppercase opacity-60 backdrop-blur transition hover:opacity-100"
      >
        Menu
      </button>
      {menuOpen && <HostMenu onClose={() => setMenuOpen(false)} />}
      {settings.debug && <DebugOverlay diagnostics={diagnostics} />}
      <HostPreviewControllerWorkspace />
    </div>
  );
}
