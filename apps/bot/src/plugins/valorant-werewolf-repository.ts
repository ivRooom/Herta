import type { Prisma, PrismaClient, ValorantWerewolfGame } from '@herta/db';
import type { ValorantTroll } from './valorant-troll-gacha.js';
import {
  decideWerewolfRound,
  judgeWerewolfOutcome,
  pickRandomUserId,
  selectWerewolfUserId,
  tallyWerewolfVotes,
  werewolfPunishmentCandidates,
  WEREWOLF_VOTE_MINUTES,
  type WerewolfRandomInt,
  type WerewolfRosterEntry,
} from './valorant-werewolf-core.js';
import type { ValorantSessionSnapshot } from './valorant-session-repository.js';

/**
 * VALORANT 人狼モード (#1049) の repository。
 *
 * 部屋の殻は valorant_pick_sessions、進行は valorant_werewolf_games、
 * 秘密は valorant_werewolf_secrets、投票は valorant_werewolf_votes。
 * すべての mutation は pick session 行を FOR UPDATE でロックし、
 * ReadCommitted で状態を再検査する (既存セッション基盤と同型)。
 *
 * 秘匿の境界:
 * - 秘密テーブルを読むのは「内部処理」と「指定 actor 本人用」の関数
 *   だけ。一般の状態取得 (getValorantWerewolfState) は secret を
 *   include しない。
 * - 秘密が公開側へ出るのは結果確定 transaction が game の
 *   revealed_* へ複写する瞬間だけ。中止時は複写しない。
 * - エラーコードは短い分類文字列だけを保存し、API 応答本文や縛り文は
 *   保存しない。
 */

export type WerewolfGameRow = ValorantWerewolfGame;

export interface WerewolfState {
  session: ValorantSessionSnapshot;
  game: WerewolfGameRow | null;
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const SESSION_INCLUDE: Prisma.ValorantPickSessionInclude = {
  participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] },
};

async function lockSessionRow(tx: Tx, guildId: string, id: string): Promise<boolean> {
  const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "valorant_pick_sessions" WHERE "id" = $1 AND "guild_id" = $2 FOR UPDATE',
    id,
    guildId,
  );
  return locked.length > 0;
}

async function loadSession(tx: Tx, guildId: string, id: string) {
  return tx.valorantPickSession.findFirst({
    where: { id, guildId },
    include: SESSION_INCLUDE,
  });
}

async function loadGame(tx: Tx | PrismaClient, id: string) {
  return tx.valorantWerewolfGame.findUnique({ where: { sessionId: id } });
}

function sanitizeErrorCode(code: string | null | undefined): string {
  if (code && /^[a-z0-9_:-]{1,40}$/i.test(code)) return code;
  return 'unknown';
}

/** roster_snapshot JSON を検証して取り出す。壊れた行は空として扱う */
export function parseWerewolfRoster(value: unknown): WerewolfRosterEntry[] {
  if (!Array.isArray(value)) return [];
  const roster: WerewolfRosterEntry[] = [];
  for (const entry of value) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof (entry as { userId?: unknown }).userId === 'string' &&
      typeof (entry as { displayName?: unknown }).displayName === 'string'
    ) {
      roster.push({
        userId: (entry as { userId: string }).userId,
        displayName: (entry as { displayName: string }).displayName,
      });
    }
  }
  return roster;
}

/** first_round_tally JSON (userId -> 票数) を Map へ戻す */
export function parseWerewolfTally(value: unknown): Map<string, number> {
  const tally = new Map<string, number>();
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [userId, count] of Object.entries(value)) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
        tally.set(userId, Math.floor(count));
      }
    }
  }
  return tally;
}

export interface WerewolfRoundHistoryEntry {
  round: number;
  candidateUserIds: string[];
  tally: Record<string, number>;
  votedCount: number;
  rosterSize: number;
  closeReason: 'all_voted' | 'manual' | 'expired';
}

export function parseWerewolfRoundHistory(value: unknown): WerewolfRoundHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const history: WerewolfRoundHistoryEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record['round'] !== 'number') continue;
    history.push({
      round: record['round'],
      candidateUserIds: Array.isArray(record['candidateUserIds'])
        ? record['candidateUserIds'].filter((id): id is string => typeof id === 'string')
        : [],
      tally: Object.fromEntries(parseWerewolfTally(record['tally'])),
      votedCount: typeof record['votedCount'] === 'number' ? record['votedCount'] : 0,
      rosterSize: typeof record['rosterSize'] === 'number' ? record['rosterSize'] : 0,
      closeReason:
        record['closeReason'] === 'manual' || record['closeReason'] === 'expired'
          ? record['closeReason']
          : 'all_voted',
    });
  }
  return history;
}

function trollSnapshot(troll: ValorantTroll) {
  return {
    trollItemId: troll.itemId,
    trollText: troll.text,
    trollRarity: troll.rarity,
    trollCategory: troll.category,
  };
}

function readSecretTroll(
  secret: {
    trollItemId: string | null;
    trollText: string | null;
    trollRarity: string | null;
    trollCategory: string | null;
  } | null,
): ValorantTroll | null {
  if (
    !secret ||
    !secret.trollItemId ||
    !secret.trollText ||
    !secret.trollRarity ||
    !secret.trollCategory
  ) {
    return null;
  }
  return {
    itemId: secret.trollItemId,
    text: secret.trollText,
    rarity: secret.trollRarity as ValorantTroll['rarity'],
    category: secret.trollCategory as ValorantTroll['category'],
  };
}

// ---------------------------------------------------------------------------
// 状態取得 (秘密を含まない)
// ---------------------------------------------------------------------------

export async function getValorantWerewolfState(
  prisma: PrismaClient,
  guildId: string,
  id: string,
): Promise<WerewolfState | null> {
  const session = await prisma.valorantPickSession.findFirst({
    where: { id, guildId },
    include: SESSION_INCLUDE,
  });
  if (!session) return null;
  const game = await prisma.valorantWerewolfGame.findUnique({ where: { sessionId: id } });
  return { session: session as ValorantSessionSnapshot, game };
}

// ---------------------------------------------------------------------------
// 開始 (行ロック内で roster 固定 + 人狼選定 + IN_PROGRESS 遷移)
// ---------------------------------------------------------------------------

export type WerewolfStartResult =
  | {
      status: 'ok';
      started: boolean;
      session: ValorantSessionSnapshot;
      game: WerewolfGameRow;
      werewolf: WerewolfRosterEntry;
    }
  | { status: 'missing' | 'closed' | 'forbidden' | 'insufficient' | 'not_werewolf' | 'invalid' };

export async function startValorantWerewolfGame(
  prisma: PrismaClient,
  input: {
    guildId: string;
    id: string;
    userId: string;
    isAdmin: boolean;
    displayNames: ReadonlyMap<string, string>;
    pickWerewolf?: (roster: readonly WerewolfRosterEntry[]) => string | null;
  },
): Promise<WerewolfStartResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      if (row.mode !== 'WEREWOLF') return { status: 'not_werewolf' };
      const existing = await loadGame(tx, input.id);
      if (existing) {
        // 開始リトライは同じ game・同じ人狼へ収束させる (引き直さない)
        if (row.status === 'IN_PROGRESS' && existing.phase === 'ASSIGNING') {
          const secret = await tx.valorantWerewolfSecret.findUnique({
            where: { sessionId: input.id },
          });
          const roster = parseWerewolfRoster(existing.rosterSnapshot);
          const werewolf = roster.find((entry) => entry.userId === secret?.werewolfUserId);
          if (!secret || !werewolf) return { status: 'invalid' };
          return {
            status: 'ok',
            started: false,
            session: row as ValorantSessionSnapshot,
            game: existing,
            werewolf,
          };
        }
        return { status: 'closed' };
      }
      if (row.status === 'OPEN' && row.expiresAt <= new Date()) {
        await tx.valorantPickSession.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
        return { status: 'closed' };
      }
      if (row.status !== 'OPEN') return { status: 'closed' };
      if (row.creatorId !== input.userId && !input.isAdmin) return { status: 'forbidden' };
      if (row.participants.length < 3 || row.participants.length > 5)
        return { status: 'insufficient' };
      const roster: WerewolfRosterEntry[] = row.participants.map((participant, index) => ({
        userId: participant.userId,
        displayName: input.displayNames.get(participant.userId) ?? `参加者${index + 1}`,
      }));
      const werewolfUserId = input.pickWerewolf
        ? input.pickWerewolf(roster)
        : selectWerewolfUserId(roster);
      const werewolf = roster.find((entry) => entry.userId === werewolfUserId);
      if (!werewolf) return { status: 'invalid' };
      const game = await tx.valorantWerewolfGame.create({
        data: {
          sessionId: row.id,
          guildId: row.guildId,
          phase: 'ASSIGNING',
          rosterSnapshot: JSON.parse(JSON.stringify(roster)) as object[],
          assignmentStatus: 'PENDING',
          startedAt: new Date(),
        },
      });
      await tx.valorantWerewolfSecret.create({
        data: { sessionId: row.id, guildId: row.guildId, werewolfUserId: werewolf.userId },
      });
      const session = await tx.valorantPickSession.update({
        where: { id: row.id },
        data: { status: 'IN_PROGRESS' },
        include: SESSION_INCLUDE,
      });
      return {
        status: 'ok',
        started: true,
        session: session as ValorantSessionSnapshot,
        game,
        werewolf,
      };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

// ---------------------------------------------------------------------------
// 秘密抽選の確定 / 失敗記録 (transaction 外の API 呼び出しを挟む)
// ---------------------------------------------------------------------------

export type WerewolfAssignmentResult =
  | { status: 'ok'; session: ValorantSessionSnapshot; game: WerewolfGameRow }
  | { status: 'missing' | 'closed' | 'wrong_phase' };

export async function completeValorantWerewolfAssignment(
  prisma: PrismaClient,
  input: { guildId: string; id: string; drawId: string; troll: ValorantTroll },
): Promise<WerewolfAssignmentResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      if (row.status === 'CANCELLED') return { status: 'closed' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      if (game.phase !== 'ASSIGNING') return { status: 'wrong_phase' };
      await tx.valorantWerewolfSecret.update({
        where: { sessionId: input.id },
        data: { drawId: input.drawId, ...trollSnapshot(input.troll), assignedAt: new Date() },
      });
      const updated = await tx.valorantWerewolfGame.update({
        where: { sessionId: input.id },
        data: { assignmentStatus: 'READY', assignmentErrorCode: null, phase: 'PLAYING' },
      });
      return { status: 'ok', session: row as ValorantSessionSnapshot, game: updated };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

export async function failValorantWerewolfAssignment(
  prisma: PrismaClient,
  input: { guildId: string; id: string; errorCode: string | null; invalidResponse?: boolean },
): Promise<WerewolfAssignmentResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      if (row.status === 'CANCELLED') return { status: 'closed' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      if (game.phase !== 'ASSIGNING') return { status: 'wrong_phase' };
      const updated = await tx.valorantWerewolfGame.update({
        where: { sessionId: input.id },
        data: {
          assignmentStatus: input.invalidResponse ? 'INVALID_RESPONSE' : 'FAILED',
          assignmentErrorCode: sanitizeErrorCode(input.errorCode),
        },
      });
      return { status: 'ok', session: row as ValorantSessionSnapshot, game: updated };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

// ---------------------------------------------------------------------------
// 秘密確認 (指定 actor 本人用だけが秘密を読む)
// ---------------------------------------------------------------------------

export type WerewolfSecretForUser =
  | { kind: 'missing' }
  | { kind: 'not_started' }
  | { kind: 'not_participant' }
  | { kind: 'citizen' }
  | { kind: 'werewolf_not_ready' }
  | { kind: 'werewolf'; troll: ValorantTroll };

export async function getValorantWerewolfSecretForUser(
  prisma: PrismaClient,
  guildId: string,
  id: string,
  userId: string,
): Promise<WerewolfSecretForUser> {
  const session = await prisma.valorantPickSession.findFirst({ where: { id, guildId } });
  if (!session) return { kind: 'missing' };
  const game = await prisma.valorantWerewolfGame.findUnique({ where: { sessionId: id } });
  if (!game) return { kind: 'not_started' };
  const roster = parseWerewolfRoster(game.rosterSnapshot);
  if (!roster.some((entry) => entry.userId === userId)) return { kind: 'not_participant' };
  const secret = await prisma.valorantWerewolfSecret.findUnique({ where: { sessionId: id } });
  if (!secret || secret.werewolfUserId !== userId) return { kind: 'citizen' };
  const troll = readSecretTroll(secret);
  if (!troll || game.assignmentStatus !== 'READY') return { kind: 'werewolf_not_ready' };
  return { kind: 'werewolf', troll };
}

/** 本人が秘密を確認した時刻だけを記録する (本文や表示先は保存しない) */
export async function markValorantWerewolfSecretViewed(
  prisma: PrismaClient,
  guildId: string,
  id: string,
): Promise<void> {
  await prisma.valorantWerewolfSecret.updateMany({
    where: { sessionId: id, guildId },
    data: { secretViewedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// 投票開始 / 投票 / 締切
// ---------------------------------------------------------------------------

export type WerewolfOpenVoteResult =
  | { status: 'ok'; session: ValorantSessionSnapshot; game: WerewolfGameRow }
  | { status: 'missing' | 'closed' | 'forbidden' | 'wrong_phase' };

export async function openValorantWerewolfVote(
  prisma: PrismaClient,
  input: {
    guildId: string;
    id: string;
    userId: string;
    isAdmin: boolean;
    voteMinutes?: number;
  },
): Promise<WerewolfOpenVoteResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      if (row.status !== 'IN_PROGRESS') return { status: 'closed' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      if (game.phase !== 'PLAYING') return { status: 'wrong_phase' };
      if (row.creatorId !== input.userId && !input.isAdmin) return { status: 'forbidden' };
      const roster = parseWerewolfRoster(game.rosterSnapshot);
      const now = new Date();
      const updated = await tx.valorantWerewolfGame.update({
        where: { sessionId: input.id },
        data: {
          phase: 'VOTING',
          currentRound: 1,
          currentCandidateUserIds: roster.map((entry) => entry.userId),
          voteEndsAt: new Date(
            now.getTime() + (input.voteMinutes ?? WEREWOLF_VOTE_MINUTES) * 60_000,
          ),
          votingStartedAt: now,
        },
      });
      return { status: 'ok', session: row as ValorantSessionSnapshot, game: updated };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

export type WerewolfCastVoteResult =
  | {
      status: 'ok';
      game: WerewolfGameRow;
      votedCount: number;
      rosterSize: number;
      allVoted: boolean;
    }
  | {
      status:
        | 'missing'
        | 'not_voting'
        | 'stale_round'
        | 'not_participant'
        | 'not_candidate'
        | 'self_vote';
    };

export async function castValorantWerewolfVote(
  prisma: PrismaClient,
  input: { guildId: string; id: string; voterUserId: string; targetUserId: string; round: number },
): Promise<WerewolfCastVoteResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      if (game.phase !== 'VOTING' && game.phase !== 'RUNOFF') return { status: 'not_voting' };
      if (input.round !== game.currentRound) return { status: 'stale_round' };
      const roster = parseWerewolfRoster(game.rosterSnapshot);
      if (!roster.some((entry) => entry.userId === input.voterUserId))
        return { status: 'not_participant' };
      if (!game.currentCandidateUserIds.includes(input.targetUserId))
        return { status: 'not_candidate' };
      if (input.targetUserId === input.voterUserId) return { status: 'self_vote' };
      await tx.valorantWerewolfVote.upsert({
        where: {
          sessionId_round_voterUserId: {
            sessionId: input.id,
            round: game.currentRound,
            voterUserId: input.voterUserId,
          },
        },
        create: {
          sessionId: input.id,
          guildId: input.guildId,
          round: game.currentRound,
          voterUserId: input.voterUserId,
          targetUserId: input.targetUserId,
        },
        update: { targetUserId: input.targetUserId },
      });
      const votes = await tx.valorantWerewolfVote.findMany({
        where: { sessionId: input.id, round: game.currentRound },
        select: { voterUserId: true },
      });
      const votedCount = new Set(votes.map((vote) => vote.voterUserId)).size;
      return {
        status: 'ok',
        game,
        votedCount,
        rosterSize: roster.length,
        allVoted: votedCount >= roster.length,
      };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

/** 公開表示用の投票進捗 (投票済み人数だけ。候補者別票数は出さない) */
export async function getValorantWerewolfVoteProgress(
  prisma: PrismaClient,
  guildId: string,
  id: string,
): Promise<{ game: WerewolfGameRow; votedCount: number; rosterSize: number } | null> {
  const game = await prisma.valorantWerewolfGame.findFirst({ where: { sessionId: id, guildId } });
  if (!game) return null;
  const roster = parseWerewolfRoster(game.rosterSnapshot);
  if (game.currentRound < 1) return { game, votedCount: 0, rosterSize: roster.length };
  const votes = await prisma.valorantWerewolfVote.findMany({
    where: { sessionId: id, round: game.currentRound },
    select: { voterUserId: true },
  });
  return {
    game,
    votedCount: new Set(votes.map((vote) => vote.voterUserId)).size,
    rosterSize: roster.length,
  };
}

/** 本人用 DTO の材料: viewer の現在ラウンドの投票先 (他人には出さない) */
export async function getValorantWerewolfOwnVote(
  prisma: PrismaClient,
  id: string,
  round: number,
  voterUserId: string,
): Promise<string | null> {
  if (round < 1) return null;
  const vote = await prisma.valorantWerewolfVote.findUnique({
    where: { sessionId_round_voterUserId: { sessionId: id, round, voterUserId } },
    select: { targetUserId: true },
  });
  return vote?.targetUserId ?? null;
}

export type WerewolfCloseReason = 'all_voted' | 'manual' | 'expired';

export type WerewolfCloseRoundResult =
  | {
      status: 'ok';
      kind: 'runoff' | 'resolving' | 'no_votes';
      session: ValorantSessionSnapshot;
      game: WerewolfGameRow;
      needsPunishmentDraw: boolean;
    }
  | { status: 'missing' | 'forbidden' | 'wrong_phase' };

export async function closeValorantWerewolfRound(
  prisma: PrismaClient,
  input: {
    guildId: string;
    id: string;
    userId: string;
    isAdmin: boolean;
    reason: WerewolfCloseReason;
    voteMinutes?: number;
    random?: WerewolfRandomInt;
  },
): Promise<WerewolfCloseRoundResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      if (game.phase !== 'VOTING' && game.phase !== 'RUNOFF') return { status: 'wrong_phase' };
      if (input.reason === 'manual' && row.creatorId !== input.userId && !input.isAdmin)
        return { status: 'forbidden' };
      const roster = parseWerewolfRoster(game.rosterSnapshot);
      const rosterOrder = roster.map((entry) => entry.userId);
      const votes = await tx.valorantWerewolfVote.findMany({
        where: { sessionId: input.id, round: game.currentRound },
        select: { voterUserId: true, targetUserId: true },
      });
      const tally = tallyWerewolfVotes(votes, game.currentCandidateUserIds);
      const tallyRecord = Object.fromEntries(tally);
      const history = parseWerewolfRoundHistory(game.roundHistory);
      history.push({
        round: game.currentRound,
        candidateUserIds: [...game.currentCandidateUserIds],
        tally: tallyRecord,
        votedCount: new Set(votes.map((vote) => vote.voterUserId)).size,
        rosterSize: roster.length,
        closeReason: input.reason,
      });
      const firstRoundTally =
        game.currentRound === 1 ? tally : parseWerewolfTally(game.firstRoundTally);
      const baseUpdate = {
        roundHistory: JSON.parse(JSON.stringify(history)) as object[],
        ...(game.currentRound === 1
          ? { firstRoundTally: JSON.parse(JSON.stringify(tallyRecord)) as object }
          : {}),
        version: { increment: 1 },
      };
      const decision = decideWerewolfRound(tally, rosterOrder, game.currentRound);
      if (decision.kind === 'no_votes') {
        // 勝敗を付けず中止扱いにする。秘密は公開しない
        const updated = await tx.valorantWerewolfGame.update({
          where: { sessionId: input.id },
          data: {
            ...baseUpdate,
            phase: 'ABORTED',
            outcomeReason: 'NO_VOTES',
            voteEndsAt: null,
            abortedAt: new Date(),
          },
        });
        const session = await tx.valorantPickSession.update({
          where: { id: row.id },
          data: { status: 'CANCELLED' },
          include: SESSION_INCLUDE,
        });
        return {
          status: 'ok',
          kind: 'no_votes',
          session: session as ValorantSessionSnapshot,
          game: updated,
          needsPunishmentDraw: false,
        };
      }
      if (decision.kind === 'runoff') {
        const now = new Date();
        const updated = await tx.valorantWerewolfGame.update({
          where: { sessionId: input.id },
          data: {
            ...baseUpdate,
            phase: 'RUNOFF',
            currentRound: game.currentRound + 1,
            currentCandidateUserIds: decision.candidateUserIds,
            voteEndsAt: new Date(
              now.getTime() + (input.voteMinutes ?? WEREWOLF_VOTE_MINUTES) * 60_000,
            ),
          },
        });
        return {
          status: 'ok',
          kind: 'runoff',
          session: row as ValorantSessionSnapshot,
          game: updated,
          needsPunishmentDraw: false,
        };
      }
      // accused または final_tie: 勝敗を内部確定し、罰ゲーム対象を決める
      const secret = await tx.valorantWerewolfSecret.findUnique({
        where: { sessionId: input.id },
      });
      if (!secret) return { status: 'missing' };
      const accusedUserId = decision.kind === 'accused' ? decision.accusedUserId : null;
      const judged = judgeWerewolfOutcome(accusedUserId, secret.werewolfUserId);
      const punishmentCandidates = werewolfPunishmentCandidates(firstRoundTally, rosterOrder);
      const punishmentUserId =
        punishmentCandidates.length === 1
          ? punishmentCandidates[0]!
          : pickRandomUserId(punishmentCandidates, input.random);
      const updated = await tx.valorantWerewolfGame.update({
        where: { sessionId: input.id },
        data: {
          ...baseUpdate,
          phase: 'RESOLVING',
          accusedUserId,
          outcome: judged.outcome,
          outcomeReason: judged.reason,
          punishmentUserId,
          punishmentStatus: punishmentUserId ? 'PENDING' : 'NOT_STARTED',
          voteEndsAt: null,
        },
      });
      return {
        status: 'ok',
        kind: 'resolving',
        session: row as ValorantSessionSnapshot,
        game: updated,
        needsPunishmentDraw: punishmentUserId !== null,
      };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

// ---------------------------------------------------------------------------
// 罰ゲーム確定 / 失敗 / リトライ と結果確定 (公開境界)
// ---------------------------------------------------------------------------

/**
 * 結果確定の本体: 秘密の縛り snapshot を game の revealed_* へ複写し、
 * phase を RESOLVED、pick session を COMPLETED にする。この transaction
 * の前後が公開境界であり、中止フローはここを通らない。
 */
async function finalizeWerewolfResolution(tx: Tx, sessionRowId: string, gameId: string) {
  const secret = await tx.valorantWerewolfSecret.findUnique({ where: { sessionId: gameId } });
  const troll = readSecretTroll(secret);
  const updated = await tx.valorantWerewolfGame.update({
    where: { sessionId: gameId },
    data: {
      phase: 'RESOLVED',
      resolvedAt: new Date(),
      version: { increment: 1 },
      ...(troll
        ? {
            revealedTrollItemId: troll.itemId,
            revealedTrollText: troll.text,
            revealedTrollRarity: troll.rarity,
            revealedTrollCategory: troll.category,
          }
        : {}),
    },
  });
  await tx.valorantPickSession.update({
    where: { id: sessionRowId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  return updated;
}

export type WerewolfPunishmentResult =
  | { status: 'ok'; session: ValorantSessionSnapshot; game: WerewolfGameRow }
  | { status: 'missing' | 'closed' | 'wrong_phase' };

export async function completeValorantWerewolfPunishment(
  prisma: PrismaClient,
  input: { guildId: string; id: string; drawId: string; troll: ValorantTroll },
): Promise<WerewolfPunishmentResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      if (row.status === 'CANCELLED') return { status: 'closed' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      const punishmentData = {
        punishmentStatus: 'READY',
        punishmentErrorCode: null,
        punishmentDrawId: input.drawId,
        punishmentItemId: input.troll.itemId,
        punishmentText: input.troll.text,
        punishmentRarity: input.troll.rarity,
        punishmentCategory: input.troll.category,
      };
      if (game.phase === 'RESOLVING') {
        await tx.valorantWerewolfGame.update({
          where: { sessionId: input.id },
          data: punishmentData,
        });
        const updated = await finalizeWerewolfResolution(tx, row.id, input.id);
        const session = await loadSession(tx, input.guildId, input.id);
        return { status: 'ok', session: session as ValorantSessionSnapshot, game: updated };
      }
      // 結果公開後のリトライ成功: 罰ゲーム snapshot だけを差し替える
      if (game.phase === 'RESOLVED' && game.punishmentStatus === 'PENDING') {
        const updated = await tx.valorantWerewolfGame.update({
          where: { sessionId: input.id },
          data: punishmentData,
        });
        return { status: 'ok', session: row as ValorantSessionSnapshot, game: updated };
      }
      return { status: 'wrong_phase' };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

export async function failValorantWerewolfPunishment(
  prisma: PrismaClient,
  input: { guildId: string; id: string; errorCode: string | null },
): Promise<WerewolfPunishmentResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      if (row.status === 'CANCELLED') return { status: 'closed' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      const failureData = {
        punishmentStatus: 'UNAVAILABLE',
        punishmentErrorCode: sanitizeErrorCode(input.errorCode),
      };
      if (game.phase === 'RESOLVING') {
        // 罰ゲームの失敗で勝敗公開は止めない。そのまま結果確定する
        await tx.valorantWerewolfGame.update({
          where: { sessionId: input.id },
          data: failureData,
        });
        const updated = await finalizeWerewolfResolution(tx, row.id, input.id);
        const session = await loadSession(tx, input.guildId, input.id);
        return { status: 'ok', session: session as ValorantSessionSnapshot, game: updated };
      }
      if (game.phase === 'RESOLVED' && game.punishmentStatus === 'PENDING') {
        const updated = await tx.valorantWerewolfGame.update({
          where: { sessionId: input.id },
          data: failureData,
        });
        return { status: 'ok', session: row as ValorantSessionSnapshot, game: updated };
      }
      return { status: 'wrong_phase' };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

export type WerewolfPunishmentRetryResult =
  | {
      status: 'ok';
      session: ValorantSessionSnapshot;
      game: WerewolfGameRow;
      punishmentTarget: WerewolfRosterEntry;
    }
  | { status: 'missing' | 'forbidden' | 'wrong_phase' };

/** 結果公開後に罰ゲームだけを引き直すための再開 (対象者とキーは不変) */
export async function beginValorantWerewolfPunishmentRetry(
  prisma: PrismaClient,
  input: { guildId: string; id: string; userId: string; isAdmin: boolean },
): Promise<WerewolfPunishmentRetryResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      const game = await loadGame(tx, input.id);
      if (!game) return { status: 'missing' };
      if (row.creatorId !== input.userId && !input.isAdmin) return { status: 'forbidden' };
      if (
        game.phase !== 'RESOLVED' ||
        game.punishmentStatus !== 'UNAVAILABLE' ||
        !game.punishmentUserId
      )
        return { status: 'wrong_phase' };
      const roster = parseWerewolfRoster(game.rosterSnapshot);
      const punishmentTarget = roster.find((entry) => entry.userId === game.punishmentUserId);
      if (!punishmentTarget) return { status: 'wrong_phase' };
      const updated = await tx.valorantWerewolfGame.update({
        where: { sessionId: input.id },
        data: { punishmentStatus: 'PENDING', punishmentErrorCode: null },
      });
      return {
        status: 'ok',
        session: row as ValorantSessionSnapshot,
        game: updated,
        punishmentTarget,
      };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

// ---------------------------------------------------------------------------
// 中止 (秘密は公開しない)
// ---------------------------------------------------------------------------

export type WerewolfAbortResult =
  | {
      status: 'ok';
      changed: boolean;
      session: ValorantSessionSnapshot;
      game: WerewolfGameRow | null;
    }
  | { status: 'missing' | 'closed' | 'forbidden' | 'not_werewolf' };

export async function abortValorantWerewolfGame(
  prisma: PrismaClient,
  input: { guildId: string; id: string; userId: string; isAdmin: boolean },
): Promise<WerewolfAbortResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockSessionRow(tx, input.guildId, input.id))) return { status: 'missing' };
      const row = await loadSession(tx, input.guildId, input.id);
      if (!row) return { status: 'missing' };
      if (row.mode !== 'WEREWOLF') return { status: 'not_werewolf' };
      const game = await loadGame(tx, input.id);
      if (row.status === 'CANCELLED') {
        return { status: 'ok', changed: false, session: row as ValorantSessionSnapshot, game };
      }
      if (row.status === 'COMPLETED' || game?.phase === 'RESOLVED') return { status: 'closed' };
      if (row.creatorId !== input.userId && !input.isAdmin) return { status: 'forbidden' };
      let updatedGame = game;
      if (game && game.phase !== 'ABORTED') {
        updatedGame = await tx.valorantWerewolfGame.update({
          where: { sessionId: input.id },
          data: { phase: 'ABORTED', abortedAt: new Date(), voteEndsAt: null },
        });
      }
      const session = await tx.valorantPickSession.update({
        where: { id: row.id },
        data: { status: 'CANCELLED' },
        include: SESSION_INCLUDE,
      });
      return {
        status: 'ok',
        changed: true,
        session: session as ValorantSessionSnapshot,
        game: updatedGame,
      };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

// ---------------------------------------------------------------------------
// 結果確定後の公開読み取り (RESOLVED のときだけ秘密側を引く)
// ---------------------------------------------------------------------------

export interface WerewolfRevealedResult {
  werewolfUserId: string;
  troll: ValorantTroll | null;
}

/**
 * 結果確定後に限って人狼 ID を返す。確定前は秘密テーブル自体を
 * 引かないため、呼び出し側のミスでも役割が漏れない。
 */
export async function getValorantWerewolfRevealed(
  prisma: PrismaClient,
  guildId: string,
  id: string,
): Promise<WerewolfRevealedResult | null> {
  const game = await prisma.valorantWerewolfGame.findFirst({
    where: { sessionId: id, guildId },
  });
  if (!game || game.phase !== 'RESOLVED') return null;
  const secret = await prisma.valorantWerewolfSecret.findUnique({ where: { sessionId: id } });
  if (!secret) return null;
  return {
    werewolfUserId: secret.werewolfUserId,
    troll: readSecretTroll({
      trollItemId: game.revealedTrollItemId,
      trollText: game.revealedTrollText,
      trollRarity: game.revealedTrollRarity,
      trollCategory: game.revealedTrollCategory,
    }),
  };
}
