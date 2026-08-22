import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAuditEvent, parseAuditLogQuery, resolveAuditLogPage } from './audit-logs.ts';

test('監査ログ検索条件を正規化する', () => {
  const query = parseAuditLogQuery(
    new URLSearchParams({
      page: '2',
      pageSize: '500',
      search: '  quote.update  ',
      category: 'quote',
      severity: 'warning',
      from: '2026-07-01',
      to: '2026-07-31',
    }),
  );

  assert.equal(query.page, 2);
  assert.equal(query.pageSize, 50);
  assert.equal(query.search, 'quote.update');
  assert.equal(query.category, 'quote');
  assert.equal(query.severity, 'warning');
  assert.equal(query.from?.toISOString(), '2026-06-30T15:00:00.000Z');
  assert.equal(query.toExclusive?.toISOString(), '2026-07-31T15:00:00.000Z');
});

test('不正な検索条件を安全な既定値へ戻す', () => {
  const query = parseAuditLogQuery(
    new URLSearchParams({
      page: '-1',
      pageSize: '0',
      category: 'secret',
      severity: 'fatal',
      from: 'not-a-date',
    }),
  );

  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 25);
  assert.equal(query.category, 'all');
  assert.equal(query.severity, 'all');
  assert.equal(query.from, null);
  assert.equal(query.fromInput, '');
});

test('存在しないカレンダー日付を検索条件から除外する', () => {
  const query = parseAuditLogQuery(
    new URLSearchParams({
      from: '2026-02-29',
      to: '2026-04-31',
    }),
  );

  assert.equal(query.fromInput, '');
  assert.equal(query.toInput, '');
  assert.equal(query.from, null);
  assert.equal(query.toExclusive, null);
});

test('要求ページを利用可能なページ範囲へ補正する', () => {
  assert.equal(resolveAuditLogPage(8, 3), 3);
  assert.equal(resolveAuditLogPage(2, 3), 2);
  assert.equal(resolveAuditLogPage(-1, 3), 1);
  assert.equal(resolveAuditLogPage(Number.NaN, 3), 1);
  assert.equal(resolveAuditLogPage(1, 0), 1);
});

test('Quote操作は本文を含めず安全な要約へ変換する', () => {
  const presentation = describeAuditEvent('quote.update', 'quote', 'quote-id', {
    quoteNumber: 42,
    operationSource: 'dashboard',
    quoteText: '画面へ出してはいけない本文',
  });

  assert.equal(presentation.eventLabel, 'Quoteを更新');
  assert.equal(presentation.targetLabel, 'Quote #42');
  assert.equal(presentation.sourceLabel, 'Herta Studio');
  assert.equal(presentation.summary.includes('画面へ出してはいけない本文'), false);
});

test('Birthday自己登録はDiscord認証導線として監査ソースを区別する', () => {
  const presentation = describeAuditEvent(
    'birthday.registration_set',
    'birthday_registration',
    '111111111111111111',
    { operationSource: 'discord' },
  );

  assert.equal(presentation.sourceLabel, 'Discord');
});

test('既存Plugin監査ログはmetadataがなくてもStudio操作として表示する', () => {
  const presentation = describeAuditEvent('plugin.enable', 'plugin', 'quote', null);

  assert.equal(presentation.sourceLabel, 'Herta Studio');
});

test('Plugin設定変更は設定値を含めず安全な要約へ変換する', () => {
  const presentation = describeAuditEvent('plugin.config_update', 'plugin', 'quote', {
    token: 'super-secret-token',
  });

  assert.equal(presentation.category, 'plugin');
  assert.equal(presentation.targetLabel, 'Plugin: quote');
  assert.equal(presentation.sourceLabel, 'Herta Studio');
  assert.equal(presentation.summary.includes('super-secret-token'), false);
});

test('Runtime publish失敗はStudio Runtimeとして安全に表示する', () => {
  const presentation = describeAuditEvent('plugin.runtime_publish_failed', 'plugin', 'quote', {
    operationSource: 'studio-runtime',
    configVersion: 8,
    failureReason: 'publish_error',
    redisUrl: 'redis://secret-host:6379',
  });

  assert.equal(presentation.eventLabel, 'Runtime通知の送信に失敗');
  assert.equal(presentation.sourceLabel, 'Studio Runtime');
  assert.equal(presentation.category, 'plugin');
  assert.equal(presentation.summary.includes('secret-host'), false);
});

test('Runtime apply失敗はBot Runtimeとして安全に表示する', () => {
  const presentation = describeAuditEvent('plugin.runtime_apply_failed', 'plugin', 'moderation', {
    operationSource: 'bot-runtime',
    configVersion: 9,
    attempts: 3,
    token: 'super-secret-token',
  });

  assert.equal(presentation.eventLabel, 'Runtime設定のBot反映に失敗');
  assert.equal(presentation.sourceLabel, 'Bot Runtime');
  assert.equal(presentation.targetLabel, 'Plugin: moderation');
  assert.equal(presentation.summary.includes('super-secret-token'), false);
});

test('Moderation decisionは実行可否・Action・権限状態を安全に表示する', () => {
  const presentation = describeAuditEvent(
    'moderation.automatic.decision',
    'discord_user',
    '688313716055343104',
    {
      outcome: 'execute',
      action: 'delete',
      severity: 'medium',
      messageDeletable: true,
      botCanManageMessages: true,
      messageId: 'secret-message-id',
      content: '画面へ出してはいけない本文',
    },
  );

  assert.equal(presentation.eventLabel, '自動Moderation判定');
  assert.equal(presentation.sourceLabel, 'Herta Bot');
  assert.match(presentation.summary, /判定: 実行対象/u);
  assert.match(presentation.summary, /対応: メッセージ削除/u);
  assert.match(presentation.summary, /危険度: 中/u);
  assert.match(presentation.summary, /メッセージ削除可能: はい/u);
  assert.match(presentation.summary, /Botのメッセージ管理権限: あり/u);
  assert.equal(presentation.summary.includes('secret-message-id'), false);
  assert.equal(presentation.summary.includes('画面へ出してはいけない本文'), false);
});

test('Moderation decisionがdisabledなら実行されないことを明示する', () => {
  const presentation = describeAuditEvent('moderation.automatic.decision', 'discord_user', '1', {
    outcome: 'disabled',
    action: 'delete',
    severity: 'medium',
  });

  assert.match(presentation.summary, /自動対応OFF（実行なし）/u);
});

test('Moderation実行結果は既削除とDiscord失敗を判別できる', () => {
  const alreadySatisfied = describeAuditEvent(
    'moderation.automatic.executed',
    'discord_user',
    '1',
    {
      action: 'delete',
      actionOutcome: 'already_satisfied',
      discordErrorCode: 10008,
    },
  );
  const failed = describeAuditEvent('moderation.automatic.failed', 'discord_user', '1', {
    action: 'delete',
    actionOutcome: 'failed',
    discordErrorCode: 50013,
    discordHttpStatus: 403,
  });

  assert.match(alreadySatisfied.summary, /実行結果: 既に目的達成/u);
  assert.match(alreadySatisfied.summary, /Discord code: 10008/u);
  assert.match(failed.summary, /実行結果: 失敗/u);
  assert.match(failed.summary, /Discord code: 50013/u);
  assert.match(failed.summary, /HTTP: 403/u);
});

test('Discord error codeの数字文字列は監査要約へ表示できる', () => {
  const presentation = describeAuditEvent('moderation.automatic.executed', 'discord_user', '1', {
    action: 'delete',
    actionOutcome: 'already_satisfied',
    discordErrorCode: '10008',
  });

  assert.match(presentation.summary, /Discord code: 10008/u);
});

test('未知のModeration metadataやsecret-like値を監査要約へ露出しない', () => {
  const decision = describeAuditEvent('moderation.automatic.decision', 'discord_user', '1', {
    outcome: 'sk-proj-secret-outcome',
    action: 'secret-action-value',
    severity: 'secret-severity-value',
  });
  const failed = describeAuditEvent('moderation.automatic.failed', 'discord_user', '1', {
    action: 'secret-action-value',
    actionOutcome: 'secret-outcome-value',
    discordErrorCode: 'sk-proj-secret-code',
    discordHttpStatus: 999,
  });

  for (const presentation of [decision, failed]) {
    assert.equal(presentation.summary.includes('sk-proj'), false);
    assert.equal(presentation.summary.includes('secret-action-value'), false);
    assert.equal(presentation.summary.includes('secret-outcome-value'), false);
    assert.equal(presentation.summary.includes('secret-severity-value'), false);
    assert.equal(presentation.summary.includes('999'), false);
  }
});

test('未知イベントも生データを展開せず表示できる', () => {
  const presentation = describeAuditEvent('custom.operation', 'custom', 'target-1', {
    password: 'do-not-render',
  });

  assert.equal(presentation.eventLabel, 'custom.operation');
  assert.equal(presentation.category, 'other');
  assert.equal(presentation.targetLabel, 'custom: target-1');
  assert.equal(presentation.summary.includes('do-not-render'), false);
});
