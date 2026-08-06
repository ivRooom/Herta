import { describe, expect, it, vi } from 'vitest';
import {
  createModerationCaseFromDetection,
  getModerationCaseForDetection,
} from './detection-case.js';
import type { ModerationPrismaClient, ModerationTransactionClient } from './service.js';

const detectionId = '123e4567-e89b-42d3-a456-426614174000';
const baseSource = {
  id: detectionId,
  guild_id: '100',
  message_id: '200',
  channel_id: '300',
  user_id: '400',
  detection_kind: 'word_contains',
  review_status: 'confirmed',
  case_id: null,
  case_number: null,
};

describe('Moderation detection case', () => {
  it('正検知を非処罰の自動検知ケースとして作成しAudit Logへ記録する', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const query = vi
      .fn()
      .mockResolvedValueOnce([baseSource])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'case-id', case_number: 7 }]);
    const tx = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      auditLog: { create: auditCreate },
    } as unknown as ModerationTransactionClient;
    const prisma = transactionPrisma(tx);

    const result = await createModerationCaseFromDetection(prisma, {
      guildId: '100',
      detectionId,
      actorId: '500',
    });

    expect(result).toEqual({
      detectionId,
      caseId: 'case-id',
      caseNumber: 7,
      created: true,
    });
    const [insertSql, ...insertValues] = query.mock.calls[2] as [string, ...unknown[]];
    expect(insertSql).toContain("'flag'");
    expect(insertSql).toContain("'automatic'");
    expect(insertSql).toContain('origin_detection_id');
    expect(insertValues).toEqual([
      '100',
      '400',
      '500',
      '自動検知（word_contains）を正検知としてケース化しました。メッセージ本文・一致語は保存していません。',
      detectionId,
    ]);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'moderation.detection.case.create',
          targetId: 'case-id',
          actorId: '500',
          metadata: expect.objectContaining({ detectionId, targetUserId: '400' }),
        }),
      }),
    );
  });

  it('同じ検知がケース化済みなら既存ケースを返して再作成しない', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ ...baseSource, case_id: 'existing-case', case_number: 4 }]);
    const tx = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      auditLog: { create: auditCreate },
    } as unknown as ModerationTransactionClient;
    const prisma = transactionPrisma(tx);

    const result = await createModerationCaseFromDetection(prisma, {
      guildId: '100',
      detectionId,
      actorId: '500',
    });

    expect(result).toEqual({
      detectionId,
      caseId: 'existing-case',
      caseNumber: 4,
      created: false,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('未確認・誤検知・無視のイベントはケース化しない', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ ...baseSource, review_status: 'false_positive' }]);
    const tx = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      auditLog: { create: vi.fn() },
    } as unknown as ModerationTransactionClient;
    const prisma = transactionPrisma(tx);

    await expect(
      createModerationCaseFromDetection(prisma, {
        guildId: '100',
        detectionId,
        actorId: '500',
      }),
    ).rejects.toThrow('正検知として保存された自動検知のみケースを作成できます');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('Guild条件付きで作成元とケースリンクを検索する', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ detection_id: detectionId, case_id: 'case-id', case_number: 7 }]);
    const prisma = {
      $queryRawUnsafe: query,
    } as unknown as ModerationPrismaClient;

    await expect(getModerationCaseForDetection(prisma, '100', detectionId)).resolves.toEqual({
      detectionId,
      caseId: 'case-id',
      caseNumber: 7,
    });

    const [sql, ...values] = query.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain('d.guild_id = $1');
    expect(sql).toContain('d.id = $2::uuid');
    expect(values).toEqual(['100', detectionId]);
  });

  it('不正なGuild ID・検知ID・実行者IDを拒否する', async () => {
    const prisma = {} as ModerationPrismaClient;

    await expect(getModerationCaseForDetection(prisma, 'invalid', detectionId)).rejects.toThrow(
      'Guild IDが不正です',
    );
    await expect(getModerationCaseForDetection(prisma, '100', 'invalid')).rejects.toThrow(
      '検知IDが不正です',
    );
    await expect(
      createModerationCaseFromDetection(prisma, {
        guildId: '100',
        detectionId,
        actorId: 'invalid',
      }),
    ).rejects.toThrow('実行者IDが不正です');
  });
});

function transactionPrisma(tx: ModerationTransactionClient): ModerationPrismaClient {
  return {
    $transaction: async <T>(callback: (client: ModerationTransactionClient) => Promise<T>) =>
      callback(tx),
  } as unknown as ModerationPrismaClient;
}
