import { useEffect, useState } from "react";
import type { HostDiagnostics } from "../../game/net/diagnostics";

/**
 * Developer-only diagnostics, hidden in normal play (toggle with ` or ?debug=1).
 * Reads the diagnostics object on an interval — never at simulation frequency.
 */
export const DebugOverlay = ({ diagnostics }: { diagnostics: HostDiagnostics }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  const d = diagnostics;
  const fmt = (n: number) => n.toFixed(2);
  return (
    <div className="pointer-events-none absolute top-2 left-2 z-50 max-w-[46ch] rounded-lg bg-black/75 p-3 font-mono text-[11px] leading-snug text-emerald-200 shadow-lg">
      <div className="font-bold text-emerald-300">AIR BRAWL · DEBUG</div>
      <div>
        fps {d.fps} · frame {fmt(d.frameMs.avg)}ms (max {fmt(d.frameMs.max)}) · dropped {d.droppedFrames}
      </div>
      <div>
        sim tick avg {fmt(d.tickMs.avg)}ms max {fmt(d.tickMs.max)}ms · render avg {fmt(d.renderMs.avg)}ms max {fmt(d.renderMs.max)}ms
      </div>
      <div>
        sim frame {d.simFrame} · input pkts/s {d.packetsPerSec} · render quality {d.quality}
      </div>
      <div className="mt-1 text-emerald-300">controllers</div>
      {d.controllers.length === 0 && <div className="text-emerald-100/60">none</div>}
      {d.controllers.map((c) => (
        <div key={c.id} className={c.stale ? "text-amber-300" : ""}>
          {c.name.slice(0, 10).padEnd(10)} rate {String(c.packetRate).padStart(3)}/s · age {String(c.inputAgeMs).padStart(4)}ms · jitter {c.jitterMs}ms · rtt{" "}
          {c.rttMs < 0 ? "–" : `${Math.round(c.rttMs)}ms`}
          {c.stale ? " · STALE" : ""}
        </div>
      ))}
      <div className="mt-1 text-emerald-100/50">` toggles · hitboxes/hurtboxes drawn on canvas</div>
    </div>
  );
};
