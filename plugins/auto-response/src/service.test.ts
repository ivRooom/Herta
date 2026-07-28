import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTO_RESPONSE_CONFIG, AutoResponseValidationError } from './config.js';
import {
  claimAutoResponseRule,
  createAutoResponseRule,
  listAutoResponseRules,
  type AutoResponsePrismaClient,
  type AutoResponseRuleRecord,
  type AutoResponseTransactionClient,
} from './service.js';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD_ID = '987654321098765432';
const USER_ID = '111111111111111111';
const RULE_ID = '11111111-1111-4111-8111-111111111111';

function rule(overrides: Partial<AutoResponseRuleRecord> = {}): AutoResponseRuleRecord {
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
    ...overrides,
  };
}

function mockClient(overrides: Partial<AutoResponseTransactionClient> = {}) {
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
        status: 'success',
        durationMs: 1,
        errorName: null,
        executedAt: new Date(),
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const client: AutoResponsePrismaClient = {
    ...tx,
    $transaction: async <T>(callback: (value: AutoResponseTransactionClient) => Promise<T>) =>
      callback(tx),
  };
  return { client, tx };
}

describe('Auto Response Guild isolation', () => {
  it('一覧条件へ必ずGuild IDを含める', async () => {
    const { client, tx } = mockClient();
    await listAutoResponseRules(client, { guildId: GUILD_ID, search: 'hello' });

    expect(tx.autoResponse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ guildId: GUILD_ID }),
      }),
    );
    expect(tx.autoResponse.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ guildId: GUILD_ID }),
      }),
    );
  });

  it('別Guild IDで作成したルールを混在させない', async () => {
    const { client, tx } = mockClient();
    await createAutoResponseRule(client, {
      guildId: OTHER_GUILD_ID,
      actorId: USER_ID,
      source: 'dashboard',
      config: DEFAULT_AUTO_RESPONSE_CONFIG,
      rule: {
        name: 'Other guild',
        triggerValue: 'hello',
        matchMode: 'partial',
        responseType: 'text',
        responseContent: 'world',
      },
    });

    expect(tx.autoResponse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ guildId: OTHER_GUILD_ID }),
      }),
    );
  });
});

describe('Auto Response cooldown', () => {
  it('Rule Cooldown中は実行権を取得しない', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();
    vi.mocked(tx.autoResponse.findFirst).mockResolvedValue(
      rule({ lastTriggeredAt: new Date(now.getTime() - 2_000), cooldownSeconds: 5 }),
    );

    await expect(
      claimAutoResponseRule(client, {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        guildCooldownSeconds: 0,
        now,
      }),
    ).resolves.toBe(false);
    expect(tx.autoResponse.update).not.toHaveBeenCalled();
  });

  it('Guild Cooldown中は別Ruleでも実行権を取得しない', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();
    vi.mocked(tx.autoResponseExecutionEvent.findFirst).mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      guildId: GUILD_ID,
      ruleId: RULE_ID,
      status: 'success',
      durationMs: 2,
      errorName: null,
      executedAt: new Date(now.getTime() - 500),
    });

    await expect(
      claimAutoResponseRule(client, {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        guildCooldownSeconds: 1,
        now,
      }),
    ).resolves.toBe(false);
    expect(tx.autoResponse.update).not.toHaveBeenCalled();
  });

  it('Cooldown外ではlastTriggeredAtを更新して実行権を取得する', async () => {
    const now = new Date('2026-07-28T10:00:00Z');
    const { client, tx } = mockClient();

    await expect(
      claimAutoResponseRule(client, {
        guildId: GUILD_ID,
        ruleId: RULE_ID,
        guildCooldownSeconds: 1,
        now,
      }),
    ).resolves.toBe(true);
    expect(tx.autoResponse.update).toHaveBeenCalledWith({
      where: { id: RULE_ID },
      data: { lastTriggeredAt: now },
    });
  });
});

describe('Auto Response rule limit', () => {
  it('Guildのルール上限を超えた作成を拒否する', async () => {
    const { client, tx } = mockClient();
    vi.mocked(tx.autoResponse.count).mockResolvedValue(DEFAULT_AUTO_RESPONSE_CONFIG.maxRules);

    await expect(
      createAutoResponseRule(client, {
        guildId: GUILD_ID,
        actorId: USER_ID,
        source: 'dashboard',
        config: DEFAULT_AUTO_RESPONSE_CONFIG,
        rule: {
          name: 'Limit',
          triggerValue: 'hello',
          matchMode: 'partial',
          responseType: 'text',
          responseContent: 'world',
        },
      }),
    ).rejects.toBeInstanceOf(AutoResponseValidationError);
  });
});
