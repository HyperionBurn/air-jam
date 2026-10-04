import { useAirJamHost } from "@air-jam/sdk";

/** Small, unobtrusive room code shown during a match so late phones can rejoin. */
export const RoomChip = () => {
  const host = useAirJamHost();
  return (
    <div className="pointer-events-none absolute top-3 right-3 z-20 rounded-full border border-white/15 bg-black/40 px-[1.4vh] py-[0.5vh] text-[1.5vh] font-black tracking-[0.2em] text-white/70 uppercase backdrop-blur">
      Room {host.roomId}
    </div>
  );
};
