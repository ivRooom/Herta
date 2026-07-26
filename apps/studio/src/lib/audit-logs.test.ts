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

test('Plugin設定変更は設定値を含めず安全な要約へ変換する', () => {
  const presentation = describeAuditEvent('plugin.config_update', 'plugin', 'quote', {
    token: 'super-secret-token',
  });

  assert.equal(presentation.category, 'plugin');
  assert.equal(presentation.targetLabel, 'Plugin: quote');
  assert.equal(presentation.summary.includes('super-secret-token'), false);
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
