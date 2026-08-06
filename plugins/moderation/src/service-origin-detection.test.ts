import { describe, expect, it, vi } from 'vitest';
import { createModerationCase } from './service.js';
import type { ModerationPrismaClient, ModerationTransactionClient } from './service.js';

const detectionId = '123e4567-e89b-42d3-a456-426614174000';

describe('Moderation Case origin detection', () => {
  it('別Guildまたは存在しない元検知をケースへ関連付けない', async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      auditLog: { create: auditCreate },
    } as unknown as ModerationTransactionClient;
    const prisma = {
      $transaction: async <T>(callback: (client: ModerationTransactionClient) => Promise<T>) =>
        callback(tx),
    } as unknown as ModerationPrismaClient;

    await expect(
      createModerationCase(prisma, {
        guildId: '100',
        action: 'flag',
        targetUserId: '200',
        moderatorUserId: '300',
        reason: '検証用',
        source: 'automatic',
        originDetectionId: detectionId,
      }),
    ).rejects.toThrow('元検知がGuild内に見つかりません');

    const [lookupSql, ...lookupValues] = query.mock.calls[1] as [string, ...unknown[]];
    expect(lookupSql).toContain('WHERE guild_id = $1');
    expect(lookupSql).toContain('id = $2::uuid');
    expect(lookupValues).toEqual(['100', detectionId]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
