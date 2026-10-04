import { FIGHTER_IDS, FIGHTERS } from "../../game/data/fighters";
import { useMatchStore } from "../../game/session/store";
import type { FighterId } from "../../game/sim/types";
import { slotStyle } from "../../game/view/palette";
import { FighterPortrait, StatPips } from "../../ui/identity";
import { Section } from "./atoms";

/** Private fighter browser: lives on the phone so the projector stays clean. */
export const FighterPicker = ({
  slot,
  selected,
  locked,
  onPicked,
}: {
  slot: number;
  selected: FighterId;
  locked: boolean;
  onPicked?: () => void;
}) => {
  const actions = useMatchStore.useActions();
  const def = FIGHTERS[selected];
  const style = slotStyle(slot);
  return (
    <Section title="Choose fighter" hint={locked ? "Locked — tap Ready again to change" : undefined}>
      <div className="grid grid-cols-4 gap-1.5">
        {FIGHTER_IDS.map((id) => {
          const isSel = id === selected;
          return (
            <button
              key={id}
              type="button"
              disabled={locked}
              onClick={() => {
                void actions.setFighter({ fighterId: id });
                onPicked?.();
              }}
              aria-label={FIGHTERS[id].name}
              aria-pressed={isSel}
              className="flex flex-col items-center rounded-xl border-2 px-1 pt-1 pb-1.5 transition active:scale-95 disabled:opacity-50"
              style={{
                borderColor: isSel ? style.color : "rgba(255,255,255,0.12)",
                background: isSel ? `${style.color}2a` : "rgba(255,255,255,0.04)",
                boxShadow: isSel ? `0 0 16px ${style.color}66` : "none",
              }}
            >
              <FighterPortrait fighter={id} slot={slot} size={54} />
              <span className="mt-0.5 text-[10px] font-black tracking-[0.1em] uppercase">{FIGHTERS[id].name}</span>
            </button>
          );
        })}
      </div>
      <div
        className="mt-2.5 flex items-center gap-3 rounded-xl p-2.5"
        style={{ background: `linear-gradient(135deg, ${style.color}22, transparent 70%)`, border: `1px solid ${style.color}55` }}
      >
        <FighterPortrait fighter={selected} slot={slot} size={104} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[22px] leading-none font-black tracking-[0.06em] uppercase">{def.name}</div>
          <div className="mb-1.5 text-[11px] font-bold tracking-[0.18em] text-slate-300 uppercase">{def.archetype}</div>
          <div className="space-y-0.5">
            <StatPips label="Speed" value={def.stats.speed} color="#37f2d0" />
            <StatPips label="Weight" value={def.stats.weight} color="#7cb8ff" />
            <StatPips label="Power" value={def.stats.power} color="#ff7a5c" />
            <StatPips label="Recovery" value={def.stats.recovery} color="#b9a4ff" />
            <StatPips label="Skill" value={def.stats.difficulty} color="#ffd23d" />
          </div>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-snug font-semibold text-slate-300">{def.blurb}</p>
      <ul className="mt-1 space-y-0.5 text-[11px] font-bold text-slate-400">
        {def.moveHints.map((hint) => (
          <li key={hint}>• {hint}</li>
        ))}
      </ul>
    </Section>
  );
};
