import { describe, expect, it, vi } from 'vitest';
import {
  hasActiveModerationBlacklistEntries,
  listModerationBlacklistEntries,
  setModerationBlacklistEntryActive,
} from './enforcement-service.js';
import type {
  ModerationPrismaClient,
  ModerationTransactionClient,
} from './service.js';

const row = {
  guild_id: '100',
  user_id: '200',
  reason: '重大違反',
  origin_detection_id: null,
  created_by: '300',
  active: true,
  created_at: new Date('2026-08-07T00:00:00Z'),
  updated_at: new Date('2026-08-07T00:00:00Z'),
};

describe('Moderation blacklist service', () => {
  it('一覧取得をGuild IDで必ず絞り込む', async () => {
    const query = vi.fn().mockResolvedValue([row]);
    const prisma = {
      $queryRawUnsafe: query,
    } as unknown as ModerationPrismaClient;

    const result = await listModerationBlacklistEntries(prisma, '100', {
      includeInactive: true,
      limit: 25,
    });

    expect(result).toHaveLength(1);
    const [sql, ...values] = query.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain('WHERE guild_id = $1');
    expect(values).toEqual(['100', true, 25]);
  });

  it('解除操作をtransaction内でGuildとUserに限定しAudit Logへ記録する', async () => {
    const query = vi.fn().mockResolvedValue([{ ...row, active: false }]);
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      auditLog: { create: auditCreate },
    } as unknown as ModerationTransactionClient;
    const transaction = vi.fn(
      async <T>(callback: (client: ModerationTransactionClient) => Promise<T>) => callback(tx),
    );
    const prisma = {
      $transaction: transaction,
    } as unknown as ModerationPrismaClient;

    const result = await setModerationBlacklistEntryActive(prisma, {
      guildId: '100',
      userId: '200',
      active: false,
      actorId: '300',
    });

    expect(result?.active).toBe(false);
    expect(transaction).toHaveBeenCalledTimes(1);
    const [sql, ...values] = query.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain('WHERE guild_id = $1');
    expect(sql).toContain('user_id = $2');
    expect(values).toEqual(['100', '200', false]);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guildId: '100',
          actorId: '300',
          event: 'moderation.blacklist.disable',
          targetId: '200',
        }),
      }),
    );
  });

  it('ブラックリストが空のGuildは短時間キャッシュして連続JOIN照会を抑える', async () => {
    const query = vi.fn().mockResolvedValue([{ exists: false }]);
    const prisma = {
      $queryRawUnsafe: query,
    } as unknown as ModerationPrismaClient;

    const first = await hasActiveModerationBlacklistEntries(prisma, '401');
    const second = await hasActiveModerationBlacklistEntries(prisma, '401');

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, ...values] = query.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain('SELECT EXISTS');
    expect(sql).toContain('WHERE guild_id = $1');
    expect(values).toEqual(['401']);
  });
});
