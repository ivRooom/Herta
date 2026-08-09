import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSuccessRate,
  fillCommandUsageDays,
  fillCommandUsageHours,
  normalizeAnalyticsDays,
  normalizeCommandExecutionInput,
  startOfJstDay,
} from './command-analytics.js';

test('コマンド実行情報から不要な空白を除去し処理時間を制限する', () => {
  const normalized = normalizeCommandExecutionInput({
    guildId: ' 1234567890 ',
    commandName: ' ping ',
    status: 'failure',
    durationMs: 999_999,
    errorName: ' Error ',
  });

  assert.deepEqual(normalized, {
    guildId: '1234567890',
    commandName: 'ping',
    status: 'failure',
    durationMs: 300_000,
    errorName: 'Error',
  });
});

test('空のコマンド名を安全な代替値へ変換する', () => {
  const normalized = normalizeCommandExecutionInput({
    guildId: null,
    commandName: '   ',
    status: 'success',
    durationMs: -10,
  });

  assert.equal(normalized.commandName, 'unknown-command');
  assert.equal(normalized.durationMs, 0);
  assert.equal(normalized.errorName, null);
});

test('JSTの日付境界をUTC時刻へ変換する', () => {
  const result = startOfJstDay(new Date('2026-07-26T18:30:00.000Z'));
  assert.equal(result.toISOString(), '2026-07-26T15:00:00.000Z');
});

test('過去7日の日次データで欠損日を0件として補完する', () => {
  const result = fillCommandUsageDays(
    [{ date: '2026-07-25', total: 3, succeeded: 2, failed: 1 }],
    new Date('2026-07-27T03:00:00.000Z'),
  );

  assert.equal(result.length, 7);
  assert.equal(result[0]?.date, '2026-07-21');
  assert.deepEqual(result[4], {
    date: '2026-07-25',
    total: 3,
    succeeded: 2,
    failed: 1,
  });
  assert.equal(result[6]?.date, '2026-07-27');
});

test('任意期間の日次データを補完できる', () => {
  const result = fillCommandUsageDays([], new Date('2026-07-27T03:00:00.000Z'), 30);
  assert.equal(result.length, 30);
  assert.equal(result[0]?.date, '2026-06-28');
  assert.equal(result[29]?.date, '2026-07-27');
});

test('時間帯データを0時から23時まで補完する', () => {
  const result = fillCommandUsageHours([
    { hour: 9, total: 4, succeeded: 3, failed: 1 },
    { hour: 21, total: 2, succeeded: 2, failed: 0 },
  ]);

  assert.equal(result.length, 24);
  assert.deepEqual(result[9], { hour: 9, total: 4, succeeded: 3, failed: 1 });
  assert.deepEqual(result[10], { hour: 10, total: 0, succeeded: 0, failed: 0 });
});

test('分析期間を1日から90日の範囲へ正規化する', () => {
  assert.equal(normalizeAnalyticsDays(undefined), 7);
  assert.equal(normalizeAnalyticsDays(30), 30);
  assert.equal(normalizeAnalyticsDays(0), 1);
  assert.equal(normalizeAnalyticsDays(365), 90);
});

test('成功率を小数第1位まで計算する', () => {
  assert.equal(calculateSuccessRate({ total: 3, succeeded: 2, failed: 1 }), 66.7);
  assert.equal(calculateSuccessRate({ total: 0, succeeded: 0, failed: 0 }), null);
});
