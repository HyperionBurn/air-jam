import { ControllerPlayerNameField } from "@air-jam/sdk/ui";
import { useEffect, useState } from "react";
import { STAGE_IDS, STAGES } from "../../game/data/stages";
import { getReadiness, leaderIdOf } from "../../game/session/reducers";
import { useMatchStore } from "../../game/session/store";
import type { PlayerEntry } from "../../game/session/types";
import { slotStyle, TEAM_STYLES } from "../../game/view/palette";
import { ShapeIcon } from "../../ui/identity";
import { phonePrefs, usePhonePrefs, usePortrait } from "../hooks/use-controller-runtime";
import { BigButton, Section, Segmented } from "./atoms";
import { FighterPicker } from "./fighter-picker";
import { SetupPanel } from "./setup-panel";

const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
};

export const LobbyPanel = ({ me }: { me: PlayerEntry }) => {
  const players = useMatchStore((s) => s.players);
  const settings = useMatchStore((s) => s.settings);
  const autoStartAtMs = useMatchStore((s) => s.autoStartAtMs);
  const actions = useMatchStore.useActions();
  const prefs = usePhonePrefs();
  const portrait = usePortrait();
  const now = useNow(autoStartAtMs !== null);
  const style = slotStyle(me.slot);
  const state = { players };
  const readiness = getReadiness(state);
  const isLeader = leaderIdOf(state) === me.id;
  const seconds = autoStartAtMs ? Math.max(0, Math.ceil((autoStartAtMs - now) / 1000)) : null;
  const votes = new Map<string, number>();
  for (const p of Object.values(players)) if (p.stageVote && (p.connected || p.isBot)) votes.set(p.stageVote, (votes.get(p.stageVote) ?? 0) + 1);

  return (
    <div className="ab-safe flex h-full min-h-0 flex-col" style={{ touchAction: "pan-y" }}>
      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pt-3 pb-4" style={{ touchAction: "pan-y" }}>
        <div
          className="flex items-center gap-3 rounded-2xl border-2 p-3"
          style={{ borderColor: style.color, background: `linear-gradient(120deg, ${style.color}33, rgba(255,255,255,0.03))` }}
        >
          <ShapeIcon slot={me.slot} size={44} className="h-11 w-11 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black tracking-[0.24em] uppercase" style={{ color: style.light }}>
              P{me.slot + 1} · {style.name}
              {isLeader && <span className="ml-2 rounded-full bg-amber-300 px-2 py-0.5 text-[9px] text-black">LEADER</span>}
            </div>
            <ControllerPlayerNameField
              fieldLabel="Your name"
              className="mt-0.5"
              labelClassName="sr-only"
              inputClassName="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-lg font-black text-white outline-none focus:border-cyan-300"
            />
          </div>
        </div>

        {portrait && (
          <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-center text-[12px] font-bold text-cyan-100">
            Tip: turn your phone sideways for the best controls
          </div>
        )}

        <FighterPicker slot={me.slot} selected={me.fighterId} locked={me.ready} />

        {settings.stage === "vote" && (
          <Section title="Vote for a stage" hint="Most votes wins">
            <div className="grid gap-1.5">
              {STAGE_IDS.map((id) => {
                const selected = me.stageVote === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void actions.voteStage({ stage: selected ? null : id })}
                    className="flex items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition active:scale-[0.98]"
                    style={{
                      borderColor: selected ? style.color : "rgba(255,255,255,0.14)",
                      background: selected ? `${style.color}26` : "rgba(255,255,255,0.05)",
                    }}
                  >
                    <div
                      className="h-10 w-14 shrink-0 rounded-lg"
                      style={{ background: `linear-gradient(${STAGES[id].theme.skyTop}, ${STAGES[id].theme.skyBottom})`, border: `2px solid ${STAGES[id].theme.platformEdge}` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black tracking-[0.06em] uppercase">{STAGES[id].name}</div>
                      <div className="text-[11px] font-semibold text-slate-400">{STAGES[id].tagline}</div>
                    </div>
                    <div className="text-lg font-black text-amber-300">{votes.get(id) ?? 0}</div>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {settings.teams && (
          <Section title="Your team">
            <Segmented
              value={me.team}
              disabled={me.ready}
              onChange={(team) => void actions.setTeam({ team })}
              options={[0, 1].map((t) => ({ value: t, label: TEAM_STYLES[t].name }))}
              accent={style.color}
            />
          </Section>
        )}

        {isLeader && <SetupPanel canStart={readiness.canStart} accent={style.color} />}

        <Section title="This phone">
          <div className="grid grid-cols-3 gap-1.5">
            <Segmented
              columns={1}
              value={prefs.haptics}
              onChange={(haptics) => phonePrefs.set({ haptics })}
              options={[{ value: true, label: "Haptics on" }]}
              accent={style.color}
            />
            <Segmented
              columns={1}
              value={prefs.mirrored}
              onChange={(mirrored) => phonePrefs.set({ mirrored })}
              options={[{ value: true, label: "Lefty layout" }]}
              accent={style.color}
            />
            <Segmented
              columns={1}
              value={prefs.hints}
              onChange={(hints) => phonePrefs.set({ hints })}
              options={[{ value: true, label: "Button hints" }]}
              accent={style.color}
            />
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center text-[10px] font-bold text-slate-400">
            <button type="button" onClick={() => phonePrefs.set({ haptics: !prefs.haptics })} className="underline decoration-dotted">{prefs.haptics ? "tap to disable" : "tap to enable"}</button>
            <button type="button" onClick={() => phonePrefs.set({ mirrored: !prefs.mirrored })} className="underline decoration-dotted">{prefs.mirrored ? "left-handed" : "right-handed"}</button>
            <button type="button" onClick={() => phonePrefs.set({ hints: !prefs.hints })} className="underline decoration-dotted">{prefs.hints ? "shown" : "hidden"}</button>
          </div>
        </Section>
      </div>

      <div className="border-t border-white/10 bg-[#070b18]/95 p-3 backdrop-blur">
        <BigButton
          padReady
          pulse={me.ready}
          color={me.ready ? style.color : "#34d399"}
          textColor={me.ready ? "#05070f" : "#04210f"}
          onClick={() => void actions.setReady({ ready: !me.ready })}
        >
          {me.ready ? (seconds !== null ? `Starting in ${seconds}…` : "Ready ✓ tap to cancel") : "Ready!"}
        </BigButton>
        <div className="mt-1.5 text-center text-[11px] font-bold text-slate-400">
          {readiness.ready}/{readiness.humans} ready · fight starts automatically when everyone is ready
        </div>
      </div>
    </div>
  );
};
