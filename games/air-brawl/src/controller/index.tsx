/**
 * Phone surface. A private screen: lobby setup + fighter select, the touch
 * control surface during play, and a personal result card afterwards.
 */
import { AudioRuntime, useAirJamController, useAudio, useControllerToasts } from "@air-jam/sdk";
import { useEffect, useRef } from "react";
import { AIR_BRAWL_SOUNDS, type AirBrawlSoundId } from "../game/contracts/sounds";
import { useMatchStore } from "../game/session/store";
import { EndedPanel } from "./components/ended-panel";
import { LobbyPanel } from "./components/lobby-panel";
import { PlayScreen } from "./components/play-screen";
import { useControllerRuntime } from "./hooks/use-controller-runtime";

export function ControllerView() {
  return (
    <AudioRuntime manifest={AIR_BRAWL_SOUNDS}>
      <PhoneApp />
    </AudioRuntime>
  );
}

const ConnectionBanner = ({ connection }: { connection: string }) => {
  if (connection === "connected") return null;
  const connecting = connection === "connecting" || connection === "reconnecting";
  return (
    <div className="ab-safe pointer-events-none absolute inset-x-0 top-0 z-50">
      <div className="mx-auto mt-2 w-fit rounded-full border-2 border-amber-300/70 bg-black/80 px-4 py-1.5 text-xs font-black tracking-[0.18em] text-amber-200 uppercase backdrop-blur">
        {connecting ? "Reconnecting — your fighter is waiting…" : "Disconnected — reopen the link to rejoin"}
      </div>
    </div>
  );
};

function PhoneApp() {
  const controllerId = useAirJamController((s) => s.controllerId);
  const phase = useMatchStore((s) => s.matchPhase);
  const me = useMatchStore((s) => (controllerId ? s.players[controllerId] : undefined));
  const { pipe, connected, connection } = useControllerRuntime();
  const { latestToast } = useControllerToasts();
  const audio = useAudio<AirBrawlSoundId>();
  const lastPhase = useRef(phase);

  // Soft UI sounds on the phone: ready blip when the match is about to start.
  useEffect(() => {
    if (lastPhase.current !== "countdown" && phase === "countdown") audio.play("go", { volume: 0.5 });
    lastPhase.current = phase;
  }, [phase, audio]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05060f] text-white" style={{ touchAction: phase === "lobby" || phase === "ended" ? "pan-y" : "none" }}>
      <ConnectionBanner connection={connection} />
      {latestToast && (
        <div
          className="ab-safe pointer-events-none absolute inset-x-0 top-8 z-40 mx-auto w-fit max-w-[90%] rounded-xl px-4 py-2 text-center text-sm font-black"
          style={{ background: `${latestToast.color ?? "#38bdf8"}33`, color: latestToast.color ?? "#bae6fd", border: `2px solid ${latestToast.color ?? "#38bdf8"}` }}
        >
          {latestToast.message}
        </div>
      )}
      {!me ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/30 border-t-cyan-300" />
          <div className="text-sm font-black tracking-[0.25em] text-slate-300 uppercase">Joining the brawl…</div>
        </div>
      ) : phase === "lobby" ? (
        <LobbyPanel me={me} />
      ) : phase === "ended" ? (
        <EndedPanel me={me} />
      ) : (
        <PlayScreen me={me} pipe={pipe} connected={connected} />
      )}
    </div>
  );
}
