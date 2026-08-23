import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAuditEvent } from './audit-logs.ts';

test('通常apply ACKとstartup recovery ACKを表示上区別する', () => {
  const normal = describeAuditEvent('plugin.runtime_apply_succeeded', 'plugin', 'quote', {
    operationSource: 'bot-runtime',
    configVersion: 4,
  });
  const recovery = describeAuditEvent('plugin.runtime_apply_succeeded', 'plugin', 'quote', {
    operationSource: 'bot-runtime-startup-recovery',
    recovery: true,
    recoveredFrom: 'apply_failed',
    configVersion: 4,
  });

  assert.equal(normal.sourceLabel, 'Bot Runtime');
  assert.equal(normal.summary, 'BotがPlugin Runtime設定を再同期しました。');
  assert.equal(recovery.sourceLabel, 'Bot Runtime Recovery');
  assert.equal(recovery.summary, 'Bot起動時の再同期でPlugin Runtime設定の復旧を確認しました。');
});
