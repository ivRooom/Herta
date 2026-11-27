import { randomInt } from 'node:crypto';
import type { ValorantTrollCategory } from './valorant-troll-gacha.js';

/**
 * VALORANT 人狼モード (#1049) の純ロジック。
 *
 * 集計・決選判定・勝敗判定・罰ゲーム候補選定・状態遷移ガードだけを
 *持ち、DB も Discord も知らない。乱数は暗号論的乱数 (node:crypto の
 * randomInt) を既定とし、テストでは注入できる。
 *
 * 確定済みルール (2026-11-27 Kanata 推奨セット):
 * - 開始は3〜5人。初版はエージェント割当なし
 * - 秘密の縛りのカテゴリは troll / settings / custom (punishment は混ぜない)
 * - 自分への投票は禁止、締切前は投票変更可
 * - 決選は最大1回。最終同票は指名なしで人狼勝利
 * - 罰ゲームは本投票 (round=1) の最少票者 (0票含む、同票はランダム、
 *   人狼も除外しない)。投票総数0なら勝敗なし・罰ゲームなし
 * - 投票/決選の目安期限は5分 (scheduler は入れない)
 */

export const WEREWOLF_MIN_PLAYERS = 3;
export const WEREWOLF_MAX_PLAYERS = 5;
/** 本投票 + 決選1回まで */
export const WEREWOLF_MAX_ROUNDS = 2;
export const WEREWOLF_VOTE_MINUTES = 5;

/** 秘密の縛りに使うカテゴリ。罰ゲームは結果後の別抽選なので混ぜない */
export const WEREWOLF_SECRET_CATEGORIES: readonly ValorantTrollCategory[] = [
  'troll',
  'settings',
  'custom',
];

export type WerewolfPhase =
  'ASSIGNING' | 'PLAYING' | 'VOTING' | 'RUNOFF' | 'RESOLVING' | 'RESOLVED' | 'ABORTED';

export type WerewolfOutcome = 'CITIZENS_WIN' | 'WEREWOLF_WIN';
export type WerewolfOutcomeReason = 'ACCUSED_FOUND' | 'ACCUSED_MISSED' | 'FINAL_TIE' | 'NO_VOTES';

export interface WerewolfRosterEntry {
  userId: string;
  displayName: string;
}

/** [0, maxExclusive) の一様乱数。既定は暗号論的乱数 */
export type WerewolfRandomInt = (maxExclusive: number) => number;
export const cryptoWerewolfRandomInt: WerewolfRandomInt = (maxExclusive) => randomInt(maxExclusive);

/** roster から人狼を1人選ぶ。roster 外や重複は構造的に起きない */
export function selectWerewolfUserId(
  roster: readonly WerewolfRosterEntry[],
  random: WerewolfRandomInt = cryptoWerewolfRandomInt,
): string | null {
  if (roster.length === 0) return null;
  const index = Math.max(0, Math.min(roster.length - 1, random(roster.length)));
  return roster[index]!.userId;
}

/** 候補者集合から1人をランダムに選ぶ (罰ゲーム対象の同票決着用) */
export function pickRandomUserId(
  candidates: readonly string[],
  random: WerewolfRandomInt = cryptoWerewolfRandomInt,
): string | null {
  if (candidates.length === 0) return null;
  const index = Math.max(0, Math.min(candidates.length - 1, random(candidates.length)));
  return candidates[index]!;
}

export interface WerewolfVoteRecord {
  voterUserId: string;
  targetUserId: string;
}

/**
 * 候補者別の票数を数える。候補者全員をキーに持ち、0票も含める。
 * 候補者以外への投票行は集計対象外 (repository が書き込み時に弾く前提の
 * 防御)。
 */
export function tallyWerewolfVotes(
  votes: readonly WerewolfVoteRecord[],
  candidateUserIds: readonly string[],
): Map<string, number> {
  const tally = new Map<string, number>();
  for (const candidate of candidateUserIds) tally.set(candidate, 0);
  for (const vote of votes) {
    const current = tally.get(vote.targetUserId);
    if (current !== undefined) tally.set(vote.targetUserId, current + 1);
  }
  return tally;
}

export function totalWerewolfVotes(tally: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of tally.values()) total += count;
  return total;
}

/** 最多票の候補者を roster 順で返す (同票は全員) */
export function leadingWerewolfCandidates(
  tally: ReadonlyMap<string, number>,
  rosterOrder: readonly string[],
): string[] {
  let max = -1;
  for (const userId of rosterOrder) max = Math.max(max, tally.get(userId) ?? 0);
  if (max < 0) return [];
  return rosterOrder.filter((userId) => (tally.get(userId) ?? 0) === max);
}

/** 最少票の候補者を roster 順で返す (0票含む、同票は全員) */
export function trailingWerewolfCandidates(
  tally: ReadonlyMap<string, number>,
  rosterOrder: readonly string[],
): string[] {
  let min = Number.POSITIVE_INFINITY;
  for (const userId of rosterOrder) min = Math.min(min, tally.get(userId) ?? 0);
  if (!Number.isFinite(min)) return [];
  return rosterOrder.filter((userId) => (tally.get(userId) ?? 0) === min);
}

export type WerewolfRoundDecision =
  | { kind: 'accused'; accusedUserId: string }
  | { kind: 'runoff'; candidateUserIds: string[] }
  | { kind: 'final_tie' }
  | { kind: 'no_votes' };

/**
 * 1ラウンドの締切判定。
 * - 投票総数0: round=1 なら勝敗なし (no_votes)。決選で0票なら候補者を
 *   決められないため最終同票として扱う
 * - 単独首位: その人が指名者
 * - 同票首位: まだ決選が残っていれば決選へ、最終ラウンドなら指名なし
 */
export function decideWerewolfRound(
  tally: ReadonlyMap<string, number>,
  rosterOrder: readonly string[],
  round: number,
): WerewolfRoundDecision {
  if (totalWerewolfVotes(tally) === 0) {
    return round >= WEREWOLF_MAX_ROUNDS ? { kind: 'final_tie' } : { kind: 'no_votes' };
  }
  const leaders = leadingWerewolfCandidates(tally, rosterOrder);
  if (leaders.length === 1) return { kind: 'accused', accusedUserId: leaders[0]! };
  if (round < WEREWOLF_MAX_ROUNDS) return { kind: 'runoff', candidateUserIds: leaders };
  return { kind: 'final_tie' };
}

/** 指名者が人狼なら市民勝利、それ以外は人狼勝利 */
export function judgeWerewolfOutcome(
  accusedUserId: string | null,
  werewolfUserId: string,
): { outcome: WerewolfOutcome; reason: WerewolfOutcomeReason } {
  if (accusedUserId === null) return { outcome: 'WEREWOLF_WIN', reason: 'FINAL_TIE' };
  return accusedUserId === werewolfUserId
    ? { outcome: 'CITIZENS_WIN', reason: 'ACCUSED_FOUND' }
    : { outcome: 'WEREWOLF_WIN', reason: 'ACCUSED_MISSED' };
}

/**
 * 罰ゲーム対象の候補集合は本投票 (round=1) の最少票者。
 * 決選の票は使わない。投票総数0なら対象なし (空配列)。
 */
export function werewolfPunishmentCandidates(
  firstRoundTally: ReadonlyMap<string, number>,
  rosterOrder: readonly string[],
): string[] {
  if (totalWerewolfVotes(firstRoundTally) === 0) return [];
  return trailingWerewolfCandidates(firstRoundTally, rosterOrder);
}

export type WerewolfAction =
  'start' | 'confirm_assignment' | 'open_vote' | 'cast_vote' | 'close_round' | 'resolve' | 'abort';

/** 状態遷移ガード: 不正な phase からはどの操作も進めない */
export function canWerewolfTransition(phase: WerewolfPhase, action: WerewolfAction): boolean {
  switch (action) {
    case 'start':
      return phase === 'ASSIGNING';
    case 'confirm_assignment':
      return phase === 'ASSIGNING';
    case 'open_vote':
      return phase === 'PLAYING';
    case 'cast_vote':
      return phase === 'VOTING' || phase === 'RUNOFF';
    case 'close_round':
      return phase === 'VOTING' || phase === 'RUNOFF';
    case 'resolve':
      return phase === 'RESOLVING';
    case 'abort':
      return phase !== 'RESOLVED' && phase !== 'ABORTED';
  }
}

/** roster の妥当性 (開始条件 3〜5人、重複なし) */
export function isValidWerewolfRoster(roster: readonly WerewolfRosterEntry[]): boolean {
  if (roster.length < WEREWOLF_MIN_PLAYERS || roster.length > WEREWOLF_MAX_PLAYERS) return false;
  return new Set(roster.map((entry) => entry.userId)).size === roster.length;
}
