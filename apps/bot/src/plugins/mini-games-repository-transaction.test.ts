import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { incrementMiniGameMetrics } from './mini-games-repository.js';

describe('Mini Games metric transaction', () => {
  it('1つのゲーム結果に属する複数カウンタを1transactionへまとめる', async () => {
    const executeRaw = vi.fn(async () => 1);
    const transaction = vi.fn(async (operations: readonly Promise<unknown>[]) =>
      Promise.all(operations),
    );
    const prisma = { $executeRaw: executeRaw, $transaction: transaction } as unknown as PrismaClient;

    await incrementMiniGameMetrics(
      prisma,
      'guild-1',
      'user-1',
      [
        ['minigame_plays', 1],
        ['coinflip_plays', 1],
        ['coinflip_wins', 1],
        ['minigame_wins', 1],
      ],
      new Date('2026-08-13T00:00:00.000Z'),
    );

    expect(executeRaw).toHaveBeenCalledTimes(4);
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it('0以下の更新はtransaction対象から除外する', async () => {
    const executeRaw = vi.fn(async () => 1);
    const transaction = vi.fn(async (operations: readonly Promise<unknown>[]) =>
      Promise.all(operations),
    );
    const prisma = { $executeRaw: executeRaw, $transaction: transaction } as unknown as PrismaClient;

    await incrementMiniGameMetrics(prisma, 'guild-1', 'user-1', [
      ['minigame_plays', 1],
      ['minigame_wins', 0],
      ['coinflip_wins', -1],
    ]);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[0]).toHaveLength(1);
  });
});
