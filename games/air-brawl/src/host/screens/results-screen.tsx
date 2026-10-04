import { useEffect, useState } from "react";
import { FIGHTERS } from "../../game/data/fighters";
import { STAGES } from "../../game/data/stages";
import { useMatchStore } from "../../game/session/store";
import type { ResultEntry } from "../../game/session/types";
import { slotStyle, TEAM_STYLES } from "../../game/view/palette";
import { FighterPortrait, ShapeIcon } from "../../ui/identity";

const formatTime = (sec: number): string => `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;

const Row = ({ r, timed, rank }: { r: ResultEntry; timed: boolean; rank: number }) => {
  const style = slotStyle(r.slot);
  return (
    <div
      className="grid grid-cols-[3.2vh_4.2vh_1fr_8vh_9vh_9vh_8vh] items-center gap-[1.2vh] rounded-[1.4vh] px-[1.4vh] py-[0.9vh]"
      style={{ background: r.winner ? `${style.color}33` : "rgba(255,255,255,0.06)", border: `0.3vh solid ${r.winner ? style.color : "transparent"}` }}
    >
      <div className="text-[2.6vh] font-black text-white/80">{rank}</div>
      <ShapeIcon slot={r.slot} size={30} className="h-[3.6vh] w-[3.6vh]" />
      <div className="min-w-0">
        <div className="truncate text-[2.4vh] font-black" style={{ color: style.light }}>
          {r.name}
          {r.isBot && <span className="ml-[0.8vh] text-[1.3vh] font-black tracking-widest text-white/50">CPU</span>}
        </div>
        <div className="text-[1.3vh] font-bold tracking-[0.15em] text-slate-400 uppercase">{FIGHTERS[r.fighterId].name}</div>
      </div>
      <div className="text-right text-[2.3vh] font-black text-amber-300">
        {timed ? r.score : r.kos}
        <span className="ml-[0.4vh] text-[1.2vh] font-bold tracking-widest text-slate-400">{timed ? "PTS" : "KOs"}</span>
      </div>
      <div className="text-right text-[2.1vh] font-black">
        {r.damageDealt}
        <span className="ml-[0.4vh] text-[1.2vh] font-bold tracking-widest text-slate-400">DMG</span>
      </div>
      <div className="text-right text-[2.1vh] font-black">
        {r.falls}
        <span className="ml-[0.4vh] text-[1.2vh] font-bold tracking-widest text-slate-400">FALLS</span>
      </div>
      <div className="text-right text-[2.1vh] font-black">{formatTime(r.survivalSec)}</div>
    </div>
  );
};

export const ResultsScreen = () => {
  const summary = useMatchStore((s) => s.matchSummary);
  const rematchAtMs = useMatchStore((s) => s.rematchAtMs);
  const scoreboard = useMatchStore((s) => s.scoreboard);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);
  // Let the victory moment breathe before the panel slides in.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), 900);
    return () => window.clearTimeout(id);
  }, []);
  if (!summary) return null;
  const winner = summary.results.find((r) => r.winner);
  const timed = summary.mode === "timed";
  const remaining = rematchAtMs ? Math.max(0, Math.ceil((rematchAtMs - now) / 1000)) : null;
  const winnerStyle = winner ? slotStyle(winner.slot) : null;
  const teamStyle = summary.teams && summary.winnerTeam >= 0 ? TEAM_STYLES[summary.winnerTeam % TEAM_STYLES.length] : null;
  const board = Object.values(scoreboard).sort((a, b) => b.wins - a.wins || b.kos - a.kos || a.falls - b.falls);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-end bg-gradient-to-l from-[#05060f]/95 via-[#05060f]/70 to-transparent p-[3vh] transition-opacity duration-700"
      style={{ opacity: shown ? 1 : 0 }}
    >
      <div className="flex max-h-full w-[78vh] flex-col gap-[1.6vh] overflow-hidden">
        <div className="text-center">
          <div className="text-[2vh] font-black tracking-[0.5em] text-amber-300 uppercase">
            {summary.reason === "time" ? "Time!" : summary.reason === "draw" ? "Draw" : "Game"}
          </div>
          <div className="flex items-center justify-center gap-[2vh]">
            {winner && !summary.teams && <FighterPortrait fighter={winner.fighterId} slot={winner.slot} size={110} className="h-[14vh] w-auto" />}
            <div>
              <div
                className="text-[10vh] leading-[0.95] font-black uppercase"
                style={{ color: teamStyle?.color ?? winnerStyle?.light ?? "#fff", textShadow: "0 0.6vh 0 #05070f, 0 0 3vh currentColor" }}
              >
                {summary.winnerLabel === "Draw" ? "Draw" : "Victory"}
              </div>
              <div className="text-[5vh] font-black" style={{ color: teamStyle?.color ?? winnerStyle?.color ?? "#fff" }}>
                {summary.winnerLabel !== "Draw" ? summary.winnerLabel.toUpperCase() : "Nobody wins"}
              </div>
            </div>
          </div>
          <div className="mt-[0.6vh] text-[1.7vh] font-bold tracking-[0.2em] text-slate-300 uppercase">
            {STAGES[summary.stageId].name} · {formatTime(summary.durationSec)}
          </div>
        </div>

        <div className="flex flex-col gap-[0.8vh]">
          {summary.results.map((r, i) => (
            <Row key={r.id} r={r} timed={timed} rank={i + 1} />
          ))}
        </div>

        {board.length > 0 && summary.results.length > 0 && (
          <div className="rounded-[1.8vh] border-[0.3vh] border-white/15 bg-white/5 p-[1.4vh]">
            <div className="mb-[0.8vh] text-[1.5vh] font-black tracking-[0.3em] text-cyan-300 uppercase">Session leaderboard</div>
            <div className="grid grid-cols-[1fr_5vh_5vh_5vh_9vh] gap-x-[1.4vh] gap-y-[0.4vh] text-[1.8vh] font-bold">
              <div className="text-[1.2vh] tracking-widest text-slate-400 uppercase">Player</div>
              <div className="text-right text-[1.2vh] tracking-widest text-slate-400 uppercase">Wins</div>
              <div className="text-right text-[1.2vh] tracking-widest text-slate-400 uppercase">KOs</div>
              <div className="text-right text-[1.2vh] tracking-widest text-slate-400 uppercase">Falls</div>
              <div className="text-right text-[1.2vh] tracking-widest text-slate-400 uppercase">Dmg</div>
              {board.slice(0, 6).map((e) => (
                <div key={e.name + e.slot} className="contents">
                  <div className="flex items-center gap-[0.8vh] truncate">
                    <ShapeIcon slot={e.slot} size={20} className="h-[2.4vh] w-[2.4vh]" />
                    {e.name}
                  </div>
                  <div className="text-right text-amber-300">{e.wins}</div>
                  <div className="text-right">{e.kos}</div>
                  <div className="text-right">{e.falls}</div>
                  <div className="text-right">{e.damageDealt}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-[2.4vh] font-black tracking-[0.12em] uppercase">
          {remaining !== null ? (
            <span className="text-emerald-300">Rematch in {remaining}…</span>
          ) : (
            <span className="text-slate-300">Leader taps Rematch on their phone</span>
          )}
          <div className="mt-[0.4vh] text-[1.5vh] font-bold tracking-[0.15em] text-slate-400">Swap fighter or stage on your phone before the next round</div>
        </div>
      </div>
    </div>
  );
};
