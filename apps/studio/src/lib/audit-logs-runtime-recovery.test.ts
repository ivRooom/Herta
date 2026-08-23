import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAuditEvent } from './audit-logs.ts';

test('通常Bot apply ACKとstartup recovery ACKを表示上区別する', () => {
  const normal = describeAuditEvent('plugin.runtime_apply_succeeded', 'plugin', 'quote', {
    operationSource: 'bot-runtime',
    consumer: 'bot',
    configVersion: 4,
  });
  const recovery = describeAuditEvent('plugin.runtime_apply_succeeded', 'plugin', 'quote', {
    operationSource: 'bot-runtime-startup-recovery',
    consumer: 'bot',
    recovery: true,
    recoveredFrom: 'apply_failed',
    configVersion: 4,
  });

  assert.equal(normal.eventLabel, 'Runtime設定をBotへ反映');
  assert.equal(normal.sourceLabel, 'Bot Runtime');
  assert.equal(normal.summary, 'BotがPlugin Runtime設定を再同期しました。');
  assert.equal(recovery.sourceLabel, 'Bot Runtime Recovery');
  assert.equal(recovery.summary, 'Bot起動時の再同期でPlugin Runtime設定の復旧を確認しました。');
});

test('consumerなしのlegacy apply ACKはBotとして後方互換に表示する', () => {
  const legacy = describeAuditEvent('plugin.runtime_apply_failed', 'plugin', 'quote', {
    configVersion: 4,
  });

  assert.equal(legacy.eventLabel, 'Runtime設定のBot反映に失敗');
  assert.equal(legacy.sourceLabel, 'Bot Runtime');
  assert.equal(legacy.summary, 'BotがPlugin Runtime設定を再同期できませんでした。');
});

test('Worker apply ACKはBotと誤表示せずconsumer別に表示する', () => {
  const applied = describeAuditEvent('plugin.runtime_apply_succeeded', 'plugin', 'quote', {
    operationSource: 'worker-runtime',
    consumer: 'worker',
    configVersion: 4,
  });
  const failed = describeAuditEvent('plugin.runtime_apply_failed', 'plugin', 'quote', {
    consumer: 'worker',
    configVersion: 4,
  });

  assert.equal(applied.eventLabel, 'Runtime設定をWorkerへ反映');
  assert.equal(applied.sourceLabel, 'Worker Runtime');
  assert.equal(applied.summary, 'WorkerがPlugin Runtime設定を再同期しました。');
  assert.equal(failed.eventLabel, 'Runtime設定のWorker反映に失敗');
  assert.equal(failed.sourceLabel, 'Worker Runtime');
  assert.equal(failed.summary, 'WorkerがPlugin Runtime設定を再同期できませんでした。');
});

test('未知consumerはmetadata値を表示せず安全な汎用表現へfallbackする', () => {
  const unknown = describeAuditEvent('plugin.runtime_apply_succeeded', 'plugin', 'quote', {
    consumer: '<script>alert(1)</script>',
    configVersion: 4,
  });

  assert.equal(unknown.eventLabel, 'Runtime設定をRuntime consumerへ反映');
  assert.equal(unknown.sourceLabel, 'Runtime Consumer');
  assert.equal(unknown.summary, 'Runtime consumerがPlugin Runtime設定を再同期しました。');
  assert.equal(JSON.stringify(unknown).includes('<script>'), false);
});

test('Runtime publish監査は特定consumerへの配信成功と誤認しない中立表現にする', () => {
  const published = describeAuditEvent('plugin.runtime_publish_succeeded', 'plugin', 'quote', {
    operationSource: 'studio-runtime',
    configVersion: 4,
  });

  assert.equal(published.eventLabel, 'Runtime通知を送信');
  assert.equal(published.sourceLabel, 'Studio Runtime');
  assert.equal(published.summary, 'Plugin Runtime更新イベントを送信しました。');
});
