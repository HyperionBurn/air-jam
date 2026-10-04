import { useState } from "react";
import { STAGE_IDS, STAGES } from "../../game/data/stages";
import { PRESETS } from "../../game/session/reducers";
import { useMatchStore } from "../../game/session/store";
import type { MatchSettings } from "../../game/session/types";
import { BigButton, Section, Segmented } from "./atoms";

/** Match setup — only the room leader sees this; everyone else just sees results on the projector. */
export const SetupPanel = ({ canStart, accent }: { canStart: boolean; accent: string }) => {
  const settings = useMatchStore((s) => s.settings);
  const actions = useMatchStore.useActions();
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<MatchSettings>) => void actions.updateSettings({ patch: p });

  return (
    <Section title="Match setup" hint="You're the room leader">
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Quick preset</div>
          <Segmented
            accent={accent}
            value={settings.preset}
            onChange={(preset) => patch({ preset })}
            options={(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => ({ value: k, label: PRESETS[k].label, sub: PRESETS[k].blurb }))}
          />
        </div>

        {canStart && (
          <BigButton color="#ffd23d" onClick={() => void actions.startMatch({ force: true })}>
            Start now
          </BigButton>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-black tracking-[0.22em] text-slate-200 uppercase"
        >
          {open ? "Hide" : "Show"} all options
        </button>

        {open && (
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Mode</div>
              <Segmented
                accent={accent}
                value={settings.mode}
                onChange={(mode) => patch({ mode })}
                options={[
                  { value: "stock", label: "Stocks", sub: "last one standing" },
                  { value: "timed", label: "Timed", sub: "most KOs wins" },
                ]}
              />
            </div>
            {settings.mode === "stock" ? (
              <div>
                <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Stocks</div>
                <Segmented accent={accent} value={settings.stocks} onChange={(stocks) => patch({ stocks })} options={[1, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))} />
              </div>
            ) : (
              <div>
                <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Minutes</div>
                <Segmented accent={accent} value={settings.timeMinutes} onChange={(timeMinutes) => patch({ timeMinutes })} options={[2, 3, 4, 5].map((n) => ({ value: n, label: `${n}:00` }))} />
              </div>
            )}
            <div>
              <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Stage</div>
              <Segmented
                accent={accent}
                columns={2}
                value={settings.stage}
                onChange={(stage) => patch({ stage })}
                options={[
                  { value: "vote", label: "Player vote" },
                  { value: "random", label: "Random" },
                  ...STAGE_IDS.map((id) => ({ value: id, label: STAGES[id].name })),
                ]}
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Items</div>
              <Segmented
                accent={accent}
                value={settings.items}
                onChange={(items) => patch({ items })}
                options={[
                  { value: "off", label: "Off" },
                  { value: "low", label: "Low" },
                  { value: "normal", label: "Normal" },
                  { value: "chaos", label: "Chaos" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Hazards</div>
                <Segmented accent={accent} value={settings.hazards} onChange={(hazards) => patch({ hazards })} options={[{ value: true, label: "On" }, { value: false, label: "Off" }]} />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Teams</div>
                <Segmented accent={accent} value={settings.teams} onChange={(teams) => patch({ teams })} options={[{ value: false, label: "FFA" }, { value: true, label: "Teams" }]} />
              </div>
            </div>
            {settings.teams && (
              <div>
                <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Friendly fire</div>
                <Segmented accent={accent} value={settings.friendlyFire} onChange={(friendlyFire) => patch({ friendlyFire })} options={[{ value: false, label: "Off" }, { value: true, label: "On" }]} />
              </div>
            )}
            <div>
              <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">CPU fighters</div>
              <Segmented accent={accent} columns={8} value={settings.botCount} onChange={(botCount) => patch({ botCount })} options={[0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} />
            </div>
            {settings.botCount > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">CPU skill</div>
                <Segmented
                  accent={accent}
                  value={settings.botDifficulty}
                  onChange={(botDifficulty) => patch({ botDifficulty })}
                  options={[
                    { value: "easy", label: "Easy" },
                    { value: "medium", label: "Medium" },
                    { value: "hard", label: "Hard" },
                  ]}
                />
              </div>
            )}
            <div>
              <div className="mb-1 text-[11px] font-black tracking-[0.2em] text-slate-300 uppercase">Event mode</div>
              <Segmented
                accent={accent}
                value={settings.eventMode}
                onChange={(eventMode) => patch({ eventMode })}
                options={[
                  { value: true, label: "On", sub: "auto rematch" },
                  { value: false, label: "Off", sub: "manual rematch" },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </Section>
  );
};
