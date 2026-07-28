import { describe, expect, it, vi } from 'vitest';
import {
  PREPARATION_FAILURE_THROTTLE_SECONDS,
  recordPreparationFailureIfDue,
} from './failure-throttle.js';
import type {
  AutoResponsePrismaClient,
  AutoResponseRuleRecord,
  AutoResponseTransactionClient,
} from './service.js';

const GUILD_ID = '123456789012345678';
const RULE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '111111111111111111';

function rule(): AutoResponseRuleRecord {
  return {
    id: RULE_ID,
    guildId: GUILD_ID,
    triggerType: 'message',
    name: 'Greeting',
    triggerValue: 'hello',
    matchMode: 'partial',
    responseType: 'text',
    responseContent: 'こんにちは',
    channelIds: [],
    roleIds: [],
    cooldownSeconds: 5,
    priority: 0,
    caseSensitive: false,
    enabled: true,
    responseCount: 0,
    failureCount: 0,
    lastTriggeredAt: null,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    createdAt: new Date('2026-07-28T00:00:00Z'),
    updatedAt: new Date('2026-07-28T00:00:00Z'),
  };
}

function mockClient() {
  const tx: AutoResponseTransactionClient = {
    autoResponse: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(rule()),
      delete: vi.fn().mockResolvedValue(rule()),
      findFirst: vi.fn().mockResolvedValue(rule()),
      findMany: vi.fn().mockResolvedValue([rule()]),
      update: vi.fn().mockResolvedValue(rule()),
    },
    autoResponseExecutionEvent: {
      aggregate: vi.fn().mockResolvedValue({ _avg: { durationMs: null } }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222222',
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        status: 'failure',
        durationMs: 2,
        errorName: 'AutoResponseBotPermissionDenied',
        executedAt: new Date(),
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  };
  const client: AutoResponsePrismaClient = {
    ...tx,
    $transaction: async <T>(callback: (value: AutoResponseTransactionClient) => Promise<T>) =>
      callback(tx),
  };
  return { client, tx };
}

describe('Auto Response preparation failure throttle', () => {
  it('初回の送信準備失敗をイベントとカウンターへ記録する', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();

    await expect(
      recordPreparationFailureIfDue(client, {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        durationMs: 2,
        errorName: 'AutoResponseBotPermissionDenied',
        now,
      }),
    ).resolves.toBe(true);

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      GUILD_ID,
    );
    expect(tx.autoResponseExecutionEvent.create).toHaveBeenCalledWith({
      data: {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        status: 'failure',
        durationMs: 2,
        errorName: 'AutoResponseBotPermissionDenied',
        executedAt: now,
      },
    });
    expect(tx.autoResponse.update).toHaveBeenCalledWith({
      where: { id: RULE_ID },
      data: { failureCount: { increment: 1 } },
    });
  });

  it('同種失敗が専用Cooldown内ならDB書き込みを増やさない', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();
    vi.mocked(tx.autoResponseExecutionEvent.findFirst).mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      guildId: GUILD_ID,
      ruleId: RULE_ID,
      status: 'failure',
      durationMs: 2,
      errorName: 'AutoResponseBotPermissionDenied',
      executedAt: new Date(now.getTime() - (PREPARATION_FAILURE_THROTTLE_SECONDS - 1) * 1000),
    });

    await expect(
      recordPreparationFailureIfDue(client, {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        durationMs: 3,
        errorName: 'AutoResponseBotPermissionDenied',
        now,
      }),
    ).resolves.toBe(false);

    expect(tx.autoResponseExecutionEvent.create).not.toHaveBeenCalled();
    expect(tx.autoResponse.update).not.toHaveBeenCalled();
  });
});
