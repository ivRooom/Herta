import { randomInt } from 'node:crypto';

/** Static strategic examples, not claims of current win rates or a ranked-meta tier list. */
export const VALORANT_MAPS = [
  ['Ascent', 'アセント'],
  ['Bind', 'バインド'],
  ['Haven', 'ヘイヴン'],
  ['Split', 'スプリット'],
  ['Icebox', 'アイスボックス'],
  ['Breeze', 'ブリーズ'],
  ['Fracture', 'フラクチャー'],
  ['Pearl', 'パール'],
  ['Lotus', 'ロータス'],
  ['Sunset', 'サンセット'],
  ['Abyss', 'アビス'],
  ['Corrode', 'カロード'],
  ['Summit', 'SUMMIT'],
] as const;

export type ValorantMapId = (typeof VALORANT_MAPS)[number][0];
export const VALORANT_COMPOSITION_VERSION = '13.09-v1';

/** Order: entry, smoke, reconnaissance/info, site defense, synergy/flex. */
const PRESETS: Record<ValorantMapId, readonly (readonly string[])[]> = {
  Ascent: [
    ['Jett', 'Omen', 'Sova', 'Killjoy', 'KAY/O'],
    ['Raze', 'Astra', 'Fade', 'Cypher', 'Breach'],
  ],
  Bind: [
    ['Raze', 'Brimstone', 'Gekko', 'Cypher', 'Skye'],
    ['Yoru', 'Omen', 'Fade', 'Killjoy', 'Breach'],
  ],
  Haven: [
    ['Jett', 'Omen', 'Sova', 'Killjoy', 'Breach'],
    ['Raze', 'Astra', 'Fade', 'Cypher', 'Skye'],
  ],
  Split: [
    ['Raze', 'Omen', 'Skye', 'Cypher', 'Viper'],
    ['Jett', 'Astra', 'Fade', 'Killjoy', 'Breach'],
  ],
  Icebox: [
    ['Jett', 'Viper', 'Sova', 'Killjoy', 'KAY/O'],
    ['Raze', 'Omen', 'Gekko', 'Sage', 'Fade'],
  ],
  Breeze: [
    ['Jett', 'Viper', 'Sova', 'Cypher', 'KAY/O'],
    ['Yoru', 'Harbor', 'Fade', 'Killjoy', 'Skye'],
  ],
  Fracture: [
    ['Raze', 'Brimstone', 'Breach', 'Cypher', 'Fade'],
    ['Neon', 'Omen', 'Skye', 'Killjoy', 'KAY/O'],
  ],
  Pearl: [
    ['Jett', 'Astra', 'Fade', 'Killjoy', 'KAY/O'],
    ['Raze', 'Omen', 'Sova', 'Cypher', 'Skye'],
  ],
  Lotus: [
    ['Raze', 'Omen', 'Fade', 'Killjoy', 'Viper'],
    ['Jett', 'Astra', 'Gekko', 'Cypher', 'Breach'],
  ],
  Sunset: [
    ['Raze', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Jett', 'Brimstone', 'Fade', 'Killjoy', 'Skye'],
  ],
  Abyss: [
    ['Jett', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Raze', 'Astra', 'Fade', 'Killjoy', 'Breach'],
  ],
  Corrode: [
    ['Jett', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Raze', 'Brimstone', 'Fade', 'Killjoy', 'Skye'],
  ],
  Summit: [
    ['Jett', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Raze', 'Astra', 'Fade', 'Killjoy', 'Breach'],
  ],
};

export function japaneseValorantMap(id: string | null): string {
  return VALORANT_MAPS.find((item) => item[0] === id)?.[1] ?? '指定なし';
}

export type TacticalPick =
  | { status: 'ok'; agents: string[]; description: string; version: string }
  | { status: 'unavailable' };

/**
 * The roster is deliberately not broadened with disabled agents.
 * For 1-4 players, the preset prefix prioritizes entry -> smoke -> info -> defense.
 * The input is a set of canonical English agent names, never display labels.
 */
export function pickTacticalAgents(
  map: ValorantMapId,
  participantCount: number,
  availableAgentNames: readonly string[],
  randomIndex: (maxExclusive: number) => number = randomInt,
): TacticalPick {
  if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 5) {
    return { status: 'unavailable' };
  }
  const available = new Set(availableAgentNames);
  const viable = PRESETS[map].map((preset) => preset.slice(0, participantCount))
    .filter((agents) => agents.every((name) => available.has(name)));
  if (viable.length === 0) return { status: 'unavailable' };
  const index = randomIndex(viable.length);
  if (!Number.isInteger(index) || index < 0 || index >= viable.length) throw new RangeError('randomIndex out of range');
  return {
    status: 'ok',
    agents: [...viable[index]!],
    description: participantCount < 5
      ? '未完成の5人編成です。参加人数に合わせエントリー→スモーク→索敵→防衛を優先しています。'
      : 'エントリー・射線管理・情報収集・防衛と連携を意識した候補構成です。勝率保証はありません。',
    version: VALORANT_COMPOSITION_VERSION,
  };
}
