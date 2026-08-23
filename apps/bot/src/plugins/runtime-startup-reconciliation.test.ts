import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import {
  createStartupRecoveryAuditData,
  reconcilePluginRuntimeStartup,
  reconcilePluginRuntimeStartupOnceWith,
  resetPluginRuntimeStartupReconciliation,
  selectPluginRuntimeRecoveryCandidates,
  startupRuntimeAuditGraceMs,
  type PluginRuntimeStartupAuditRow,
  type PluginRuntimeStartupTarget,
} from './runtime-startup-reconciliation.js';
import { PluginRuntimeState } from './runtime-state.js';

const guildId = 'guild-a';
const target: PluginRuntimeStartupTarget = {
  pluginId: 'quote',
  enabled: true,
  configVersion: 4,
};

function audit(
  event: string,
  configVersion: number,
  createdAt = '2026-08-23T06:00:00.000Z',
  eventId?: string,
): PluginRuntimeStartupAuditRow {
  return {
    targetId: 'quote',
    event,
    metadata: { configVersion, ...(eventId ? { eventId } : {}) },
    createdAt: new Date(createdAt),
  };
}

function loadedState(enabled = true, version = 4): PluginRuntimeState {
  const state = new PluginRuntimeState();
  state.markConfigurationLoaded(guildId);
  if (enabled) state.markActive(guildId, 'quote', version);
  return state;
}

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('Plugin Runtime startup reconciliation', () => {
  it.each([
    'plugin.runtime_publish_succeeded',
    'plugin.runtime_publish_failed',
    'plugin.runtime_apply_failed',
  ])('current versionの未解決状態 %s を正常load後にrecovery対象へする', (event) => {
    const candidates = selectPluginRuntimeRecoveryCandidates(
      guildId,
      [target],
      [audit(event, 4)],
      loadedState(),
    );

    expect(candidates).toEqual([
      expect.objectContaining({ pluginId: 'quote', configVersion: 4, enabled: true }),
    ]);
  });

  it('recovery候補へ元Runtime eventIdを引き継ぐ', () => {
    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [target],
        [audit('plugin.runtime_apply_failed', 4, undefined, 'runtime-event-4')],
        loadedState(),
      ),
    ).toEqual([
      expect.objectContaining({
        pluginId: 'quote',
        configVersion: 4,
        eventId: 'runtime-event-4',
      }),
    ]);
  });

  it('既にapply成功済みのcurrent versionへ重複recovery ACKを出さない', () => {
    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [target],
        [audit('plugin.runtime_apply_succeeded', 4)],
        loadedState(),
      ),
    ).toEqual([]);
  });

  it('enabled Pluginがprovider skip等でactiveでなければrecovery ACKを出さない', () => {
    const state = new PluginRuntimeState();
    state.markConfigurationLoaded(guildId);

    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [target],
        [audit('plugin.runtime_apply_failed', 4)],
        state,
      ),
    ).toEqual([]);
  });

  it('disabled current stateはfresh load後にinactiveの場合だけrecovery対象へする', () => {
    const disabledTarget = { ...target, enabled: false };
    const inactive = loadedState(false);
    const active = loadedState(true);

    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [disabledTarget],
        [audit('plugin.runtime_publish_failed', 4)],
        inactive,
      ),
    ).toHaveLength(1);
    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [disabledTarget],
        [audit('plugin.runtime_publish_failed', 4)],
        active,
      ),
    ).toEqual([]);
  });

  it('stale configVersionのfailureをcurrent versionへ引き継がない', () => {
    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [target],
        [audit('plugin.runtime_apply_failed', 3)],
        loadedState(),
      ),
    ).toEqual([]);
  });

  it('DB設定load完了前はinactiveでもdisable recovery ACKを出さない', () => {
    const state = new PluginRuntimeState();
    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [{ ...target, enabled: false }],
        [audit('plugin.runtime_apply_failed', 4)],
        state,
      ),
    ).toEqual([]);
  });

  it('直近更新でcurrent Auditがまだ無い場合だけpublish確定graceを取る', () => {
    const updatedAt = new Date('2026-08-23T06:00:00.000Z');
    const recentTarget = { ...target, updatedAt };

    expect(startupRuntimeAuditGraceMs([recentTarget], [], updatedAt.getTime())).toBe(7_000);
    expect(
      startupRuntimeAuditGraceMs(
        [recentTarget],
        [audit('plugin.runtime_publish_failed', 4)],
        updatedAt.getTime(),
      ),
    ).toBe(0);
    expect(startupRuntimeAuditGraceMs([recentTarget], [], updatedAt.getTime() + 7_001)).toBe(0);
  });

  it('startupとpublish監査が競合した場合はgrace後に再照会してfailureをrecoveryする', async () => {
    const previousDatabaseUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = 'postgresql://test.invalid/herta';
    const updatedAt = new Date('2026-08-23T06:00:00.000Z');
    const recentTarget = { ...target, updatedAt };
    const wait = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({ id: 'recovery-audit' }));
    const findAuditRows = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        audit('plugin.runtime_publish_failed', 4, '2026-08-23T06:00:05.500Z', 'runtime-event-4'),
      ]);
    const prisma = {
      guildPlugin: { findMany: vi.fn(async () => [recentTarget]) },
      auditLog: { findMany: findAuditRows, create },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaClient;

    try {
      await expect(
        reconcilePluginRuntimeStartup(prisma, guildId, createLogger(), loadedState(), {
          now: () => updatedAt.getTime(),
          wait,
        }),
      ).resolves.toBe(true);
      expect(wait).toHaveBeenCalledWith(7_000);
      expect(findAuditRows).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'plugin.runtime_apply_succeeded',
          targetId: 'quote',
          metadata: expect.objectContaining({
            recovery: true,
            eventId: 'runtime-event-4',
            configVersion: 4,
          }),
        }),
      });
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previousDatabaseUrl;
    }
  });

  it('DB設定load失敗時はreconciliation未完了として後続同期の再試行を許可する', async () => {
    const previousDatabaseUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = 'postgresql://test.invalid/herta';
    const state = new PluginRuntimeState();
    const logger = createLogger();
    const findMany = vi.fn(async () => [target]);
    const prisma = {
      guildPlugin: { findMany },
      auditLog: {
        findMany: vi.fn(async () => [audit('plugin.runtime_apply_failed', 4)]),
        create: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    try {
      await expect(reconcilePluginRuntimeStartup(prisma, guildId, logger, state)).resolves.toBe(
        false,
      );
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previousDatabaseUrl;
    }
  });

  it('未解決current failureが未適用ならreconciliationを完了扱いにしない', async () => {
    const previousDatabaseUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = 'postgresql://test.invalid/herta';
    const state = new PluginRuntimeState();
    state.markConfigurationLoaded(guildId);
    const logger = createLogger();
    const transaction = vi.fn();
    const prisma = {
      guildPlugin: { findMany: vi.fn(async () => [target]) },
      auditLog: {
        findMany: vi.fn(async () => [audit('plugin.runtime_apply_failed', 4)]),
        create: vi.fn(),
      },
      $transaction: transaction,
    } as unknown as PrismaClient;

    try {
      await expect(reconcilePluginRuntimeStartup(prisma, guildId, logger, state)).resolves.toBe(
        false,
      );
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previousDatabaseUrl;
    }
  });

  it('並行した後続同期はin-flight失敗を待ってから再試行する', async () => {
    const concurrentGuildId = 'guild-concurrent-retry';
    resetPluginRuntimeStartupReconciliation(concurrentGuildId);
    const logger = createLogger();
    let resolveFirst: ((value: boolean) => void) | undefined;
    const reconcile = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(true);

    const first = reconcilePluginRuntimeStartupOnceWith(concurrentGuildId, logger, reconcile);
    await Promise.resolve();
    const second = reconcilePluginRuntimeStartupOnceWith(concurrentGuildId, logger, reconcile);

    expect(reconcile).toHaveBeenCalledTimes(1);
    resolveFirst?.(false);
    await Promise.all([first, second]);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('同一eventでpublish監査が後書きされてもterminal apply成功を優先する', () => {
    const eventId = 'runtime-event-4';
    expect(
      selectPluginRuntimeRecoveryCandidates(
        guildId,
        [target],
        [
          audit('plugin.runtime_publish_succeeded', 4, '2026-08-23T06:00:03.000Z', eventId),
          audit('plugin.runtime_apply_succeeded', 4, '2026-08-23T06:00:02.000Z', eventId),
        ],
        loadedState(),
      ),
    ).toEqual([]);
  });

  it('recovery Audit metadataへ元eventIdを保持し設定本文や例外本文を含めない', () => {
    expect(
      createStartupRecoveryAuditData(guildId, {
        ...target,
        recoveredFrom: 'apply_failed',
        eventId: 'runtime-event-4',
      }),
    ).toEqual({
      guildId,
      actorId: 'herta-bot',
      actorType: 'service',
      event: 'plugin.runtime_apply_succeeded',
      targetType: 'plugin',
      targetId: 'quote',
      severity: 'info',
      metadata: {
        operationSource: 'bot-runtime-startup-recovery',
        consumer: 'bot',
        recovery: true,
        recoveredFrom: 'apply_failed',
        eventId: 'runtime-event-4',
        eventType: 'enabled',
        configVersion: 4,
      },
    });
  });

  it('recovery audit保存失敗はfalseを返してstartup自体をrejectしない', async () => {
    const previousDatabaseUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = 'postgresql://test.invalid/herta';
    const logger = createLogger();
    const state = loadedState();
    const prisma = {
      guildPlugin: {
        findMany: vi.fn(async () => [target]),
      },
      auditLog: {
        findMany: vi.fn(async () => [audit('plugin.runtime_apply_failed', 4)]),
        create: vi.fn(async () => {
          const error = new Error('postgresql://user:secret@test.invalid/herta');
          error.name = 'AuditPersistenceError';
          throw error;
        }),
      },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaClient;

    try {
      await expect(reconcilePluginRuntimeStartup(prisma, guildId, logger, state)).resolves.toBe(
        false,
      );
      expect(logger.error).toHaveBeenCalledWith(
        { guildId, errorName: 'AuditPersistenceError' },
        'Plugin Runtime startup recoveryの監査処理に失敗しました',
      );
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('user:secret');
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previousDatabaseUrl;
    }
  });
});
