import { useAirJamHost } from "@air-jam/sdk";
import { RoomQrCode } from "@air-jam/sdk/ui";
import { useEffect, useState } from "react";
import { FIGHTERS } from "../../game/data/fighters";
import { STAGES } from "../../game/data/stages";
import { getReadiness, leaderIdOf, PRESETS, participantsOf } from "../../game/session/reducers";
import { useMatchStore } from "../../game/session/store";
import type { PlayerEntry } from "../../game/session/types";
import { PAD_LABELS, type PadKind } from "../../game/net/gamepad";
import { slotStyle } from "../../game/view/palette";
import { FighterPortrait, ShapeIcon, TeamChip } from "../../ui/identity";
import { useLocalPads } from "../runtime/local-pads";

const useNow = (active: boolean, intervalMs = 100): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
};

const SlotCard = ({ slot, player, teams, padKind, stageLabel }: { slot: number; player?: PlayerEntry; teams: boolean; padKind?: PadKind; stageLabel: string }) => {
  const style = slotStyle(slot);
  if (!player) {
    return (
      <div className="flex min-h-0 flex-col items-center justify-center rounded-[2.2vh] border-[0.35vh] border-dashed border-white/15 bg-white/[0.03] text-white/30">
        <div className="text-[3.4vh] font-black">+</div>
        <div className="text-[1.5vh] font-black tracking-[0.2em] uppercase">Open slot</div>
      </div>
    );
  }
  const def = FIGHTERS[player.fighterId];
  const offline = !player.isBot && !player.connected;
  return (
    <div
      className="relative flex min-h-0 flex-col overflow-hidden rounded-[2.2vh] border-[0.4vh] bg-[#0a1124]/85 backdrop-blur-sm transition-all"
      style={{
        borderColor: offline ? "#7a8099" : style.color,
        boxShadow: player.ready ? `0 0 3vh ${style.color}88, inset 0 0 3vh ${style.color}22` : "none",
        opacity: offline ? 0.55 : 1,
      }}
    >
      <div className="flex items-center gap-[0.8vh] px-[1.2vh] py-[0.8vh]" style={{ background: `${style.color}33` }}>
        <ShapeIcon slot={slot} size={28} className="h-[3.2vh] w-[3.2vh]" />
        <div className="truncate text-[2.1vh] font-black" style={{ color: style.light }}>
          {player.name}
        </div>
        <div className="ml-auto flex items-center gap-[0.6vh]">
          {teams && <TeamChip team={player.team} className="text-[1.5vh]" />}
          {player.isBot && (
            <span className="rounded-full bg-white/15 px-[0.9vh] py-[0.1vh] text-[1.3vh] font-black tracking-[0.15em] uppercase">CPU</span>
          )}
          {player.local && (
            <span className="rounded-full bg-cyan-300/90 px-[0.9vh] py-[0.1vh] text-[1.3vh] font-black tracking-[0.15em] text-[#04202a] uppercase">Pad</span>
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden py-[0.4vh]">
        <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 70%, ${style.color}30, transparent 65%)` }} />
        <FighterPortrait fighter={player.fighterId} slot={slot} size={116} className="relative h-[94%] w-auto max-w-full" dim={offline} />
      </div>
      <div className="px-[1.2vh] pb-[1vh] text-center">
        <div className="text-[2vh] leading-none font-black tracking-[0.08em] uppercase">{def.name}</div>
        <div className="mt-[0.3vh] text-[1.35vh] font-bold tracking-[0.14em] text-slate-300 uppercase">{def.archetype}</div>
        <div
          className="mt-[0.8vh] rounded-full py-[0.5vh] text-[1.6vh] font-black tracking-[0.2em] uppercase"
          style={{
            background: offline ? "#3a3f55" : player.ready ? style.color : "rgba(255,255,255,0.12)",
            color: offline ? "#b9bfd6" : player.ready ? "#05070f" : "#e6ecff",
          }}
        >
          {offline ? (player.local ? "Pad unplugged" : "Reconnecting…") : player.ready ? "Ready" : "Choosing"}
        </div>
        {player.local && !offline && padKind && (
          <div className="mt-[0.6vh] text-[1.25vh] leading-tight font-bold tracking-[0.06em] text-slate-300 uppercase">
            {player.ready ? (
              <>
                <b className="text-white">{PAD_LABELS[padKind].back}</b> un-ready
              </>
            ) : (
              <>
                <b className="text-white">◀ ▶</b> fighter · <b className="text-white">{PAD_LABELS[padKind].confirm}</b> ready
                <br />
                <b className="text-white">▲ ▼</b> stage: {player.stageVote ? STAGES[player.stageVote].name : stageLabel}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const LobbyScreen = () => {
  const host = useAirJamHost();
  const players = useMatchStore((s) => s.players);
  const settings = useMatchStore((s) => s.settings);
  const autoStartAtMs = useMatchStore((s) => s.autoStartAtMs);
  const scoreboard = useMatchStore((s) => s.scoreboard);
  const now = useNow(autoStartAtMs !== null);
  const pads = useLocalPads();
  const padKinds = new Map(pads.map((p) => [p.id, p.kind] as const));
  const waitingPads = pads.filter((p) => p.connected && !p.joined).length;
  const state = { players };
  const readiness = getReadiness(state);
  const leader = leaderIdOf(state);
  const leaderName = leader ? players[leader]?.name : null;
  const bySlot = new Map<number, PlayerEntry>();
  for (const p of participantsOf(state)) bySlot.set(p.slot, p);
  for (const p of Object.values(players)) if (!bySlot.has(p.slot)) bySlot.set(p.slot, p);
  const count = Math.max(4, Math.min(8, Math.max(...[...bySlot.keys(), -1]) + 1));
  const stageLabel =
    settings.stage === "vote" ? "Player vote" : settings.stage === "random" ? "Random" : STAGES[settings.stage].name;
  const secondsLeft = autoStartAtMs ? Math.max(0, Math.ceil((autoStartAtMs - now) / 1000)) : null;
  const leaderboard = Object.values(scoreboard).sort((a, b) => b.wins - a.wins || b.kos - a.kos).slice(0, 4);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-[1.6vh] bg-gradient-to-b from-[#05060f]/78 via-[#05060f]/38 to-[#05060f]/82 p-[2.4vh]">
      <header className="flex items-start justify-between gap-[3vh]">
        <div>
          <div className="text-[1.6vh] font-black tracking-[0.5em] text-cyan-300/90 uppercase">Air Jam presents</div>
          <h1
            className="text-[9vh] leading-[0.9] font-black tracking-[-0.02em] uppercase"
            style={{ textShadow: "0 0.6vh 0 #05070f, 0 0 4vh rgba(90,215,255,0.55)" }}
          >
            Air <span className="text-cyan-300">Brawl</span>
          </h1>
          <p className="mt-[1vh] max-w-[60vh] text-[2.3vh] font-bold text-slate-200">
            Scan the code. Pick a fighter. Hit Ready. Knock everyone off the map.
          </p>
          <p className="mt-[0.6vh] text-[1.8vh] font-black tracking-[0.06em] text-cyan-200 uppercase">
            🎮{" "}
            {waitingPads > 0
              ? `${waitingPads} controller${waitingPads > 1 ? "s" : ""} detected - press any button to join`
              : "Plug in an Xbox or PlayStation controller and press any button to join"}
          </p>
          <div className="mt-[1.4vh] flex flex-wrap gap-[1vh] text-[1.7vh] font-black tracking-[0.12em] uppercase">
            {[
              settings.mode === "timed" ? `${settings.timeMinutes}:00 timed` : `${settings.stocks} stocks`,
              `Stage: ${stageLabel}`,
              settings.teams ? "Teams" : "Free-for-all",
              `Items: ${settings.items}`,
              PRESETS[settings.preset].label,
              ...(settings.hazards ? [] : ["No hazards"]),
              ...(settings.botCount > 0 ? [`${settings.botCount} CPU (${settings.botDifficulty})`] : []),
            ].map((label) => (
              <span key={label} className="rounded-full border-2 border-white/20 bg-white/10 px-[1.4vh] py-[0.5vh] text-slate-100">
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-[2vh] rounded-[2.4vh] border-[0.4vh] border-white/20 bg-white p-[1.6vh] text-[#07102a] shadow-2xl">
          <div className="bg-white">
            <RoomQrCode value={host.joinUrl || host.roomId || "airjam"} size={320} padding={1} className="h-[22vh] w-[22vh]" />
          </div>
          <div className="pr-[1vh] text-center">
            <div className="text-[1.5vh] font-black tracking-[0.3em] text-slate-500 uppercase">Room code</div>
            <div className="text-[7.5vh] leading-none font-black tracking-[0.12em]">{host.roomId ?? "····"}</div>
            <div className="mt-[1vh] text-[1.7vh] font-bold text-slate-600">Scan with your phone camera</div>
            <div className="mt-[0.4vh] max-w-[26vh] truncate text-[1.25vh] font-semibold text-slate-400">{host.joinUrl}</div>
          </div>
        </div>
      </header>

      <main className={`grid min-h-0 flex-1 grid-cols-4 gap-[1.6vh] ${count > 4 ? "grid-rows-2" : "grid-rows-1"}`}>
        {Array.from({ length: count > 4 ? 8 : 4 }, (_, slot) => (
          <SlotCard
            key={slot}
            slot={slot}
            player={bySlot.get(slot)}
            teams={settings.teams}
            padKind={bySlot.get(slot) ? padKinds.get(bySlot.get(slot)!.id) : undefined}
            stageLabel={stageLabel}
          />
        ))}
      </main>

      <footer className="flex items-center justify-between gap-[2vh] pr-[270px]">
        <div className="flex items-center gap-[2vh] text-[2vh] font-bold text-slate-200">
          <span className="rounded-full bg-white/10 px-[1.6vh] py-[0.8vh] font-black tracking-[0.15em] uppercase">
            {readiness.ready}/{readiness.humans} ready
          </span>
          {leaderName ? (
            leader && players[leader]?.local ? (
              <span>
                <span className="text-cyan-300">{leaderName}</span> runs setup:{" "}
                <b className="text-white">LB / RB</b> CPUs · <b className="text-white">Y</b> mode · <b className="text-white">Start</b> begins
              </span>
            ) : (
              <span>
                <span className="text-cyan-300">{leaderName}</span> runs match setup from their phone
              </span>
            )
          ) : (
            <span>Waiting for the first fighter to scan in or press a button…</span>
          )}
        </div>
        {leaderboard.length > 0 && (
          <div className="hidden items-center gap-[1.6vh] text-[1.7vh] font-black uppercase xl:flex">
            <span className="tracking-[0.2em] text-slate-400">Session wins</span>
            {leaderboard.map((e) => (
              <span key={e.name} className="flex items-center gap-[0.6vh] rounded-full bg-white/10 px-[1.2vh] py-[0.5vh]">
                <ShapeIcon slot={e.slot} size={18} className="h-[2.2vh] w-[2.2vh]" />
                {e.name} <span className="text-amber-300">{e.wins}</span>
              </span>
            ))}
          </div>
        )}
        {secondsLeft !== null ? (
          <div className="rounded-[2vh] bg-emerald-400 px-[3vh] py-[1.2vh] text-[3.4vh] font-black tracking-[0.12em] text-[#04210f] uppercase shadow-[0_0_4vh_#34d39988]">
            Starting in {secondsLeft}
          </div>
        ) : (
          <div className="text-[1.9vh] font-bold text-slate-300">Everyone ready → fight starts automatically</div>
        )}
      </footer>
    </div>
  );
};
