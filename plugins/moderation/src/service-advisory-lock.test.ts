import { describe, expect, it, vi } from 'vitest';
import { createModerationCase } from './service.js';
import type { ModerationPrismaClient, ModerationTransactionClient } from './service.js';

const createdAt = new Date('2026-08-07T00:00:00.000Z');
const updatedAt = new Date('2026-08-07T00:00:00.000Z');

describe('Moderation Case advisory lock', () => {
  it('ケース採番ロックをquery結果として読み取らない', async () => {
    const execute = vi.fn().mockResolvedValue(0);
    const query = vi.fn().mockResolvedValueOnce([
      {
        id: 'case-id',
        guild_id: '100',
        case_number: 2,
        action: 'warn',
        target_user_id: '200',
        moderator_user_id: '300',
        reason: '検証用',
        status: 'active',
        duration_seconds: null,
        expires_at: null,
        discord_action_id: null,
        source: 'dashboard',
        origin_detection_id: null,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ]);
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: execute,
      auditLog: { create: auditCreate },
    } as unknown as ModerationTransactionClient;
    const prisma = {
      $transaction: async <T>(callback: (client: ModerationTransactionClient) => Promise<T>) =>
        callback(tx),
    } as unknown as ModerationPrismaClient;

    const result = await createModerationCase(prisma, {
      guildId: '100',
      action: 'warn',
      targetUserId: '200',
      moderatorUserId: '300',
      reason: '検証用',
      source: 'dashboard',
    });

    expect(execute).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      '100',
    );
    expect(query).not.toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      '100',
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.caseNumber).toBe(2);
    expect(result.action).toBe('warn');
    expect(result.source).toBe('dashboard');
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
});
