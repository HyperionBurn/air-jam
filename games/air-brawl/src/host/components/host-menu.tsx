import { VolumeControls } from "@air-jam/sdk/ui";
import type { ReactNode } from "react";
import { useMatchStore } from "../../game/session/store";
import { hostSettings, useHostSettings } from "../runtime/host-settings";

const Toggle = ({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!on)}
    aria-pressed={on}
    className="flex w-full items-center justify-between gap-4 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
  >
    <span>
      <span className="block text-sm font-black tracking-[0.12em] uppercase">{label}</span>
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </span>
    <span
      className="inline-flex h-7 w-12 items-center rounded-full p-1 transition"
      style={{ background: on ? "#34d399" : "#3b4259" }}
    >
      <span className="h-5 w-5 rounded-full bg-white transition" style={{ transform: on ? "translateX(20px)" : "none" }} />
    </span>
  </button>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2">
    <div className="text-[11px] font-black tracking-[0.3em] text-cyan-300 uppercase">{title}</div>
    {children}
  </div>
);

/** Host-only preferences (this browser only). Opened with the Menu button or Esc. */
export const HostMenu = ({ onClose }: { onClose: () => void }) => {
  const settings = useHostSettings();
  const actions = useMatchStore.useActions();
  const phase = useMatchStore((s) => s.matchPhase);
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-lg space-y-5 overflow-y-auto rounded-3xl border border-white/20 bg-[#0b1226] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black tracking-[0.1em] uppercase">Host menu</h2>
          <button type="button" onClick={onClose} className="rounded-full border border-white/25 px-4 py-1 text-xs font-black tracking-[0.2em] uppercase">
            Close
          </button>
        </div>
        <Section title="Audio">
          <VolumeControls />
        </Section>
        <Section title="Display">
          <div className="space-y-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3">
            <div className="flex items-center justify-between text-sm font-black tracking-[0.12em] uppercase">
              <span>UI scale</span>
              <span className="text-cyan-300">{Math.round(settings.uiScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.7}
              max={1.5}
              step={0.05}
              value={settings.uiScale}
              onChange={(e) => hostSettings.set({ uiScale: Number(e.target.value) })}
              className="w-full accent-cyan-300"
              aria-label="UI scale"
            />
          </div>
          <Toggle label="Reduce screen shake" hint="Calmer camera for sensitive viewers" on={settings.reducedShake} onChange={(v) => hostSettings.set({ reducedShake: v })} />
          <Toggle label="Reduce particles" hint="Lighter effects for slower machines" on={settings.reducedEffects} onChange={(v) => hostSettings.set({ reducedEffects: v })} />
          <Toggle label="Player name tags" hint="Colour + shape markers over fighters" on={settings.tags} onChange={(v) => hostSettings.set({ tags: v })} />
          <Toggle label="Lobby attract fight" hint="CPU brawl behind the lobby" on={settings.attract} onChange={(v) => hostSettings.set({ attract: v })} />
        </Section>
        <Section title="Controllers">
          <Toggle label="Phone haptics" hint="Vibration on hits, KOs and shield breaks" on={settings.haptics} onChange={(v) => hostSettings.set({ haptics: v })} />
        </Section>
        <Section title="Developer">
          <Toggle label="Debug overlay" hint="Hitboxes, frame data, latency (` also toggles)" on={settings.debug} onChange={(v) => hostSettings.set({ debug: v })} />
        </Section>
        {phase !== "lobby" && (
          <Section title="Match">
            <button
              type="button"
              onClick={() => {
                void actions.returnToLobby();
                onClose();
              }}
              className="w-full rounded-xl border-2 border-rose-400/70 bg-rose-500/15 px-4 py-3 text-sm font-black tracking-[0.15em] text-rose-200 uppercase"
            >
              End match → back to lobby
            </button>
          </Section>
        )}
      </div>
    </div>
  );
};
