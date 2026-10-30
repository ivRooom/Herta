import { randomInt } from 'node:crypto';

/**
 * TheSpike inspired the evaluation dimensions (played, pick rate, wins, win rate).
 * Its proprietary dataset is NOT downloaded, mirrored, or silently treated as evidence.
 * See docs/VALORANT_RANDOM.md for usage constraints and verification steps.
 */
export const VALORANT_COMPOSITION_REFERENCE =
  'https://www.thespike.gg/jp/valorant-stats/agents-compositions';
export const VALORANT_COMPOSITION_VERSION = '13.09-v2-evidence';
export const VALORANT_COMPOSITION_PATCH = '13.09';

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

/** Each lineup is ordered: entry -> smoke -> information -> site defense -> synergy/flex. */
type FiveAgentComposition = readonly [string, string, string, string, string];

/**
 * Editorial, map-specific tactical examples. These are NOT TheSpike's observed lineups,
 * usage rankings, or win rates. The additional alternatives preserve diversity without
 * independently mixing agents from incompatible compositions.
 */
const PRESETS: Record<ValorantMapId, readonly FiveAgentComposition[]> = {
  Ascent: [
    ['Jett', 'Omen', 'Sova', 'Killjoy', 'KAY/O'],
    ['Raze', 'Astra', 'Fade', 'Cypher', 'Breach'],
    ['Jett', 'Omen', 'Sova', 'Cypher', 'Gekko'],
  ],
  Bind: [
    ['Raze', 'Brimstone', 'Gekko', 'Cypher', 'Skye'],
    ['Yoru', 'Omen', 'Fade', 'Killjoy', 'Breach'],
    ['Raze', 'Brimstone', 'Skye', 'Cypher', 'Viper'],
  ],
  Haven: [
    ['Jett', 'Omen', 'Sova', 'Killjoy', 'Breach'],
    ['Raze', 'Astra', 'Fade', 'Cypher', 'Skye'],
    ['Jett', 'Omen', 'Sova', 'Cypher', 'Gekko'],
  ],
  Split: [
    ['Raze', 'Omen', 'Skye', 'Cypher', 'Viper'],
    ['Jett', 'Astra', 'Fade', 'Killjoy', 'Breach'],
    ['Raze', 'Omen', 'Fade', 'Cypher', 'Breach'],
  ],
  Icebox: [
    ['Jett', 'Viper', 'Sova', 'Killjoy', 'KAY/O'],
    ['Raze', 'Omen', 'Gekko', 'Sage', 'Fade'],
    ['Jett', 'Viper', 'Sova', 'Sage', 'Gekko'],
  ],
  Breeze: [
    ['Jett', 'Viper', 'Sova', 'Cypher', 'KAY/O'],
    ['Yoru', 'Harbor', 'Fade', 'Killjoy', 'Skye'],
    ['Yoru', 'Viper', 'Sova', 'Cypher', 'Skye'],
  ],
  Fracture: [
    ['Raze', 'Brimstone', 'Breach', 'Cypher', 'Fade'],
    ['Neon', 'Omen', 'Skye', 'Killjoy', 'KAY/O'],
    ['Raze', 'Brimstone', 'Fade', 'Killjoy', 'Breach'],
  ],
  Pearl: [
    ['Jett', 'Astra', 'Fade', 'Killjoy', 'KAY/O'],
    ['Raze', 'Omen', 'Sova', 'Cypher', 'Skye'],
    ['Jett', 'Astra', 'Sova', 'Cypher', 'Gekko'],
  ],
  Lotus: [
    ['Raze', 'Omen', 'Fade', 'Killjoy', 'Viper'],
    ['Jett', 'Astra', 'Gekko', 'Cypher', 'Breach'],
    ['Raze', 'Omen', 'Fade', 'Cypher', 'Viper'],
  ],
  Sunset: [
    ['Raze', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Jett', 'Brimstone', 'Fade', 'Killjoy', 'Skye'],
    ['Raze', 'Omen', 'Gekko', 'Cypher', 'Breach'],
  ],
  Abyss: [
    ['Jett', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Raze', 'Astra', 'Fade', 'Killjoy', 'Breach'],
    ['Jett', 'Astra', 'Sova', 'Cypher', 'Gekko'],
  ],
  Corrode: [
    ['Jett', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Raze', 'Brimstone', 'Fade', 'Killjoy', 'Skye'],
    ['Jett', 'Omen', 'Fade', 'Cypher', 'Breach'],
  ],
  Summit: [
    ['Jett', 'Omen', 'Sova', 'Cypher', 'KAY/O'],
    ['Raze', 'Astra', 'Fade', 'Killjoy', 'Breach'],
    ['Jett', 'Astra', 'Gekko', 'Cypher', 'Breach'],
  ],
};

interface MapTacticalPlan {
  readonly label: string;
  readonly focus: string;
}
const MAP_PLANS: Record<ValorantMapId, MapTacticalPlan> = {
  Ascent: { label: 'ミッド制圧', focus: '索敵と射線分断からミッドを確保し、設置後を守る' },
  Bind: { label: '入口突破とリテイク', focus: 'フラッシュ／エリア制圧を合わせて狭い入口を突破する' },
  Haven: { label: '3サイトの情報管理', focus: '索敵から防衛配置を読んでローテーションを支える' },
  Split: { label: '高低差・チョーク管理', focus: 'エントリー補助とスモークで狭い通路を制圧する' },
  Icebox: { label: '縦方向の制圧', focus: '射線を遮りながら高所と設置地点の確保を優先する' },
  Breeze: { label: '長距離射線と索敵', focus: '広い射線を制御し、情報を得て前進する' },
  Fracture: { label: '挟み込みと連携', focus: '多方向からの侵攻をフラッシュ／範囲妨害で支援する' },
  Pearl: { label: 'ミッドと長距離制圧', focus: '重要な射線を管理し、索敵からサイトへ進入する' },
  Lotus: { label: '3サイトの制圧', focus: 'スモークと情報収集を組み合わせて複数の進入経路に備える' },
  Sunset: { label: 'ミッド情報・エリア保持', focus: '索敵とセンチネルの警戒を軸にエリアを確保する' },
  Abyss: { label: '長い射線と進入補助', focus: 'スモーク・索敵・防衛の連携で広いエリアを扱う' },
  Corrode: { label: 'ミッド争奪とリテイク', focus: 'ミッドの戦闘と13.08で調整された防衛側回転路を意識する' },
  Summit: { label: 'エリア確保と情報共有', focus: '進入時の索敵と防衛側の監視を両立する' },
};

export function japaneseValorantMap(id: string | null): string {
  return VALORANT_MAPS.find((item) => item[0] === id)?.[1] ?? '指定なし';
}

export function tacticalMapPlan(map: ValorantMapId): MapTacticalPlan {
  return MAP_PLANS[map];
}

/**
 * Optional vetted, licensed source data. Do NOT populate this directly by scraping TheSpike.
 * All values must be verified for the same map, patch and observation period. Missing or
 * non-comparable samples MUST fall back to equal probabilities, not invented statistics.
 */
export interface TacticalCompositionEvidence {
  map: ValorantMapId;
  agents: readonly string[];
  patch: string;
  observedAt: string; // YYYY-MM-DD, UTC
  matchesPlayed: number;
  matchesWon: number;
  mapMatchesPlayed: number;
  provenance: 'manually-verified-authorized';
}

export type TacticalPick =
  | {
      status: 'ok';
      agents: string[];
      description: string;
      version: string;
      basis: 'curated' | 'verified-statistics';
    }
  | { status: 'unavailable' };

const keyOf = (agents: readonly string[]) => [...agents].sort().join('|');
const datePattern = /^\\d{4}-\\d{2}-\\d{2}$/;

function validEvidence(
  item: TacticalCompositionEvidence,
  map: ValorantMapId,
  agents: readonly string[],
  today: Date,
): boolean {
  if (item.provenance !== 'manually-verified-authorized' ||
    item.map !== map || item.patch !== VALORANT_COMPOSITION_PATCH ||
    keyOf(item.agents) !== keyOf(agents) || !datePattern.test(item.observedAt) ||
    !Number.isInteger(item.matchesPlayed) || item.matchesPlayed < 30 ||
    !Number.isInteger(item.matchesWon) || item.matchesWon < 0 ||
    item.matchesWon > item.matchesPlayed ||
    !Number.isInteger(item.mapMatchesPlayed) ||
    item.mapMatchesPlayed < item.matchesPlayed) return false;
  const timestamp = Date.parse(item.observedAt + 'T00:00:00.000Z');
  const age = today.getTime() - timestamp;
  return Number.isFinite(age) && age >= 0 && age <= 60 * 86_400_000;
}

/**
 * Sample-aware weights use BOTH usage (pick share) and shrinkage-adjusted wins.
 * Never claim these weights are real probabilities of winning a ranked match.
 */
export function evidenceWeights(
  map: ValorantMapId,
  compositions: readonly (readonly string[])[],
  evidence: readonly TacticalCompositionEvidence[],
  today: Date,
): number[] | null {
  if (!compositions.length) return null;
  const rows = compositions.map((agents) => {
    const matches = evidence.filter((item) => item.map === map &&
      keyOf(item.agents) === keyOf(agents));
    if (matches.length !== 1 || !validEvidence(matches[0]!, map, agents, today))
      return null;
    return matches[0]!;
  });
  if (rows.some((row) => row === null)) return null;
  const denominator = rows[0]!.mapMatchesPlayed;
  if (rows.some((row) => row!.mapMatchesPlayed !== denominator)) return null;
  return rows.map((row) => {
    const stats = row!;
    const smoothedWinShare = (stats.matchesWon + 15) / (stats.matchesPlayed + 30);
    const pickShare = stats.matchesPlayed / stats.mapMatchesPlayed;
    // Constrain weighting to prevent overfitting to exceptionally small sample counts.
    return Math.max(1, Math.min(100, Math.round(10 * (0.75 * smoothedWinShare +
      0.25 * Math.min(1, pickShare * 4)))));
  });
}

/**
 * In the absence of complete, current, authorized statistics, select each distinct viable
 * composition uniformly. This does not affect /valorant random (pure Fisher-Yates).
 *
 * For 1-4 players, use the 5-agent composition's role-ordered prefix. Full-lineup
 * statistics are never applied to smaller parties.
 */
export function pickTacticalAgents(
  map: ValorantMapId,
  participantCount: number,
  availableAgentNames: readonly string[],
  randomIndex: (maxExclusive: number) => number = randomInt,
  evidence: readonly TacticalCompositionEvidence[] = [],
  today: Date = new Date(),
): TacticalPick {
  if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 5) {
    return { status: 'unavailable' };
  }
  const available = new Set(availableAgentNames);
  const unique = new Set<string>();
  const viable = PRESETS[map]
    .map((preset) => preset.slice(0, participantCount))
    .filter((agents) => agents.every((name) => available.has(name)))
    .filter((agents) => {
      const key = keyOf(agents);
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    });
  if (viable.length === 0) return { status: 'unavailable' };
  const weights = participantCount === 5 ? evidenceWeights(map, viable, evidence, today) : null;
  const totalWeight = weights?.reduce((sum, weight) => sum + weight, 0) ?? viable.length;
  const roll = randomIndex(totalWeight);
  if (!Number.isInteger(roll) || roll < 0 || roll >= totalWeight) {
    throw new RangeError('randomIndex out of range');
  }
  let selection = 0;
  if (weights) {
    let running = 0;
    selection = weights.findIndex((weight) => {
      running += weight;
      return roll < running;
    });
  } else {
    selection = roll;
  }
  const plan = MAP_PLANS[map];
  return {
    status: 'ok',
    agents: [...viable[selection]!],
    description: participantCount < 5
      ? `未完成の5人編成（${participantCount}/5名）。エントリー→スモーク→索敵→防衛を優先。`
      : `${plan.label}：${plan.focus}。勝率の保証はありません。`,
    version: VALORANT_COMPOSITION_VERSION,
    basis: weights ? 'verified-statistics' : 'curated',
  };
}
