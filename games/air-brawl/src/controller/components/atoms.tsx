import type { ReactNode } from "react";

export const Section = ({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) => (
  <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-[11px] font-black tracking-[0.28em] text-cyan-300 uppercase">{title}</h3>
      {hint && <div className="text-[11px] font-semibold text-slate-400">{hint}</div>}
    </div>
    {children}
  </section>
);

interface SegmentedProps<T extends string | number | boolean> {
  options: { value: T; label: string; sub?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  accent?: string;
  columns?: number;
}

/** Big-target segmented control. */
export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, accent = "#7cf0ff", columns }: SegmentedProps<T>) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))`, opacity: disabled ? 0.5 : 1 }}
      role="radiogroup"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className="min-h-[46px] rounded-xl border-2 px-2 py-1.5 text-center text-[13px] leading-tight font-black tracking-[0.04em] uppercase transition active:scale-95"
            style={{
              borderColor: selected ? accent : "rgba(255,255,255,0.14)",
              background: selected ? `${accent}30` : "rgba(255,255,255,0.05)",
              color: selected ? "#fff" : "#b8c2e0",
              boxShadow: selected ? `0 0 14px ${accent}55` : "none",
            }}
          >
            {o.label}
            {o.sub && <div className="text-[10px] font-semibold tracking-normal text-slate-400 normal-case">{o.sub}</div>}
          </button>
        );
      })}
    </div>
  );
}

export const BigButton = ({
  children,
  onClick,
  color = "#34d399",
  textColor = "#04210f",
  disabled,
  className = "",
  pulse,
  padReady,
}: {
  children: ReactNode;
  onClick: () => void;
  color?: string;
  textColor?: string;
  disabled?: boolean;
  className?: string;
  pulse?: boolean;
  /** Marks the button the gamepad Start button should press. */
  padReady?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-pad-ready={padReady ? "" : undefined}
    className={`min-h-[60px] w-full rounded-2xl border-4 border-black/30 px-4 text-xl font-black tracking-[0.14em] uppercase shadow-[0_6px_0_rgba(0,0,0,0.4)] transition active:translate-y-[4px] active:shadow-[0_2px_0_rgba(0,0,0,0.4)] disabled:opacity-40 ${pulse ? "ab-ready-pulse" : ""} ${className}`}
    style={{ background: color, color: textColor, ["--ring" as string]: `${color}88` }}
  >
    {children}
  </button>
);
