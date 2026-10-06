import type { AudioHandle, HapticSignalPayload } from "@air-jam/sdk";
import type { AirBrawlSoundId } from "../../game/contracts/sounds";
import type { SimEvent, World } from "../../game/sim/types";
import type { GameView3D } from "../../game/view3d/game-view3d";
import { slotStyle, TEAM_STYLES } from "../../game/view/palette";

type HapticFn = (controllerId: string, payload: HapticSignalPayload) => void;

const isBotId = (id: string): boolean => id.startsWith("bot-");

/**
 * Routes sim events to audio, phone haptics and the on-screen announcer. The
 * view layer handles particles/camera on its own; this class owns everything
 * that needs the audio runtime or the signal lane.
 */
export class FeedbackRouter {
  private readonly lastSfxAt = new Map<string, number>();
  private readonly lastHapticAt = new Map<string, number>();
  hapticsEnabled = true;
  /** Skip all non-essential feedback (used while fast-forwarding catch-up ticks). */
  muted = false;

  constructor(
    private readonly audio: AudioHandle<AirBrawlSoundId>,
    private readonly haptic: HapticFn,
    private readonly view: GameView3D,
  ) {}

  private play(id: AirBrawlSoundId, options: { volume?: number; pitch?: number; cooldown?: number } = {}): void {
    if (this.muted) return;
    const now = performance.now();
    const cd = options.cooldown ?? 45;
    if (now - (this.lastSfxAt.get(id) ?? 0) < cd) return;
    this.lastSfxAt.set(id, now);
    this.audio.play(id, { volume: options.volume, pitch: options.pitch });
  }

  private vary(): number {
    return 0.94 + Math.random() * 0.12;
  }

  private buzz(world: World, fighterIndex: number, pattern: HapticSignalPayload["pattern"], minGap = 70): void {
    if (this.muted || !this.hapticsEnabled || fighterIndex < 0) return;
    const f = world.fighters[fighterIndex];
    if (!f || isBotId(f.id)) return;
    const now = performance.now();
    const heavy = pattern === "heavy" || pattern === "failure" || pattern === "success";
    if (!heavy && now - (this.lastHapticAt.get(f.id) ?? 0) < minGap) return;
    this.lastHapticAt.set(f.id, now);
    this.haptic(f.id, { pattern });
  }

  /** Called once per simulated tick with that tick's events. */
  handle(world: World, events: readonly SimEvent[]): void {
    for (const e of events) this.route(world, e);
  }

  private route(world: World, e: SimEvent): void {
    switch (e.type) {
      case "countdown":
        this.view.announce(String(e.n), "#ffe27a", { size: 220, hold: 26 });
        this.play("countdown", { cooldown: 0 });
        break;
      case "fightStart":
        this.view.announce("FIGHT!", "#7dffb0", { size: 190, hold: 34 });
        this.play("go", { cooldown: 0 });
        break;
      case "hit": {
        const heavy = e.kb >= 95 || e.killing;
        const stale = e.stale ?? 0;
        const id: AirBrawlSoundId = e.kb >= 130 ? "hitMega" : e.kb >= 80 ? "hitHeavy" : e.kb >= 42 ? "hitMid" : "hitLight";
        // Stale hits sound thin: lower, quieter. A fresh, varied hit has the full thump.
        this.play(id, { pitch: this.vary() * (1 - 0.14 * stale), volume: 1 - 0.4 * stale, cooldown: 30 });
        if (e.killing) this.play("crowd", { cooldown: 500, volume: 0.5 });
        this.buzz(world, e.victim, heavy ? "heavy" : "medium", 80);
        // The attacker feels a crisp tick for a fresh hit and nothing for a stale one.
        if (e.attacker >= 0 && stale < 0.45) this.buzz(world, e.attacker, "light", 90);
        break;
      }
      case "parry":
        this.play("clash", { pitch: 1.45, volume: 1, cooldown: 60 });
        this.play("shield", { pitch: 1.7, volume: 0.7, cooldown: 60 });
        this.buzz(world, e.victim, "success");
        this.buzz(world, e.attacker, "failure");
        break;
      case "denied":
        // The press did nothing, and the player should know it: a short dull tick on their phone.
        this.buzz(world, e.who, "light", 160);
        break;
      case "shieldHit":
        this.play("shield", { pitch: this.vary() });
        this.buzz(world, e.victim, "medium");
        break;
      case "shieldBreak":
        this.play("shieldBreak", { cooldown: 120 });
        this.buzz(world, e.victim, "failure");
        break;
      case "clash":
        this.play("clash", { cooldown: 80 });
        this.buzz(world, e.a, "medium");
        this.buzz(world, e.b, "medium");
        break;
      case "jump":
        this.play(e.air ? "doubleJump" : "jump", { pitch: this.vary(), cooldown: 60, volume: e.air ? 0.45 : 0.32 });
        break;
      case "land":
        if (e.hard) this.play("land", { pitch: this.vary(), cooldown: 80 });
        break;
      case "dash":
        this.play("dash", { pitch: this.vary(), cooldown: 140 });
        break;
      case "dodge":
        this.play("dodge", { pitch: this.vary(), cooldown: 80 });
        break;
      case "attack": {
        const heavy = e.moveId.includes("smash") || e.moveId === "dair" || e.moveId === "bair";
        this.play(heavy ? "swingHeavy" : "swing", { pitch: this.vary(), cooldown: 55 });
        break;
      }
      case "special":
        this.play("special", { pitch: this.vary(), cooldown: 90 });
        break;
      case "projectile":
        this.play("projectile", { pitch: this.vary(), cooldown: 70 });
        break;
      case "explosion":
        this.play("explosion", { cooldown: 100 });
        break;
      case "grab":
        this.play("grab", { cooldown: 80 });
        this.buzz(world, e.victim, "medium");
        break;
      case "throw":
        this.play("throw", { cooldown: 80 });
        this.buzz(world, e.victim, "heavy");
        break;
      case "ledge":
        this.play("ledge", { cooldown: 120 });
        break;
      case "teleport":
        this.play("teleport", { cooldown: 90 });
        break;
      case "ko": {
        this.play(e.final ? "finalKo" : "ko", { cooldown: 0 });
        this.play("crowd", { cooldown: 600, volume: 0.7 });
        this.buzz(world, e.victim, "heavy");
        if (e.killer >= 0) this.buzz(world, e.killer, "success");
        if (e.final) this.view.announce("GAME!", "#ffffff", { size: 200, hold: 60 });
        break;
      }
      case "respawn":
        this.play("respawn", { cooldown: 120 });
        this.buzz(world, e.who, "light");
        break;
      case "itemSpawn":
        this.play("itemSpawn", { cooldown: 200 });
        break;
      case "itemPickup":
        this.play("item", { cooldown: 120 });
        this.buzz(world, e.who, "light");
        break;
      case "hazard":
        this.play(e.phase === "warn" ? "hazardWarn" : "hazardFire", { cooldown: 300 });
        break;
      case "matchEnd": {
        this.play("victory", { cooldown: 0 });
        const winners = e.winners;
        for (const f of world.fighters) {
          if (winners.includes(f.index)) this.buzz(world, f.index, "success");
          else this.buzz(world, f.index, "light");
        }
        const label = e.reason === "draw" || winners.length === 0
          ? "DRAW!"
          : world.config.teams
            ? `${TEAM_STYLES[e.winnerTeam % TEAM_STYLES.length].name.toUpperCase()} WINS!`
            : `${world.fighters[winners[0]].name.toUpperCase()} WINS!`;
        const color = winners.length && !world.config.teams ? slotStyle(world.fighters[winners[0]].slot).light : "#ffe27a";
        this.view.announce(label, color, { size: 120, hold: 120 });
        break;
      }
      default:
        break;
    }
  }
}
