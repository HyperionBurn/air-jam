import { BTN, type Fighter, type InputFrame, type World } from "../sim/types";
import { clamp } from "../sim/util";

export type BotDifficulty = "easy" | "medium" | "hard";

interface Profile {
  /** Frames between target / plan re-evaluation (reaction time). */
  reaction: number;
  /** Probability per decision that the bot does nothing (mistake). */
  idle: number;
  /** Probability to shield/dodge a threatening attack. */
  defend: number;
  /** Use smash attacks when the target is killable. */
  smash: boolean;
  /** Stick noise amplitude. */
  noise: number;
  /** Uses double jump / up special correctly while recovering. */
  recovery: number;
  /** Attack willingness per decision when in range. */
  aggression: number;
  /** Uses projectile specials at range. */
  zoning: number;
  /** Gets items. */
  items: boolean;
}

const PROFILES: Record<BotDifficulty, Profile> = {
  easy: { reaction: 22, idle: 0.32, defend: 0.08, smash: false, noise: 0.25, recovery: 0.55, aggression: 0.5, zoning: 0.25, items: false },
  medium: { reaction: 12, idle: 0.1, defend: 0.3, smash: true, noise: 0.1, recovery: 0.88, aggression: 0.75, zoning: 0.5, items: true },
  hard: { reaction: 5, idle: 0.02, defend: 0.6, smash: true, noise: 0.03, recovery: 1, aggression: 0.95, zoning: 0.75, items: true },
};

interface Memory {
  rngState: number;
  nextDecision: number;
  targetIndex: number;
  /** Pending button schedule: ticks left to hold each button. */
  hold: { jump: number; attack: number; special: number; shield: number };
  /** One-shot taps queued for the next tick. */
  tap: number;
  stickX: number;
  stickY: number;
  /** Multi-tick smash/flick plan. */
  flick: { dx: number; dy: number; stage: 0 | 1 | 2; attack: boolean } | null;
  idleUntil: number;
  wanderDir: number;
  lastPlanFrame: number;
}

const RECOVERY_RANGE: Record<string, { up: number; horizontal: number }> = {
  nova: { up: 330, horizontal: 160 },
  volt: { up: 420, horizontal: 260 },
  bulwark: { up: 260, horizontal: 110 },
  wisp: { up: 300, horizontal: 220 },
};

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * Host-side bot. It produces exactly the same `InputFrame`s a phone would,
 * so bots exercise the real simulation and double as the automated QA driver.
 */
export class BotBrain {
  private readonly profile: Profile;
  private readonly memory = new Map<number, Memory>();

  constructor(
    readonly difficulty: BotDifficulty,
    private readonly seed = 1,
  ) {
    this.profile = PROFILES[difficulty];
  }

  private mem(index: number): Memory {
    let m = this.memory.get(index);
    if (!m) {
      m = {
        rngState: (this.seed * 2654435761 + index * 40503) | 0 || 1,
        nextDecision: 0,
        targetIndex: -1,
        hold: { jump: 0, attack: 0, special: 0, shield: 0 },
        tap: 0,
        stickX: 0,
        stickY: 0,
        flick: null,
        idleUntil: 0,
        wanderDir: 1,
        lastPlanFrame: -99,
      };
      this.memory.set(index, m);
    }
    return m;
  }

  private rand(m: Memory): number {
    m.rngState = (m.rngState + 0x6d2b79f5) | 0;
    let t = m.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  reset(): void {
    this.memory.clear();
  }

  /** Produce the input for fighter `index` this tick. */
  think(world: World, index: number): InputFrame {
    const f = world.fighters[index];
    const m = this.mem(index);
    const out: InputFrame = { mx: 0, my: 0, held: 0, taps: 0 };
    if (!f.alive || world.phase !== "fight") return out;

    const p = this.profile;
    const frame = world.frame;

    // Respawn halo: wait a beat, then drop in.
    if (f.state === "respawn") {
      if (f.sf > 70 + 40 + Math.floor(this.rand(m) * 20)) out.taps |= BTN.JUMP;
      out.held = out.taps;
      return out;
    }

    // Hitstun: survival DI toward the stage.
    if (f.state === "hitstun" || f.state === "shieldBreak") {
      const main = world.platforms[0];
      const centre = main.x + main.def.w / 2;
      out.mx = clamp((centre - f.x) / 400, -1, 1) * 0.9;
      out.my = f.y > main.y - 20 ? -0.8 : 0.4;
      return out;
    }

    if (frame >= m.nextDecision) {
      m.nextDecision = frame + Math.max(2, Math.round(p.reaction * (0.7 + this.rand(m) * 0.6)));
      this.decide(world, f, m);
    }

    // Execute the plan.
    out.mx = m.stickX;
    out.my = m.stickY;
    if (m.flick) {
      const fl = m.flick;
      if (fl.stage === 0) {
        out.mx = 0;
        out.my = 0;
        fl.stage = 1;
      } else if (fl.stage === 1) {
        out.mx = fl.dx;
        out.my = fl.dy;
        fl.stage = 2;
        if (fl.attack) m.tap |= BTN.ATTACK;
      } else {
        out.mx = fl.dx;
        out.my = fl.dy;
        m.flick = null;
      }
    }
    let held = 0;
    if (m.hold.jump > 0) {
      held |= BTN.JUMP;
      m.hold.jump -= 1;
    }
    if (m.hold.attack > 0) {
      held |= BTN.ATTACK;
      m.hold.attack -= 1;
    }
    if (m.hold.special > 0) {
      held |= BTN.SPECIAL;
      m.hold.special -= 1;
    }
    if (m.hold.shield > 0) {
      held |= BTN.SHIELD;
      m.hold.shield -= 1;
    }
    out.taps = m.tap;
    out.held = held | m.tap;
    m.tap = 0;
    return out;
  }

  /* ----------------------------------------------------------------- DECIDE */

  private decide(world: World, f: Fighter, m: Memory): void {
    const p = this.profile;
    m.stickX = 0;
    m.stickY = 0;
    const main = world.platforms[0];
    const noise = () => (this.rand(m) - 0.5) * p.noise * 2;

    // Ledge handling.
    if (f.state === "ledgeHang") {
      if (f.hang > 14 + Math.floor(this.rand(m) * 20)) {
        const toward = f.facing;
        const r = this.rand(m);
        if (r < 0.25) m.tap |= BTN.ATTACK;
        else if (r < 0.45) m.tap |= BTN.JUMP;
        else {
          m.stickX = toward;
          m.stickY = -0.7;
        }
      }
      return;
    }

    // Recovery.
    if (this.needsRecovery(world, f)) {
      this.recover(world, f, m);
      return;
    }

    // Grab handling.
    if (f.state === "grabbing") {
      const target = world.fighters[f.grabTarget];
      if (target) {
        const toCentre = target.x >= 0 ? 1 : -1;
        if (this.rand(m) < 0.5 || target.percent > 80) {
          m.stickX = toCentre === f.facing ? f.facing : -f.facing;
          m.stickY = 0;
          m.stickX *= 0.95;
        } else if (this.rand(m) < 0.7) {
          m.tap |= BTN.ATTACK;
        }
      }
      return;
    }
    if (f.state === "grabbed") {
      m.tap |= this.rand(m) < 0.8 ? BTN.JUMP : 0;
      return;
    }

    // Idle mistakes.
    if (this.rand(m) < p.idle) {
      m.stickX = this.rand(m) < 0.5 ? 0 : sign(this.rand(m) - 0.5) * 0.4;
      return;
    }

    // Hazard avoidance.
    const lane = this.hazardThreat(world, f);
    if (lane !== null) {
      m.stickX = sign(f.x - lane) || 1;
      m.stickX = m.stickX * 0.9;
      if (!f.grounded && f.jumpsLeft === 0) m.stickX *= 1;
      return;
    }

    const target = this.pickTarget(world, f, m);
    if (!target) {
      m.stickX = f.x < main.x + main.def.w / 2 ? 0.3 : -0.3;
      return;
    }

    // Items.
    if (p.items && world.items.length > 0 && f.grounded) {
      let best: { x: number; y: number } | null = null;
      let bestD = 420;
      for (const item of world.items) {
        const d = Math.abs(item.x - f.x) + Math.abs(item.y - f.y) * 0.4;
        if (d < bestD && item.grounded) {
          bestD = d;
          best = item;
        }
      }
      const tDist = Math.abs(target.x - f.x);
      if (best && tDist > 200) {
        m.stickX = sign(best.x - f.x);
        if (best.y < f.y - 120 && f.grounded) m.hold.jump = 14;
        return;
      }
    }
    if (f.heldItem === "chaosBomb" && Math.abs(target.x - f.x) < 420 && Math.abs(target.x - f.x) > 120) {
      m.stickX = sign(target.x - f.x) * 0.3;
      m.tap |= BTN.ATTACK;
      return;
    }

    const dx = target.x - f.x;
    const absDx = Math.abs(dx);
    const bodyDy = target.y - target.def.height / 2 - (f.y - f.def.height / 2);
    const face = sign(dx) || f.facing;

    // Defend against nearby attacks.
    if (this.threatened(world, f, target) && this.rand(m) < p.defend) {
      if (f.grounded) {
        m.hold.shield = 10 + Math.floor(this.rand(m) * 10);
        if (this.rand(m) < 0.3) {
          m.stickX = -face * 0.9;
          m.tap |= BTN.SHIELD;
        }
      } else if (!f.airDodgeUsed && this.rand(m) < 0.5) {
        m.tap |= BTN.SHIELD;
        m.stickX = -face * 0.5;
      }
      return;
    }

    if (f.grounded) {
      this.groundBehaviour(world, f, m, target, dx, absDx, bodyDy, face, noise);
    } else {
      this.airBehaviour(f, m, target, dx, absDx, bodyDy, face);
    }
  }

  private groundBehaviour(
    world: World,
    f: Fighter,
    m: Memory,
    target: Fighter,
    dx: number,
    absDx: number,
    bodyDy: number,
    face: number,
    noise: () => number,
  ): void {
    const p = this.profile;
    const main = world.platforms[0];
    const sameLevel = Math.abs(bodyDy) < 80;
    const killable = target.percent > (target.def.weight > 110 ? 105 : 85);

    // Grab shielding opponents.
    const targetShielding = target.state === "shield" || target.state === "shieldStun";

    if (absDx < 100 && sameLevel) {
      if (this.rand(m) > p.aggression) {
        m.stickX = -face * 0.4;
        return;
      }
      if (targetShielding) {
        m.hold.shield = 3;
        m.tap |= BTN.ATTACK;
        return;
      }
      m.stickX = face * 0.2;
      if (p.smash && killable && this.rand(m) < 0.6) {
        m.flick = { dx: face, dy: 0, stage: 0, attack: true };
        m.hold.attack = 0;
        return;
      }
      const r = this.rand(m);
      if (r < 0.45) {
        m.stickX = face * 0.55;
        m.tap |= BTN.ATTACK; // ftilt
      } else if (r < 0.6) {
        m.stickY = 0.8;
        m.tap |= BTN.ATTACK; // dtilt
      } else {
        m.tap |= BTN.ATTACK;
        m.stickX = 0;
      }
      return;
    }

    // Target above: jump up to its platform, or uair when below.
    if (bodyDy < -110) {
      if (absDx < 140 && this.rand(m) < 0.6 && p.smash && killable) {
        m.flick = { dx: 0, dy: -1, stage: 0, attack: true };
        return;
      }
      m.stickX = clamp(dx / 200, -1, 1) * 0.9;
      m.hold.jump = 24;
      if (absDx < 220) m.tap |= BTN.JUMP;
      return;
    }

    // Target below on a lower platform: drop through.
    if (bodyDy > 120 && f.platform > 0 && !world.platforms[f.platform].def.solid && absDx < 200) {
      m.stickY = 1;
      return;
    }

    // Zoning with projectile specials.
    const proj = f.def.id === "nova" || f.def.id === "wisp" || f.def.id === "bulwark";
    if (proj && absDx > 180 && absDx < 520 && sameLevel && this.rand(m) < p.zoning * 0.5) {
      m.stickX = face * 0.2;
      m.tap |= BTN.SPECIAL;
      return;
    }

    // Approach, but never walk off the ledge chasing offstage targets.
    let move = clamp(dx / 160, -1, 1);
    move = move * (absDx > 220 ? 1 : 0.7) + noise();
    const edgeLeft = main.x + 28;
    const edgeRight = main.x + main.def.w - 28;
    const onMain = f.platform === 0;
    if (onMain && ((move < 0 && f.x < edgeLeft) || (move > 0 && f.x > edgeRight))) move = 0;
    m.stickX = clamp(move, -1, 1);
  }

  private airBehaviour(
    f: Fighter,
    m: Memory,
    target: Fighter,
    dx: number,
    absDx: number,
    bodyDy: number,
    face: number,
  ): void {
    const p = this.profile;
    m.stickX = clamp(dx / 160, -1, 1) * 0.9;
    if (absDx < 105 && Math.abs(bodyDy) < 95 && this.rand(m) < p.aggression) {
      // Aerial selection by relative position.
      if (bodyDy < -70) {
        m.stickX = 0;
        m.stickY = -1;
      } else if (bodyDy > 70) {
        m.stickX = 0;
        m.stickY = 1;
      } else if (this.rand(m) < 0.25) {
        m.stickX = 0;
      } else {
        m.stickX = face === f.facing ? f.facing : -f.facing;
        m.stickX *= 0.9;
      }
      m.tap |= BTN.ATTACK;
      return;
    }
    // Double jump toward a target above.
    if (bodyDy < -90 && f.vy > -2 && f.jumpsLeft > 0 && !f.helpless && this.rand(m) < 0.6) {
      m.tap |= BTN.JUMP;
      m.hold.jump = 18;
    }
  }

  private pickTarget(world: World, f: Fighter, m: Memory): Fighter | null {
    let best: Fighter | null = null;
    let bestScore = Infinity;
    for (const o of world.fighters) {
      if (o === f || !o.alive || o.state === "respawn" || o.team === f.team) continue;
      const dist = Math.hypot(o.x - f.x, (o.y - f.y) * 1.4);
      const score = dist - (o.percent > 100 ? 120 : 0) - (o.index === m.targetIndex ? 80 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best) m.targetIndex = best.index;
    return best;
  }

  private threatened(world: World, f: Fighter, target: Fighter): boolean {
    void world;
    const attacking =
      target.state === "attack" || target.state === "airAttack" || target.state === "special" || target.state === "airSpecial";
    if (!attacking) return false;
    const dx = Math.abs(target.x - f.x);
    const dy = Math.abs(target.y - f.y);
    return dx < 140 && dy < 110;
  }

  private hazardThreat(world: World, f: Fighter): number | null {
    const hazards = world.stage.hazards;
    for (let i = 0; i < hazards.length; i += 1) {
      const hs = world.hazardState[i];
      if (hs.phase === "idle") continue;
      const lane = hazards[i].xs[hs.lane];
      if (Math.abs(f.x - lane) < hazards[i].w / 2 + 70) return lane;
    }
    return null;
  }

  /* ---------------------------------------------------------------- RECOVERY */

  private needsRecovery(world: World, f: Fighter): boolean {
    if (f.grounded || f.state === "ledgeHang" || f.state === "ledgeClimb" || f.state === "ledgeRoll") return false;
    for (const plat of world.platforms) {
      const below = plat.y - f.y;
      if (below > -30 && below < 520 && f.x > plat.x - 30 && f.x < plat.x + plat.def.w + 30) return false;
    }
    return true;
  }

  private recover(world: World, f: Fighter, m: Memory): void {
    const p = this.profile;
    const main = world.platforms[0];
    const range = RECOVERY_RANGE[f.def.id] ?? RECOVERY_RANGE.nova;
    const leftCorner = { x: main.x - 10, y: main.y };
    const rightCorner = { x: main.x + main.def.w + 10, y: main.y };
    const corner = Math.abs(f.x - leftCorner.x) < Math.abs(f.x - rightCorner.x) ? leftCorner : rightCorner;
    const inward = corner === leftCorner ? 1 : -1;
    const tx = corner.x + inward * 30;
    const ty = corner.y - 20;
    const dx = tx - f.x;
    const dy = ty - f.y; // negative = target is above us
    m.stickX = clamp(dx / 120, -1, 1);

    const skilled = this.rand(m) < p.recovery;
    if (f.helpless) return;

    // Double jump when below the target and falling.
    if (f.jumpsLeft > 0 && f.vy > 0 && dy < -30 && skilled) {
      m.tap |= BTN.JUMP;
      m.hold.jump = 18;
      return;
    }
    // Up special when out of jumps (or far below).
    const needUp = dy < -60 && (f.jumpsLeft === 0 || dy < -230);
    const reachable = Math.abs(dx) < range.horizontal + 120 && -dy < range.up + 40;
    if (needUp && reachable && skilled && f.vy > -3) {
      m.stickY = -1;
      m.stickX = clamp(dx / 160, -0.7, 0.7);
      m.tap |= BTN.SPECIAL;
      return;
    }
    // Side special to cover distance (Volt / Nova).
    if (Math.abs(dx) > 200 && f.jumpsLeft === 0 && (f.def.id === "volt" || f.def.id === "nova") && dy > -80 && skilled) {
      m.stickX = sign(dx);
      m.tap |= BTN.SPECIAL;
      return;
    }
    // Air dodge toward the stage as a last resort drift.
    if (Math.abs(dx) > 120 && !f.airDodgeUsed && f.jumpsLeft === 0 && this.rand(m) < 0.1) {
      m.tap |= BTN.SHIELD;
    }
  }
}
