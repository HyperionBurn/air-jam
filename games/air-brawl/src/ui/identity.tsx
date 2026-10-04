import type { CSSProperties } from "react";
import type { FighterId } from "../game/sim/types";
import { shapeSvgPoints, slotStyle, TEAM_STYLES } from "../game/view/palette";

/** Slot shape glyph (colour + shape identity, readable without colour). */
export const ShapeIcon = ({ slot, size = 28, className, style }: { slot: number; size?: number; className?: string; style?: CSSProperties }) => {
  const s = slotStyle(slot);
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1.35 -1.35 2.7 2.7"
      className={className}
      style={style}
      aria-hidden
    >
      <polygon points={shapeSvgPoints(s.shape)} fill={s.color} stroke="#05070f" strokeWidth={0.14} strokeLinejoin="round" />
    </svg>
  );
};

export const TeamChip = ({ team, className }: { team: number; className?: string }) => {
  const t = TEAM_STYLES[team % TEAM_STYLES.length];
  return (
    <span
      className={className}
      style={{
        background: `${t.color}26`,
        color: t.color,
        border: `2px solid ${t.color}`,
        borderRadius: 999,
        padding: "2px 10px",
        fontWeight: 900,
        letterSpacing: "0.1em",
        fontSize: "0.7em",
        textTransform: "uppercase",
      }}
    >
      {t.name.replace(" Team", "")}
    </span>
  );
};

interface PortraitProps {
  fighter: FighterId;
  slot: number;
  size?: number;
  className?: string;
  dim?: boolean;
}

/** Original vector portraits. Slot colour tints the armour so each player pops. */
export const FighterPortrait = ({ fighter, slot, size = 120, className, dim }: PortraitProps) => {
  const s = slotStyle(slot);
  const c = s.color;
  const d = s.dark;
  const l = s.light;
  const out = "#080b18";
  return (
    <svg
      width={size}
      height={size * 1.12}
      viewBox="0 0 120 134"
      className={className}
      style={{ opacity: dim ? 0.55 : 1, filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.5))" }}
      aria-label={fighter}
    >
      {fighter === "nova" && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M14 134 C14 104 32 92 60 92 C88 92 106 104 106 134 Z" fill="#1d2748" stroke={out} strokeWidth="4" />
          <path d="M28 134 C30 110 42 100 60 100 C78 100 90 110 92 134 Z" fill={c} stroke={out} strokeWidth="3.5" />
          <circle cx="62" cy="116" r="7" fill="#7cf0ff" />
          <circle cx="62" cy="116" r="12" fill="#7cf0ff" opacity="0.3" />
          <circle cx="60" cy="52" r="38" fill={c} stroke={out} strokeWidth="5" />
          <path d="M26 40 L8 22 L36 24 Z" fill={l} stroke={out} strokeWidth="3" />
          <rect x="52" y="34" width="52" height="30" rx="14" fill="#0a1230" stroke={out} strokeWidth="3" />
          <rect x="58" y="42" width="42" height="9" rx="4.5" fill="#7cf0ff" />
          <circle cx="40" cy="30" r="7" fill="#fff" opacity="0.45" />
        </g>
      )}
      {fighter === "volt" && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M22 134 C22 108 38 96 60 96 C82 96 98 108 98 134 Z" fill="#202448" stroke={out} strokeWidth="4" />
          <path d="M34 134 C36 112 46 104 60 104 C74 104 84 112 86 134 Z" fill={c} stroke={out} strokeWidth="3.5" />
          <path d="M66 100 L50 122 L60 122 L54 134 L74 112 L63 112 Z" fill="#ffe14d" stroke={out} strokeWidth="2.5" />
          <path d="M18 46 L26 4 L44 30 L56 -2 L70 28 L92 8 L98 50 Z" fill="#ffe14d" stroke={out} strokeWidth="4.5" />
          <circle cx="58" cy="60" r="34" fill="#ffd6b0" stroke={out} strokeWidth="5" />
          <rect x="50" y="46" width="50" height="22" rx="10" fill="#0c1030" stroke={out} strokeWidth="3" />
          <rect x="60" y="52" width="36" height="7" rx="3.5" fill="#ffe14d" />
          <path d="M100 96 Q116 90 118 112 Q108 100 98 110" fill={c} stroke={out} strokeWidth="3" />
        </g>
      )}
      {fighter === "bulwark" && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="M2 134 C2 100 24 88 60 88 C96 88 118 100 118 134 Z" fill="#242a40" stroke={out} strokeWidth="4.5" />
          <circle cx="20" cy="104" r="22" fill={c} stroke={out} strokeWidth="4.5" />
          <circle cx="100" cy="104" r="22" fill={c} stroke={out} strokeWidth="4.5" />
          <rect x="32" y="96" width="56" height="38" rx="12" fill={c} stroke={out} strokeWidth="4" />
          <rect x="30" y="122" width="60" height="12" fill="#ffa24d" stroke={out} strokeWidth="3" />
          <rect x="22" y="22" width="76" height="62" rx="24" fill={d} stroke={out} strokeWidth="5" />
          <rect x="54" y="22" width="12" height="40" fill={c} />
          <rect x="30" y="52" width="68" height="16" rx="5" fill="#0b0e22" stroke={out} strokeWidth="2.5" />
          <rect x="44" y="57" width="50" height="6" rx="3" fill="#ffa24d" />
        </g>
      )}
      {fighter === "wisp" && (
        <g strokeLinejoin="round" strokeLinecap="round">
          <ellipse cx="60" cy="82" rx="56" ry="50" fill="#9f6bff" opacity="0.14" />
          <path d="M8 134 C10 108 30 94 60 94 C90 94 110 108 112 134 Z" fill="#2c1a58" stroke={out} strokeWidth="4" />
          <path d="M30 134 C34 112 46 102 60 102 C74 102 86 112 90 134 Z" fill={c} opacity="0.92" stroke={out} strokeWidth="3" />
          <circle cx="60" cy="116" r="8" fill="#fff" />
          <circle cx="60" cy="116" r="15" fill="#f0c8ff" opacity="0.35" />
          <path d="M14 70 C14 38 36 12 60 -2 C84 12 106 38 106 70 C106 84 94 92 60 92 C26 92 14 84 14 70 Z" fill="#2c1a58" stroke={out} strokeWidth="5" />
          <ellipse cx="62" cy="64" rx="38" ry="30" fill="#0a0618" />
          <circle cx="48" cy="62" r="7" fill="#f0c8ff" />
          <circle cx="76" cy="62" r="7" fill="#f0c8ff" />
          <circle cx="48" cy="62" r="14" fill="#f0c8ff" opacity="0.28" />
          <circle cx="76" cy="62" r="14" fill="#f0c8ff" opacity="0.28" />
          <circle cx="60" cy="-2" r="6" fill={c} />
          <circle cx="104" cy="96" r="9" fill={l} stroke={out} strokeWidth="2.5" />
        </g>
      )}
    </svg>
  );
};

/** 1–5 pip stat bar. */
export const StatPips = ({ value, color, label }: { value: number; color: string; label: string }) => (
  <div className="flex items-center gap-2" aria-label={`${label} ${value} of 5`}>
    <div className="w-[4.6rem] text-[0.65rem] font-black tracking-[0.14em] text-slate-300 uppercase">{label}</div>
    <div className="flex gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          style={{ background: i < value ? color : "rgba(255,255,255,0.14)", width: 16, height: 8, borderRadius: 3, boxShadow: i < value ? `0 0 8px ${color}88` : "none" }}
        />
      ))}
    </div>
  </div>
);
