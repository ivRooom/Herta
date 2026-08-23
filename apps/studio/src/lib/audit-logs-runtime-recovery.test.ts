import { describe, expect, it } from 'vitest';
import { describeAuditEvent } from './audit-logs.ts';

describe('Plugin Runtime startup recovery Audit presentation', () => {
  it('通常apply ACKとstartup recovery ACKを表示上区別する', () => {
    const normal = describeAuditEvent(
      'plugin.runtime_apply_succeeded',
      'plugin',
      'quote',
      {
        operationSource: 'bot-runtime',
        configVersion: 4,
      },
    );
    const recovery = describeAuditEvent(
      'plugin.runtime_apply_succeeded',
      'plugin',
      'quote',
      {
        operationSource: 'bot-runtime-startup-recovery',
        recovery: true,
        recoveredFrom: 'apply_failed',
        configVersion: 4,
      },
    );

    expect(normal.sourceLabel).toBe('Bot Runtime');
    expect(normal.summary).toBe('BotがPlugin Runtime設定を再同期しました。');
    expect(recovery.sourceLabel).toBe('Bot Runtime Recovery');
    expect(recovery.summary).toBe('Bot起動時の再同期でPlugin Runtime設定の復旧を確認しました。');
  });
});
