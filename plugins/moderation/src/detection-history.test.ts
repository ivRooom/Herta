import { describe, expect, it, vi } from 'vitest';
import {
  createModerationDetectionIdempotencyKey,
  recordModerationDetection,
  reviewModerationDetection,
} from './detection-history.js';
import type { ModerationPrismaClient, ModerationTransactionClient } from './service.js';

const baseFinding = {
  kind: 'word_contains' as const,
  messageLength: 24,
  observedCount: 2,
  threshold: 2,
  ruleIndex: 3,
};

const baseInput = {
  guildId: '100',
  messageId: '200',
  channelId: '300',
  userId: '400',
  finding: baseFinding,
  occurredAt: new Date('2026-08-06T07:00:00.000Z'),
};

describe('Moderation detection history', () => {
  it('本文を使わずに安定したidempotency keyを生成する', () => {
    expect(createModerationDetectionIdempotencyKey(baseInput)).toBe(
      '100:200:word_contains:3',
    );
  });

  it('最小メタデータだけをINSERTし重複を無視する', async () => {
    const execute = vi.fn().mockResolvedValue(1);
    const prisma = {
      $executeRawUnsafe: execute,
    } as unknown as ModerationPrismaClient;

    await expect(recordModerationDetection(prisma, baseInput)).resolves.toBe(true);

    const [sql, ...values] = execute.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(sql).not.toMatch(/content|pattern|matched|invite_code/i);
    expect(values).toEqual([
      '100',
      '200',
      '300',
      '400',
      'word_contains',
      24,
      2,
      2,
      3,
      '100:200:word_contains:3',
      baseInput.occurredAt,
    ]);
  });

  it('同一イベントが既存の場合はfalseを返す', async () => {
    const prisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    } as unknown as ModerationPrismaClient;

    await expect(recordModerationDetection(prisma, baseInput)).resolves.toBe(false);
  });

  it('レビュー更新とAudit Logを同じtransactionで記録する', async () => {
    const row = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      guild_id: '100',
      message_id: '200',
      channel_id: '300',
      user_id: '400',
      detection_kind: 'word_contains',
      mode: 'observe',
      message_length: 24,
      observed_count: 2,
      threshold: 2,
      rule_index: 3,
      review_status: 'unreviewed',
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      occurred_at: new Date('2026-08-06T07:00:00.000Z'),
      created_at: new Date('2026-08-06T07:00:01.000Z'),
      updated_at: new Date('2026-08-06T07:00:01.000Z'),
    };
    const updated = {
      ...row,
      review_status: 'false_positive',
      reviewed_by: '500',
      reviewed_at: new Date('2026-08-06T07:05:00.000Z'),
      review_note: '許可済みの文脈',
    };
    const auditCreate = vi.fn().mockResolvedValue({});
    const query = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([updated]);
    const tx = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      auditLog: { create: auditCreate },
    } as unknown as ModerationTransactionClient;
    const prisma = {
      $transaction: async <T>(callback: (client: ModerationTransactionClient) => Promise<T>) =>
        callback(tx),
    } as unknown as ModerationPrismaClient;

    const result = await reviewModerationDetection(prisma, {
      guildId: '100',
      detectionId: row.id,
      actorId: '500',
      reviewStatus: 'false_positive',
      reviewNote: ' 許可済みの文脈 ',
    });

    expect(result?.reviewStatus).toBe('false_positive');
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'moderation.detection.review',
          targetId: row.id,
          actorId: '500',
        }),
      }),
    );
  });

  it('不正なDiscord IDとレビュー状態を拒否する', async () => {
    const prisma = {} as ModerationPrismaClient;

    await expect(
      recordModerationDetection(prisma, { ...baseInput, guildId: 'invalid' }),
    ).rejects.toThrow('Guild IDが不正です');
    await expect(
      reviewModerationDetection(prisma, {
        guildId: '100',
        detectionId: '123e4567-e89b-42d3-a456-426614174000',
        actorId: '500',
        reviewStatus: 'invalid' as never,
      }),
    ).rejects.toThrow('レビュー状態が不正です');
  });
});
