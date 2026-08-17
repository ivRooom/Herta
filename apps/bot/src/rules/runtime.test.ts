import { describe, expect, it, vi } from 'vitest';
import type { DiscordRoleOperationRecord, StoredRuleRuntimeRecord } from '@herta/db';
import {
  RULE_ACTION_ROLE_CREATE,
  RULE_ACTION_ROLE_DELETE,
  RULE_CONDITION_UTC_HOUR_IS,
  RULE_TRIGGER_SCHEDULE_MINUTE,
  RuleProductionRuntime,
  deriveRoleCreateIdempotency,
  type RuleRuntimeSecurity,
  type RuleRuntimeStore,
} from './runtime.js';

const GUILD_ID = '12345678901234567';
const ACTOR_ID = '22345678901234567';
const ROLE_ID = '72345678901234567';
const RULE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-17T12:00:00.000Z');

function storedRule(overrides: Partial<StoredRuleRuntimeRecord> = {}): StoredRuleRuntimeRecord {
  return {
    id: RULE_ID,
    guildId: GUILD_ID,
    name: 'Create event role',
    description: null,
    enabled: true,
    priority: 10,
    schemaVersion: 1,
    trigger: { type: RULE_TRIGGER_SCHEDULE_MINUTE, config: { everyMinutes: 1 } },
    conditions: [],
    actions: [{ type: RULE_ACTION_ROLE_CREATE, config: { roleName: 'Event', roleColor: 0 } }],
    cooldownMs: 0,
    maxExecutions: null,
    executionCount: 0,
    createdBy: ACTOR_ID,
    ...overrides,
  };
}

function operation(id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'): DiscordRoleOperationRecord {
  return {
    id,
    guildId: GUILD_ID,
    operation: 'create',
    status: 'pending',
    source: 'rule-engine',
    discordRoleId: null,
    roleName: 'Event',
    roleColor: 0,
    scheduledFor: NOW,
    expiresAfterSeconds: null,
    nextAttemptAt: null,
    attemptCount: 0,
    claimedAt: null,
    completedAt: null,
    lastErrorName: null,
    parentOperationId: null,
    createdBy: ACTOR_ID,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createHarness(input?: {
  rules?: StoredRuleRuntimeRecord[];
  authorized?: boolean;
  canCreate?: boolean;
  canDelete?: boolean;
}) {
  const rules = input?.rules ?? [storedRule()];
  const seen = new Set<string>();
  const enqueueRoleCreate = vi.fn(async () => operation());
  const enqueueRoleDelete = vi.fn(async () => ({ ...operation(), operation: 'delete' as const }));
  const recordExecution = vi.fn(async () => undefined);
  const recordInvalidRule = vi.fn(async () => undefined);
  const reserveExecution = vi.fn(async ({ ruleId, triggerExecutionId }) => {
    const key = `${ruleId}:${triggerExecutionId}`;
    if (seen.has(key)) return { allowed: false as const, reason: 'duplicate-event' as const };
    seen.add(key);
    return { allowed: true as const, executionCount: 1 };
  });
  const store: RuleRuntimeStore = {
    listRules: vi.fn(async (_guildId, triggerType) =>
      rules.filter(
        (rule) =>
          typeof rule.trigger === 'object' &&
          rule.trigger !== null &&
          !Array.isArray(rule.trigger) &&
          (rule.trigger as Record<string, unknown>)['type'] === triggerType,
      ),
    ),
    listGuildIdsWithTrigger: vi.fn(async () => [GUILD_ID]),
    reserveExecution,
    recordExecution,
    recordInvalidRule,
    enqueueRoleCreate,
    enqueueRoleDelete,
  };
  const security: RuleRuntimeSecurity = {
    authorizeRuleActor: vi.fn(async () => input?.authorized ?? true),
    canCreateRole: vi.fn(async () => input?.canCreate ?? true),
    canDeleteRole: vi.fn(async () => input?.canDelete ?? true),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: 'info',
  } as never;
  const runtime = new RuleProductionRuntime({ store, security, logger, now: () => NOW });
  return {
    runtime,
    security,
    enqueueRoleCreate,
    enqueueRoleDelete,
    recordExecution,
    reserveExecution,
  };
}

describe('RuleProductionRuntime', () => {
  it('schedule production triggerからRole create Operationを生成する', async () => {
    const harness = createHarness();
    const minuteEpoch = Math.floor(NOW.getTime() / 60_000);

    await harness.runtime.scanNow(NOW);

    expect(harness.enqueueRoleCreate).toHaveBeenCalledTimes(1);
    expect(harness.enqueueRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: GUILD_ID,
        roleName: 'Event',
        source: 'rule-engine',
        createdBy: ACTOR_ID,
        operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        idempotencyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
    expect(harness.recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerExecutionId: `schedule-minute:${minuteEpoch}`,
        result: expect.objectContaining({ actionsExecuted: true }),
      }),
    );
  });

  it('同一minuteはprocess内で再評価せず、再配送claimでもRoleを重複作成しない', async () => {
    const harness = createHarness();

    await harness.runtime.scanNow(NOW);
    await harness.runtime.scanNow(NOW);
    expect(harness.enqueueRoleCreate).toHaveBeenCalledTimes(1);

    const replay = new RuleProductionRuntime({
      store: {
        listRules: async () => [storedRule()],
        listGuildIdsWithTrigger: async () => [GUILD_ID],
        reserveExecution: harness.reserveExecution,
        recordExecution: harness.recordExecution,
        recordInvalidRule: async () => undefined,
        enqueueRoleCreate: harness.enqueueRoleCreate,
        enqueueRoleDelete: harness.enqueueRoleDelete,
      },
      security: harness.security,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(),
        level: 'info',
      } as never,
      now: () => NOW,
    });
    await replay.scanNow(NOW);

    expect(harness.enqueueRoleCreate).toHaveBeenCalledTimes(1);
    expect(harness.recordExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          actionsExecuted: false,
          actionSkipReason: 'duplicate-event',
        }),
      }),
    );
  });

  it('Condition falseではOperationを生成しない', async () => {
    const harness = createHarness({
      rules: [
        storedRule({
          conditions: [{ type: RULE_CONDITION_UTC_HOUR_IS, config: { hour: 13 } }],
        }),
      ],
    });

    await harness.runtime.scanNow(NOW);

    expect(harness.enqueueRoleCreate).not.toHaveBeenCalled();
    expect(harness.reserveExecution).not.toHaveBeenCalled();
    expect(harness.recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ conditionsMet: false, actionsExecuted: false }),
      }),
    );
  });

  it('Rule creatorがroot authorizationを失っている場合はfail closedする', async () => {
    const harness = createHarness({ authorized: false });

    await harness.runtime.scanNow(NOW);

    expect(harness.enqueueRoleCreate).not.toHaveBeenCalled();
    expect(harness.recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ actionSkipReason: 'authorization-denied' }),
      }),
    );
  });

  it('現在のGuildで削除可能と検証できないRoleはenqueueしない', async () => {
    const harness = createHarness({
      canDelete: false,
      rules: [
        storedRule({ actions: [{ type: RULE_ACTION_ROLE_DELETE, config: { roleId: ROLE_ID } }] }),
      ],
    });

    await harness.runtime.scanNow(NOW);

    expect(harness.enqueueRoleDelete).not.toHaveBeenCalled();
    expect(harness.recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          actionsExecuted: true,
          actionResults: [
            expect.objectContaining({ success: false, error: 'DiscordRoleDeleteNotPermitted' }),
          ],
        }),
      }),
    );
  });

  it('everyMinutesに一致しないscheduleではActionを実行しない', async () => {
    const minuteEpoch = Math.floor(NOW.getTime() / 60_000);
    const harness = createHarness({
      rules: [
        storedRule({
          trigger: {
            type: RULE_TRIGGER_SCHEDULE_MINUTE,
            config: { everyMinutes: 5, offsetMinutes: (minuteEpoch + 1) % 5 },
          },
        }),
      ],
    });

    await harness.runtime.scanNow(NOW);

    expect(harness.enqueueRoleCreate).not.toHaveBeenCalled();
  });
});

describe('deriveRoleCreateIdempotency', () => {
  it('同一execution/actionは同じoperation IDになりpayload変更ではfingerprintだけ変わる', () => {
    const base = {
      ruleId: RULE_ID,
      triggerExecutionId: `schedule-minute:${Math.floor(NOW.getTime() / 60_000)}`,
      actionIndex: 0,
      actionType: RULE_ACTION_ROLE_CREATE,
      roleName: 'Event',
      roleColor: 0,
      expiresAfterSeconds: null,
      scheduledFor: NOW,
    };

    const first = deriveRoleCreateIdempotency(base);
    const replay = deriveRoleCreateIdempotency(base);
    const changedPayload = deriveRoleCreateIdempotency({ ...base, roleName: 'Changed' });

    expect(replay).toEqual(first);
    expect(changedPayload.operationId).toBe(first.operationId);
    expect(changedPayload.fingerprint).not.toBe(first.fingerprint);
  });
});
