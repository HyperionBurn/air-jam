import { useEffect, useState } from "react";
import { leaderIdOf } from "../../game/session/reducers";
import { useMatchStore } from "../../game/session/store";
import type { PlayerEntry } from "../../game/session/types";
import { slotStyle } from "../../game/view/palette";
import { ShapeIcon } from "../../ui/identity";
import { BigButton } from "./atoms";
import { FighterPicker } from "./fighter-picker";

const ordinal = (n: number): string => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl bg-white/[0.07] p-2.5 text-center">
    <div className="text-2xl font-black tabular-nums">{value}</div>
    <div className="text-[10px] font-black tracking-[0.2em] text-slate-400 uppercase">{label}</div>
  </div>
);

/** Personal result card + quick fighter swap + rematch. */
export const EndedPanel = ({ me }: { me: PlayerEntry }) => {
  const summary = useMatchStore((s) => s.matchSummary);
  const rematchAtMs = useMatchStore((s) => s.rematchAtMs);
  const players = useMatchStore((s) => s.players);
  const actions = useMatchStore.useActions();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const [swap, setSwap] = useState(false);
  const style = slotStyle(me.slot);
  const mine = summary?.results.find((r) => r.id === me.id);
  const isLeader = leaderIdOf({ players }) === me.id;
  const seconds = rematchAtMs ? Math.max(0, Math.ceil((rematchAtMs - now) / 1000)) : null;
  const won = !!mine?.winner;

  return (
    <div className="ab-safe flex h-full min-h-0 flex-col" style={{ background: `radial-gradient(120% 70% at 50% 0%, ${style.color}40, #05060f 70%)` }}>
      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pt-4 pb-3" style={{ touchAction: "pan-y" }}>
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <ShapeIcon slot={me.slot} size={30} className="h-7 w-7" />
            <div className="text-xs font-black tracking-[0.3em] uppercase" style={{ color: style.light }}>
              {me.name}
            </div>
          </div>
          <div className="ab-pop text-6xl font-black uppercase" style={{ color: won ? "#ffe27a" : "#fff", textShadow: "0 5px 0 #05070f" }}>
            {won ? "Victory!" : mine ? ordinal(mine.place) : "Done"}
          </div>
          {summary && (
            <div className="text-sm font-bold text-slate-300">
              {summary.winnerLabel === "Draw" ? "It's a draw" : `${summary.winnerLabel} wins`}
            </div>
          )}
        </div>

        {mine && (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="KOs" value={mine.kos} />
            <Stat label="Falls" value={mine.falls} />
            <Stat label="Damage dealt" value={`${mine.damageDealt}%`} />
            <Stat label="Longest stock" value={`${Math.floor(mine.survivalSec / 60)}:${(mine.survivalSec % 60).toString().padStart(2, "0")}`} />
          </div>
        )}

        {swap && <FighterPicker slot={me.slot} selected={me.fighterId} locked={false} />}
      </div>

      <div className="space-y-2 border-t border-white/10 bg-[#070b18]/95 p-3">
        <BigButton color="#34d399" onClick={() => void actions.rematch()}>
          Rematch{seconds !== null ? ` · ${seconds}` : ""}
        </BigButton>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSwap((s) => !s)}
            className="min-h-[46px] rounded-xl border-2 border-white/20 bg-white/5 text-xs font-black tracking-[0.16em] uppercase"
          >
            {swap ? "Done" : "Change fighter"}
          </button>
          <button
            type="button"
            disabled={!isLeader}
            onClick={() => void actions.returnToLobby()}
            className="min-h-[46px] rounded-xl border-2 border-white/20 bg-white/5 text-xs font-black tracking-[0.16em] uppercase disabled:opacity-40"
          >
            Lobby{isLeader ? "" : " (leader)"}
          </button>
        </div>
      </div>
    </div>
  );
};
