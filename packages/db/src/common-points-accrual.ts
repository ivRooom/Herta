import { createHash } from 'node:crypto';
import type { CommunityPointsRatesInput } from './community-points-leaderboard.js';

const RATE_KEYS = [
  'messagePointsPerMessage',
  'reactionPointsPerReaction',
  'voicePointsPer10Minutes',
  'onlinePointsPerHour',
  'onlinePointsDailyCap',
  'gamePointsPerHour',
  'gamePointsDailyCap',
  'achievementPoints',
  'commandPointsPerUse',
  'commandPointsDailyCap',
  'lfgPointsPerJoin',
  'lfgPointsDailyCap',
  'teamSplitPointsPerJoin',
  'teamSplitPointsDailyCap',
  'pollPointsPerVote',
  'pollPointsDailyCap',
] as const satisfies readonly (keyof CommunityPointsRatesInput)[];
export const COMMON_POINTS_FORMULA = 'herta-jst-daily-v1' as const;
const MAX_COUNTER = 9_223_372_036_854_775_807n;

export interface FrozenCommonPointsTariff {
  readonly formula: typeof COMMON_POINTS_FORMULA;
  readonly rates: Readonly<CommunityPointsRatesInput>;
  readonly ruleVersion: string;
}

/** Capture once at reviewed cutoff. Never read mutable guild configuration on replay. */
export function freezeCommonPointsTariff(
  rates: CommunityPointsRatesInput,
): FrozenCommonPointsTariff {
  if (
    Object.keys(rates).length !== RATE_KEYS.length ||
    RATE_KEYS.some(
      (key) => !Number.isSafeInteger(rates[key]) || rates[key] < 0 || rates[key] > 2_147_483_647,
    )
  )
    throw new Error('invalid_common_points_tariff');
  const frozenRates = Object.freeze(
    Object.fromEntries(
      [...RATE_KEYS].sort().map((key) => [key, rates[key]]),
    ) as unknown as CommunityPointsRatesInput,
  );
  const formula = COMMON_POINTS_FORMULA;
  const ruleVersion = createHash('sha256')
    .update(JSON.stringify({ formula, rates: frozenRates }))
    .digest('hex');
  return Object.freeze({ formula, rates: frozenRates, ruleVersion });
}

export function assertFrozenCommonPointsTariff(value: FrozenCommonPointsTariff): void {
  if (
    value.formula !== COMMON_POINTS_FORMULA ||
    freezeCommonPointsTariff(value.rates).ruleVersion !== value.ruleVersion
  )
    throw new Error('common_points_tariff_mismatch');
}

export type CommonPointsMetric =
  | 'messages'
  | 'reactions_given'
  | 'reactions_received'
  | 'voice_seconds'
  | 'online_seconds'
  | 'game_seconds'
  | 'commands'
  | 'lfg_joins'
  | 'team_split_joins'
  | 'poll_votes'
  | 'achievement_unlocks';

/** One guild/user/JST-day bucket. Game units aggregate ALL game names first. */
export function commonPointsBucketValue(
  tariff: FrozenCommonPointsTariff,
  metric: CommonPointsMetric,
  units: bigint,
): bigint {
  assertFrozenCommonPointsTariff(tariff);
  if (typeof units !== 'bigint' || units < 0n || units > MAX_COUNTER)
    throw new Error('invalid_common_points_units');
  const r = tariff.rates;
  let unitSize = 1n,
    rate: number,
    cap: number | undefined;
  switch (metric) {
    case 'messages':
      rate = r.messagePointsPerMessage;
      break;
    case 'reactions_given':
    case 'reactions_received':
      rate = r.reactionPointsPerReaction;
      break;
    case 'voice_seconds':
      unitSize = 600n;
      rate = r.voicePointsPer10Minutes;
      break;
    case 'online_seconds':
      unitSize = 3600n;
      rate = r.onlinePointsPerHour;
      cap = r.onlinePointsDailyCap;
      break;
    case 'game_seconds':
      unitSize = 3600n;
      rate = r.gamePointsPerHour;
      cap = r.gamePointsDailyCap;
      break;
    case 'commands':
      rate = r.commandPointsPerUse;
      cap = r.commandPointsDailyCap;
      break;
    case 'lfg_joins':
      rate = r.lfgPointsPerJoin;
      cap = r.lfgPointsDailyCap;
      break;
    case 'team_split_joins':
      rate = r.teamSplitPointsPerJoin;
      cap = r.teamSplitPointsDailyCap;
      break;
    case 'poll_votes':
      rate = r.pollPointsPerVote;
      cap = r.pollPointsDailyCap;
      break;
    case 'achievement_unlocks':
      rate = r.achievementPoints;
      break;
    default:
      throw new Error('unsupported_common_points_metric');
  }
  const points = (units / unitSize) * BigInt(rate);
  return cap !== undefined && points > BigInt(cap) ? BigInt(cap) : points;
}

/** Caller must lock/persist the bucket and earning+outbox in ONE source transaction. */
export function calculateCommonPointsDelta(
  tariff: FrozenCommonPointsTariff,
  metric: CommonPointsMetric,
  beforeUnits: bigint,
  afterUnits: bigint,
): bigint {
  const before = commonPointsBucketValue(tariff, metric, beforeUnits);
  const after = commonPointsBucketValue(tariff, metric, afterUnits);
  if (afterUnits < beforeUnits) throw new Error('common_points_counter_decreased');
  return after - before;
}

/** JST calendar day; UTC timestamps are transport instants, never bucket keys. */
export function commonPointsJstDay(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) throw new Error('invalid_common_points_instant');
  return new Date(instant.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
