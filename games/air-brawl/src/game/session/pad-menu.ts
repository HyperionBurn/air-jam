import { FIGHTER_IDS } from "../data/fighters";
import { STAGE_IDS } from "../data/stages";
import type { MenuEdges } from "../net/gamepad";
import type { FighterId, ItemSetting, StageId } from "../sim/types";
import { getReadiness, leaderIdOf, PRESETS } from "./reducers";
import type { AirBrawlState, MatchPreset, MatchSettings } from "./types";

/** The store actions a pad can trigger (all issued by the host on the pad player's behalf). */
export interface PadMenuActions {
  setFighter(playerId: string, fighterId: FighterId): void;
  setReady(playerId: string, ready: boolean): void;
  setTeam(playerId: string, team: number): void;
  voteStage(playerId: string, stage: StageId | null): void;
  updateSettings(patch: Partial<MatchSettings>): void;
  startMatch(force: boolean): void;
  rematch(): void;
  returnToLobby(): void;
}

const ITEM_ORDER: ItemSetting[] = ["off", "low", "normal", "chaos"];
const PRESET_ORDER: MatchPreset[] = ["standard", "fastParty"];

const cycle = <T>(list: readonly T[], current: T, step: number): T => {
  const i = list.indexOf(current);
  return list[(i + step + list.length * 4) % list.length];
};

/**
 * Menu rules for a gamepad that is a player on the host machine.
 *
 *  Lobby, every pad:   ◀ ▶ fighter · ▲ ▼ stage vote · A ready (toggle) · B un-ready · X team
 *  Lobby, room leader: LB/RB CPU count · Y Standard ⇄ Fast Party · Select items · Start = start now
 *  Results:            Start = rematch · B = back to lobby (leader)
 */
export const handlePadMenu = (id: string, e: MenuEdges, state: AirBrawlState, act: PadMenuActions): void => {
  const me = state.players[id];
  if (!me || !me.local) return;
  const leader = leaderIdOf(state) === id;

  if (state.matchPhase === "lobby") {
    if (!me.ready) {
      if (e.left) act.setFighter(id, cycle(FIGHTER_IDS, me.fighterId, -1));
      if (e.right) act.setFighter(id, cycle(FIGHTER_IDS, me.fighterId, 1));
      if (e.x && state.settings.teams) act.setTeam(id, me.team === 0 ? 1 : 0);
    }
    if (e.up || e.down) {
      const options: (StageId | null)[] = [null, ...STAGE_IDS];
      act.voteStage(id, cycle(options, me.stageVote, e.down ? 1 : -1));
    }
    if (e.confirm) act.setReady(id, !me.ready);
    if (e.back && me.ready) act.setReady(id, false);

    if (leader) {
      const s = state.settings;
      if (e.lb) act.updateSettings({ botCount: s.botCount - 1 });
      if (e.rb) act.updateSettings({ botCount: s.botCount + 1 });
      if (e.y) act.updateSettings({ preset: cycle(PRESET_ORDER, s.preset, 1) });
      if (e.select) act.updateSettings({ items: cycle(ITEM_ORDER, s.items, 1) });
      if (e.start && getReadiness(state).canStart) act.startMatch(true);
    } else if (e.start) {
      act.setReady(id, !me.ready);
    }
    return;
  }

  if (state.matchPhase === "ended") {
    if (e.start) act.rematch();
    if (e.back && leader) act.returnToLobby();
  }
};

export const presetLabel = (preset: MatchPreset): string => PRESETS[preset].label;
