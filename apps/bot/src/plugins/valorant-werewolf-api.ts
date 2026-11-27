import type { ValorantTroll } from './valorant-troll-gacha.js';
import type { WerewolfPhase, WerewolfRosterEntry } from './valorant-werewolf-core.js';
import {
  parseWerewolfRoster,
  parseWerewolfRoundHistory,
  type WerewolfGameRow,
  type WerewolfRoundHistoryEntry,
  type WerewolfSecretForUser,
} from './valorant-werewolf-repository.js';

/**
 * VALORANT 人狼モード (#1049) の Web 連携用 DTO と actor-aware
 * projection。Discord handler と S5 / S6 のポータルが同じドメイン
 * サービス・同じ DTO を使うための境界で、ここには transport を
 * 持たない。
 *
 * 秘匿の原則:
 * - 公開用 view は秘密テーブルを参照しない。RESOLVED 前は人狼 ID も
 *   縛り文も構造的に含められない (revealed は呼び出し側が結果確定
 *   後にだけ渡す)。
 * - 本人用 view でも、秘密の縛りは viewer 本人が人狼のときだけ、
 *   自分の投票先は viewer 本人のものだけを含める。
 */

export interface WerewolfSessionLike {
  id: string;
  guildId: string;
  channelId: string;
  creatorId: string;
  status: string;
  maxParticipants: number;
  expiresAt: Date;
  participants: readonly { userId: string }[];
}

export interface WerewolfRevealedLike {
  werewolfUserId: string;
  troll: ValorantTroll | null;
}

export interface WerewolfPublicResult {
  outcome: string | null;
  outcomeReason: string | null;
  accusedUserId: string | null;
  werewolfUserId: string;
  revealedTroll: ValorantTroll | null;
  rounds: WerewolfRoundHistoryEntry[];
  punishment: { userId: string; troll: ValorantTroll } | null;
  punishmentStatus: string;
}

export interface WerewolfPublicView {
  sessionId: string;
  guildId: string;
  channelId: string;
  creatorId: string;
  sessionStatus: string;
  /** game が無い募集中は RECRUITING */
  phase: WerewolfPhase | 'RECRUITING';
  roster: WerewolfRosterEntry[];
  maxParticipants: number;
  expiresAt: string;
  voteEndsAt: string | null;
  currentRound: number;
  currentCandidateUserIds: string[];
  /** 現在ラウンドの投票済み人数だけ。候補者別票数は結果まで出さない */
  votedCount: number;
  assignmentStatus: string | null;
  result: WerewolfPublicResult | null;
}

export interface WerewolfPersonalView {
  public: WerewolfPublicView;
  viewer: {
    userId: string;
    isParticipant: boolean;
    /** 参加者以外では null (役割を推測させない) */
    isWerewolf: boolean | null;
    ownVoteTargetUserId: string | null;
    /** viewer 本人が人狼のときだけ含まれる */
    secretTroll: ValorantTroll | null;
  };
}

function punishmentTroll(game: WerewolfGameRow): ValorantTroll | null {
  if (
    game.punishmentStatus !== 'READY' ||
    !game.punishmentItemId ||
    !game.punishmentText ||
    !game.punishmentRarity ||
    !game.punishmentCategory
  ) {
    return null;
  }
  return {
    itemId: game.punishmentItemId,
    text: game.punishmentText,
    rarity: game.punishmentRarity as ValorantTroll['rarity'],
    category: game.punishmentCategory as ValorantTroll['category'],
  };
}

export function buildWerewolfPublicView(
  session: WerewolfSessionLike,
  game: WerewolfGameRow | null,
  options: {
    votedCount?: number;
    revealed?: WerewolfRevealedLike | null;
    displayNames?: ReadonlyMap<string, string>;
  } = {},
): WerewolfPublicView {
  const roster: WerewolfRosterEntry[] = game
    ? parseWerewolfRoster(game.rosterSnapshot)
    : session.participants.map((participant, index) => ({
        userId: participant.userId,
        displayName: options.displayNames?.get(participant.userId) ?? `参加者${index + 1}`,
      }));
  let result: WerewolfPublicResult | null = null;
  if (game && game.phase === 'RESOLVED' && options.revealed) {
    const punishment = punishmentTroll(game);
    result = {
      outcome: game.outcome,
      outcomeReason: game.outcomeReason,
      accusedUserId: game.accusedUserId,
      werewolfUserId: options.revealed.werewolfUserId,
      revealedTroll: options.revealed.troll,
      rounds: parseWerewolfRoundHistory(game.roundHistory),
      punishment:
        punishment && game.punishmentUserId
          ? { userId: game.punishmentUserId, troll: punishment }
          : null,
      punishmentStatus: game.punishmentStatus,
    };
  }
  return {
    sessionId: session.id,
    guildId: session.guildId,
    channelId: session.channelId,
    creatorId: session.creatorId,
    sessionStatus: session.status,
    phase: game ? (game.phase as WerewolfPhase) : 'RECRUITING',
    roster,
    maxParticipants: session.maxParticipants,
    expiresAt: session.expiresAt.toISOString(),
    voteEndsAt: game?.voteEndsAt ? game.voteEndsAt.toISOString() : null,
    currentRound: game?.currentRound ?? 0,
    currentCandidateUserIds: game ? [...game.currentCandidateUserIds] : [],
    votedCount: options.votedCount ?? 0,
    assignmentStatus: game ? game.assignmentStatus : null,
    result,
  };
}

export function buildWerewolfPersonalView(
  publicView: WerewolfPublicView,
  input: {
    viewerUserId: string;
    secret: WerewolfSecretForUser;
    ownVoteTargetUserId: string | null;
  },
): WerewolfPersonalView {
  const isParticipant = publicView.roster.some((entry) => entry.userId === input.viewerUserId);
  const isWerewolf =
    input.secret.kind === 'werewolf' || input.secret.kind === 'werewolf_not_ready'
      ? true
      : input.secret.kind === 'citizen'
        ? false
        : null;
  return {
    public: publicView,
    viewer: {
      userId: input.viewerUserId,
      isParticipant,
      isWerewolf: isParticipant ? isWerewolf : null,
      ownVoteTargetUserId: isParticipant ? input.ownVoteTargetUserId : null,
      secretTroll: input.secret.kind === 'werewolf' ? input.secret.troll : null,
    },
  };
}
