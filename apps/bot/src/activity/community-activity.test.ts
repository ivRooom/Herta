import type { PrismaClient } from '@herta/db';
import { describe, expect, it } from 'vitest';
import {
  discardGameSessionIfExcluded,
  ensureGameSessionStarted,
  finishGameSession,
  startGameSession,
} from './community-activity.js';

interface GameSessionRow {
  guildId: string;
  userId: string;
  activityName: string;
  startedAt: Date;
}

interface GameDailyKey {
  guildId: string;
  userId: string;
  activityName: string;
  activityDate: Date;
}

/**
 * community_game_sessions / community_game_activity_daily だけを再現する
 * 最小のインメモリPrisma。セッションの開始・破棄・終了加算の相互作用を
 * 実DBなしで検証するために使う。
 */
function createFakePrisma(
  hooks: { onGameSessionFindUnique?: (row: GameSessionRow | null) => void } = {},
) {
  const sessions = new Map<string, GameSessionRow>();
  const daily = new Map<string, bigint>();
  const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;
  const dailyKey = (key: GameDailyKey) =>
    `${key.guildId}:${key.userId}:${key.activityName}:${key.activityDate.toISOString()}`;

  const prisma = {
    communityGameSession: {
      findUnique: async ({
        where,
      }: {
        where: { guildId_userId: { guildId: string; userId: string } };
      }) => {
        const row =
          sessions.get(sessionKey(where.guildId_userId.guildId, where.guildId_userId.userId)) ??
          null;
        hooks.onGameSessionFindUnique?.(row);
        return row;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { guildId_userId: { guildId: string; userId: string } };
        create: GameSessionRow;
        update: { activityName: string; startedAt: Date };
      }) => {
        const key = sessionKey(where.guildId_userId.guildId, where.guildId_userId.userId);
        const existing = sessions.get(key);
        if (existing) {
          existing.activityName = update.activityName;
          existing.startedAt = update.startedAt;
          return existing;
        }
        sessions.set(key, { ...create });
        return create;
      },
      delete: async ({
        where,
      }: {
        where: { guildId_userId: { guildId: string; userId: string } };
      }) => {
        const key = sessionKey(where.guildId_userId.guildId, where.guildId_userId.userId);
        const row = sessions.get(key);
        sessions.delete(key);
        return row;
      },
      deleteMany: async ({
        where,
      }: {
        where: { guildId: string; userId?: string; activityName?: string; startedAt?: Date };
      }) => {
        let count = 0;
        for (const [key, row] of sessions) {
          if (row.guildId !== where.guildId) continue;
          if (where.userId !== undefined && row.userId !== where.userId) continue;
          if (where.activityName !== undefined && row.activityName !== where.activityName) continue;
          if (
            where.startedAt !== undefined &&
            row.startedAt.getTime() !== where.startedAt.getTime()
          )
            continue;
          sessions.delete(key);
          count += 1;
        }
        return { count };
      },
    },
    communityGameActivityDaily: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { guildId_userId_activityName_activityDate: GameDailyKey };
        create: GameDailyKey & { value: bigint };
        update: { value: { increment: bigint } };
      }) => {
        const key = dailyKey(where.guildId_userId_activityName_activityDate);
        const current = daily.get(key);
        if (current === undefined) {
          daily.set(key, create.value);
          return { ...create };
        }
        const next = current + update.value.increment;
        daily.set(key, next);
        return { value: next };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<number>) => fn(prisma),
  };

  return { prisma: prisma as unknown as PrismaClient, sessions, daily };
}

const GUILD_ID = '100000000000000001';
const USER_ID = '200000000000000002';
// 2026-11-23 10:00 JST (同一JST日内に収まる時刻だけを使う)
const T0 = new Date('2026-11-23T01:00:00.000Z');

function dailySeconds(daily: Map<string, bigint>, activityName: string): number {
  let total = 0;
  for (const [key, value] of daily) {
    if (key.includes(`:${activityName}:`)) total += Number(value);
  }
  return total;
}

describe('ゲームセッションと除外リストの照合 (#980)', () => {
  it('除外リスト追加後に残ったセッションは加算されず、現在のゲームだけが計測される', async () => {
    const { prisma, daily } = createFakePrisma();
    // 除外される前: [Tracker, Game] のうちTrackerが計測対象でセッション開始
    await startGameSession(prisma, GUILD_ID, USER_ID, 'Valorant Tracker App', T0);
    // 設定変更でTrackerが除外リストへ追加された後のPresenceUpdateを模す:
    // 旧・新presenceは両方ともVALORANTへ解決され差分なしになるが、
    // 保存済みセッションは現在の除外リストと照合して破棄する
    const discarded = await discardGameSessionIfExcluded(prisma, GUILD_ID, USER_ID, [
      'Valorant Tracker App',
    ]);
    expect(discarded).toBe(true);
    // 破棄後に現在のゲームのセッションを開始する(bot.tsの後続処理)
    const t1 = new Date(T0.getTime() + 600_000);
    await startGameSession(prisma, GUILD_ID, USER_ID, 'VALORANT', t1);
    // ゲーム終了: VALORANTの分だけが加算され、Trackerは加算されない
    const t2 = new Date(T0.getTime() + 3_600_000);
    await expect(finishGameSession(prisma, GUILD_ID, USER_ID, t2)).resolves.toBe(3_000);
    expect(dailySeconds(daily, 'VALORANT')).toBe(3_000);
    expect(dailySeconds(daily, 'Valorant Tracker App')).toBe(0);
  });

  it('計測対象ゲームが残っていない場合も除外セッションは加算されずに破棄される', async () => {
    const { prisma, daily } = createFakePrisma();
    await startGameSession(prisma, GUILD_ID, USER_ID, 'Valorant Tracker App', T0);
    await expect(
      discardGameSessionIfExcluded(prisma, GUILD_ID, USER_ID, ['Valorant Tracker App']),
    ).resolves.toBe(true);
    const t1 = new Date(T0.getTime() + 3_600_000);
    await expect(finishGameSession(prisma, GUILD_ID, USER_ID, t1)).resolves.toBe(0);
    expect(daily.size).toBe(0);
  });

  it('除外対象でないセッションは破棄されずstartedAtが保持される', async () => {
    const { prisma, sessions, daily } = createFakePrisma();
    await startGameSession(prisma, GUILD_ID, USER_ID, 'VALORANT', T0);
    await expect(
      discardGameSessionIfExcluded(prisma, GUILD_ID, USER_ID, ['Valorant Tracker App']),
    ).resolves.toBe(false);
    expect(sessions.get(`${GUILD_ID}:${USER_ID}`)?.startedAt).toEqual(T0);
    const t1 = new Date(T0.getTime() + 3_600_000);
    await expect(finishGameSession(prisma, GUILD_ID, USER_ID, t1)).resolves.toBe(3_600);
    expect(dailySeconds(daily, 'VALORANT')).toBe(3_600);
  });

  it('セッションが無い場合と除外リストが空の場合は何もしない', async () => {
    const { prisma } = createFakePrisma();
    await expect(
      discardGameSessionIfExcluded(prisma, GUILD_ID, USER_ID, ['Valorant Tracker App']),
    ).resolves.toBe(false);
    await startGameSession(prisma, GUILD_ID, USER_ID, 'Valorant Tracker App', T0);
    await expect(discardGameSessionIfExcluded(prisma, GUILD_ID, USER_ID, [])).resolves.toBe(false);
  });

  it('除外判定はセッション名の大文字小文字と前後空白を区別しない', async () => {
    const { prisma } = createFakePrisma();
    await startGameSession(prisma, GUILD_ID, USER_ID, 'valorant tracker app', T0);
    await expect(
      discardGameSessionIfExcluded(prisma, GUILD_ID, USER_ID, [' Valorant Tracker App ']),
    ).resolves.toBe(true);
  });

  it('読み取り後に並行処理が差し替えた新しいセッションは削除しない', async () => {
    let swapped = false;
    const { prisma, sessions } = createFakePrisma({
      onGameSessionFindUnique: (row) => {
        if (!row || swapped) return;
        swapped = true;
        // 読み取りと削除の間に、並行するPresenceUpdateが新しい
        // セッションへ差し替えた状況を模す
        sessions.set(`${GUILD_ID}:${USER_ID}`, {
          guildId: GUILD_ID,
          userId: USER_ID,
          activityName: 'VALORANT',
          startedAt: new Date(T0.getTime() + 60_000),
        });
      },
    });
    await startGameSession(prisma, GUILD_ID, USER_ID, 'Valorant Tracker App', T0);
    await expect(
      discardGameSessionIfExcluded(prisma, GUILD_ID, USER_ID, ['Valorant Tracker App']),
    ).resolves.toBe(false);
    expect(sessions.get(`${GUILD_ID}:${USER_ID}`)?.activityName).toBe('VALORANT');
  });

  it('セッションが無い場合だけensureGameSessionStartedが開始し、既存は保持する', async () => {
    const { prisma, sessions } = createFakePrisma();
    // セッション無し: 開始される
    await expect(ensureGameSessionStarted(prisma, GUILD_ID, USER_ID, 'VALORANT', T0)).resolves.toBe(
      true,
    );
    expect(sessions.get(`${GUILD_ID}:${USER_ID}`)?.startedAt).toEqual(T0);
    // 同名の既存セッション: startedAtが保持される
    const later = new Date(T0.getTime() + 600_000);
    await expect(
      ensureGameSessionStarted(prisma, GUILD_ID, USER_ID, 'VALORANT', later),
    ).resolves.toBe(false);
    expect(sessions.get(`${GUILD_ID}:${USER_ID}`)?.startedAt).toEqual(T0);
    // 別名の既存セッションにも触れない
    await expect(
      ensureGameSessionStarted(prisma, GUILD_ID, USER_ID, 'Overwatch', later),
    ).resolves.toBe(false);
    expect(sessions.get(`${GUILD_ID}:${USER_ID}`)?.activityName).toBe('VALORANT');
  });
});
