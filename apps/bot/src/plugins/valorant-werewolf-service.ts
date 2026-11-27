import type { PrismaClient } from '@herta/db';
import {
  drawValorantWerewolfTroll,
  type ValorantTrollApiConfig,
  type ValorantTrollRarityFilter,
} from './valorant-troll-gacha.js';
import { WEREWOLF_SECRET_CATEGORIES, type WerewolfRosterEntry } from './valorant-werewolf-core.js';
import {
  beginValorantWerewolfPunishmentRetry,
  closeValorantWerewolfRound,
  completeValorantWerewolfAssignment,
  completeValorantWerewolfPunishment,
  failValorantWerewolfAssignment,
  failValorantWerewolfPunishment,
  getValorantWerewolfState,
  parseWerewolfRoster,
  startValorantWerewolfGame,
  type WerewolfCloseReason,
  type WerewolfGameRow,
} from './valorant-werewolf-repository.js';
import type { ValorantSessionSnapshot } from './valorant-session-repository.js';

/**
 * VALORANT 人狼モード (#1049) のドメインサービス。
 *
 * repository の行ロック mutation と S1 Bot API の抽選を orchestration
 * する。外部 API 呼び出しは DB transaction の外で行い、結果だけを
 * 確定 mutation へ渡す。
 *
 * 失敗方針:
 * - 秘密抽選は fail-closed。失敗時は game を ASSIGNING のまま残し、
 *   同じ人狼・同じ冪等キーで開始リトライできる。
 * - 罰ゲーム抽選は fail-soft。失敗しても勝敗は確定・公開し、状態は
 *   UNAVAILABLE と明示して結果公開後のリトライを残す。
 * - ログへ人狼 ID・縛り文・API 応答本文は出さない (分類コードのみ)。
 */

interface WerewolfServiceLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface WerewolfServiceOptions {
  fetcher?: typeof fetch;
  logger?: WerewolfServiceLogger;
}

export type WerewolfStartServiceResult =
  | { status: 'ok'; session: ValorantSessionSnapshot; game: WerewolfGameRow }
  | {
      status: 'assignment_failed';
      code: string;
      session: ValorantSessionSnapshot;
      game: WerewolfGameRow;
    }
  | { status: 'missing' | 'closed' | 'forbidden' | 'insufficient' | 'not_werewolf' | 'invalid' };

export async function startValorantWerewolf(
  prisma: PrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    userId: string;
    isAdmin: boolean;
    displayNames: ReadonlyMap<string, string>;
    apiConfig: ValorantTrollApiConfig | null;
    rarityFilter: ValorantTrollRarityFilter;
    pickWerewolf?: (roster: readonly WerewolfRosterEntry[]) => string | null;
  },
  options: WerewolfServiceOptions = {},
): Promise<WerewolfStartServiceResult> {
  const started = await startValorantWerewolfGame(prisma, {
    guildId: input.guildId,
    id: input.sessionId,
    userId: input.userId,
    isAdmin: input.isAdmin,
    displayNames: input.displayNames,
    pickWerewolf: input.pickWerewolf,
  });
  if (started.status !== 'ok') return started;
  if (started.game.assignmentStatus === 'READY') {
    return { status: 'ok', session: started.session, game: started.game };
  }
  const fail = async (code: string, invalidResponse = false) => {
    const recorded = await failValorantWerewolfAssignment(prisma, {
      guildId: input.guildId,
      id: input.sessionId,
      errorCode: code,
      invalidResponse,
    });
    if (recorded.status !== 'ok') return { status: 'closed' as const };
    return {
      status: 'assignment_failed' as const,
      code,
      session: recorded.session,
      game: recorded.game,
    };
  };
  if (!input.apiConfig) {
    options.logger?.warn(
      { guildId: input.guildId, sessionId: input.sessionId, code: 'not_configured' },
      'VALORANT人狼の秘密抽選が未設定のため開始を保留',
    );
    return fail('not_configured');
  }
  const drawn = await drawValorantWerewolfTroll(
    input.apiConfig,
    {
      purpose: 'secret',
      operatorDiscordUserId: input.userId,
      guildId: input.guildId,
      sessionId: input.sessionId,
      participant: {
        discordUserId: started.werewolf.userId,
        name: started.werewolf.displayName,
      },
      rarityFilter: input.rarityFilter,
    },
    WEREWOLF_SECRET_CATEGORIES,
    options.fetcher,
  );
  if (drawn.status === 'invalid_response') {
    options.logger?.warn(
      { guildId: input.guildId, sessionId: input.sessionId, code: 'invalid_response' },
      'VALORANT人狼の秘密抽選応答が不正のため開始を保留',
    );
    return fail('invalid_response', true);
  }
  if (drawn.status === 'unavailable') {
    const code = drawn.code ?? (drawn.httpStatus > 0 ? `http_${drawn.httpStatus}` : 'network');
    options.logger?.warn(
      { guildId: input.guildId, sessionId: input.sessionId, code, httpStatus: drawn.httpStatus },
      'VALORANT人狼の秘密抽選に失敗、開始を保留',
    );
    return fail(code);
  }
  const completed = await completeValorantWerewolfAssignment(prisma, {
    guildId: input.guildId,
    id: input.sessionId,
    drawId: drawn.drawId,
    troll: drawn.troll,
  });
  if (completed.status !== 'ok') return { status: 'closed' };
  return { status: 'ok', session: completed.session, game: completed.game };
}

export type WerewolfSettleResult =
  | { status: 'ok'; session: ValorantSessionSnapshot; game: WerewolfGameRow }
  | { status: 'missing' | 'closed' | 'wrong_phase' | 'not_pending' };

/**
 * 罰ゲーム抽選を引き、結果確定 (または失敗のまま確定) まで進める。
 * RESOLVING で対象者が PENDING の game が前提。冪等キーは対象者と
 * セッションで固定されるため、リトライでも同じ罰ゲームになる。
 */
export async function settleValorantWerewolfPunishment(
  prisma: PrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    operatorId: string;
    apiConfig: ValorantTrollApiConfig | null;
  },
  options: WerewolfServiceOptions = {},
): Promise<WerewolfSettleResult> {
  const state = await getValorantWerewolfState(prisma, input.guildId, input.sessionId);
  if (!state || !state.game) return { status: 'missing' };
  const game = state.game;
  if (game.punishmentStatus !== 'PENDING' || !game.punishmentUserId)
    return { status: 'not_pending' };
  const roster = parseWerewolfRoster(game.rosterSnapshot);
  const target = roster.find((entry) => entry.userId === game.punishmentUserId);
  if (!target) return { status: 'wrong_phase' };
  const fail = async (code: string) => {
    const recorded = await failValorantWerewolfPunishment(prisma, {
      guildId: input.guildId,
      id: input.sessionId,
      errorCode: code,
    });
    if (recorded.status !== 'ok') return { status: recorded.status };
    return { status: 'ok' as const, session: recorded.session, game: recorded.game };
  };
  if (!input.apiConfig) {
    options.logger?.warn(
      { guildId: input.guildId, sessionId: input.sessionId, code: 'not_configured' },
      'VALORANT人狼の罰ゲーム抽選が未設定のため未実施で確定',
    );
    return fail('not_configured');
  }
  const drawn = await drawValorantWerewolfTroll(
    input.apiConfig,
    {
      purpose: 'punishment',
      operatorDiscordUserId: input.operatorId,
      guildId: input.guildId,
      sessionId: input.sessionId,
      participant: { discordUserId: target.userId, name: target.displayName },
      // 罰ゲームはカテゴリ内で all 固定 (Guild フィルターを継承しない)
      rarityFilter: 'all',
    },
    WEREWOLF_SECRET_CATEGORIES,
    options.fetcher,
  );
  if (drawn.status !== 'ok') {
    const code =
      drawn.status === 'invalid_response'
        ? 'invalid_response'
        : (drawn.code ?? (drawn.httpStatus > 0 ? `http_${drawn.httpStatus}` : 'network'));
    options.logger?.warn(
      { guildId: input.guildId, sessionId: input.sessionId, code },
      'VALORANT人狼の罰ゲーム抽選に失敗、未実施で確定',
    );
    return fail(code);
  }
  const completed = await completeValorantWerewolfPunishment(prisma, {
    guildId: input.guildId,
    id: input.sessionId,
    drawId: drawn.drawId,
    troll: drawn.troll,
  });
  if (completed.status !== 'ok') return { status: completed.status };
  return { status: 'ok', session: completed.session, game: completed.game };
}

export type WerewolfCloseServiceResult =
  | {
      status: 'ok';
      kind: 'runoff' | 'resolved' | 'no_votes';
      session: ValorantSessionSnapshot;
      game: WerewolfGameRow;
    }
  | { status: 'missing' | 'forbidden' | 'wrong_phase' | 'closed' };

/** 締切 mutation のあと、必要なら罰ゲーム抽選まで一気に進める */
export async function closeValorantWerewolfRoundAndSettle(
  prisma: PrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    userId: string;
    isAdmin: boolean;
    reason: WerewolfCloseReason;
    apiConfig: ValorantTrollApiConfig | null;
  },
  options: WerewolfServiceOptions = {},
): Promise<WerewolfCloseServiceResult> {
  const closed = await closeValorantWerewolfRound(prisma, {
    guildId: input.guildId,
    id: input.sessionId,
    userId: input.userId,
    isAdmin: input.isAdmin,
    reason: input.reason,
  });
  if (closed.status !== 'ok') return closed;
  if (closed.kind === 'runoff') {
    return { status: 'ok', kind: 'runoff', session: closed.session, game: closed.game };
  }
  if (closed.kind === 'no_votes') {
    return { status: 'ok', kind: 'no_votes', session: closed.session, game: closed.game };
  }
  const settled = await settleValorantWerewolfPunishment(
    prisma,
    {
      guildId: input.guildId,
      sessionId: input.sessionId,
      operatorId: input.userId,
      apiConfig: input.apiConfig,
    },
    options,
  );
  if (settled.status === 'not_pending') {
    // 対象者がいない等で罰ゲームが引けない場合も結果確定は止めない
    const finalized = await failValorantWerewolfPunishment(prisma, {
      guildId: input.guildId,
      id: input.sessionId,
      errorCode: 'no_target',
    });
    if (finalized.status !== 'ok') return { status: 'closed' };
    return { status: 'ok', kind: 'resolved', session: finalized.session, game: finalized.game };
  }
  if (settled.status !== 'ok') return { status: 'closed' };
  return { status: 'ok', kind: 'resolved', session: settled.session, game: settled.game };
}

/** 結果公開後の罰ゲームリトライ: 権限確認つきで再開し、同じキーで引く */
export async function retryValorantWerewolfPunishment(
  prisma: PrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    userId: string;
    isAdmin: boolean;
    apiConfig: ValorantTrollApiConfig | null;
  },
  options: WerewolfServiceOptions = {},
): Promise<WerewolfSettleResult | { status: 'forbidden' }> {
  const begun = await beginValorantWerewolfPunishmentRetry(prisma, {
    guildId: input.guildId,
    id: input.sessionId,
    userId: input.userId,
    isAdmin: input.isAdmin,
  });
  if (begun.status !== 'ok') return begun;
  return settleValorantWerewolfPunishment(
    prisma,
    {
      guildId: input.guildId,
      sessionId: input.sessionId,
      operatorId: input.userId,
      apiConfig: input.apiConfig,
    },
    options,
  );
}
