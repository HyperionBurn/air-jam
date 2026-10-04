import { FIGHTERS } from "../../game/data/fighters";
import { useMatchStore } from "../../game/session/store";
import type { PlayerEntry } from "../../game/session/types";
import { mixHex, slotStyle, TEAM_STYLES } from "../../game/view/palette";
import { ShapeIcon } from "../../ui/identity";
import type { InputPipe } from "../runtime/input-pipe";
import { usePhonePrefs, usePortrait } from "../hooks/use-controller-runtime";
import { ControlSurface } from "./control-surface";

/** Lightweight private state strip. Eyes stay on the projector. */
const StatusStrip = ({ me }: { me: PlayerEntry }) => {
  const hud = useMatchStore((s) => s.hud[me.id]);
  const settings = useMatchStore((s) => s.settings);
  const spec = useMatchStore((s) => s.matchSpec);
  const style = slotStyle(me.slot);
  const percent = hud?.percent ?? 0;
  const heat = Math.min(1, percent / 180);
  const color = heat < 0.5 ? mixHex("#ffffff", "#ffd23d", heat * 2) : mixHex("#ffd23d", "#ff3b3b", (heat - 0.5) * 2);
  const timed = (spec?.mode ?? settings.mode) === "timed";
  const stocks = hud?.stocks ?? 0;
  const status = !me.connected ? "OFFLINE" : hud?.status === "respawning" ? "RESPAWNING" : hud?.status === "out" ? "OUT" : "";
  const team = spec?.teams ? TEAM_STYLES[me.team % TEAM_STYLES.length] : null;
  return (
    <div
      className="ab-safe pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-3 px-3 py-2"
      style={{ background: "linear-gradient(180deg, rgba(5,6,15,0.92), rgba(5,6,15,0))" }}
    >
      <ShapeIcon slot={me.slot} size={34} className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[15px] font-black" style={{ color: style.light }}>
          {me.name}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-slate-300 uppercase">
          {FIGHTERS[me.fighterId].name}
          {team && (
            <span style={{ color: team.color }} className="font-black">
              {team.name.replace(" Team", "")}
            </span>
          )}
          {status && <span className="font-black text-amber-300">{status}</span>}
        </div>
      </div>
      {timed ? (
        <div className="text-right text-xl font-black text-amber-200">{hud?.score ?? 0}<span className="ml-1 text-[10px] tracking-widest text-slate-400">KO</span></div>
      ) : (
        <div className="flex gap-1">
          {Array.from({ length: Math.min(stocks, 6) }, (_, i) => (
            <ShapeIcon key={i} slot={me.slot} size={20} className="h-4 w-4" />
          ))}
        </div>
      )}
      <div className="w-[4.4rem] text-right text-[34px] leading-none font-black tabular-nums" style={{ color, textShadow: "0 3px 0 #05070f" }}>
        {percent}
        <span className="text-[18px]">%</span>
      </div>
    </div>
  );
};

/** Gameplay screen: controls fill the phone; the strip floats on top. */
export const PlayScreen = ({ me, pipe, connected }: { me: PlayerEntry; pipe: InputPipe; connected: boolean }) => {
  const phase = useMatchStore((s) => s.matchPhase);
  const hud = useMatchStore((s) => s.hud[me.id]);
  const prefs = usePhonePrefs();
  const portrait = usePortrait();
  const style = slotStyle(me.slot);
  const counting = phase === "countdown";
  // Respawn: the phone pulses the player's colour so they look up at the projector.
  const respawning = hud?.status === "respawning";

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: `radial-gradient(120% 90% at 50% 120%, ${style.color}26, #05060f 60%)` }}>
      <StatusStrip me={me} />
      <ControlSurface pipe={pipe} disabled={!connected} haptic={prefs.haptics} mirrored={prefs.mirrored} showHints={prefs.hints || counting} accent={style.color} />
      {counting && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] z-10 text-center">
          <div className="ab-pop text-[34px] font-black tracking-[0.18em] text-amber-200 uppercase" style={{ textShadow: "0 4px 0 #05070f" }}>
            Get ready
          </div>
          <div className="mt-1 text-sm font-bold text-slate-200">
            {portrait ? "Left thumb moves · right thumb fights" : "Stick moves · flick it + Attack for a smash"}
          </div>
        </div>
      )}
      {hud?.status === "out" && (
        <div className="pointer-events-none absolute inset-x-0 top-[34%] z-10 text-center text-3xl font-black tracking-[0.2em] text-rose-300 uppercase" style={{ textShadow: "0 4px 0 #05070f" }}>
          You're out
          <div className="text-sm font-bold tracking-normal text-slate-300 normal-case">Watch the big screen</div>
        </div>
      )}
      {respawning && (
        <div className="ab-respawn-flash pointer-events-none absolute inset-0 z-20" style={{ background: style.color }} />
      )}
    </div>
  );
};
