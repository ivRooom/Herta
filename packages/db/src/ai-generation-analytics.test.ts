import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAiSuccessRate,
  fillAiUsageDays,
  normalizeAiAnalyticsDays,
  normalizeAiGenerationEventInput,
} from './ai-generation-analytics.js';

test('AI生成イベント情報から不要な空白を除去しコスト・トークン数を制限する', () => {
  const normalized = normalizeAiGenerationEventInput({
    guildId: ' 1234567890 ',
    provider: ' openai ',
    model: ' gpt-5.6-terra ',
    modelProfile: ' balanced ',
    feature: ' knowledge.qa ',
    resultCategory: 'success',
    errorCategory: null,
    inputTokens: -5,
    outputTokens: 20_000_000,
    totalTokens: 100,
    estimatedCostUsd: -1,
    durationMs: 999_999_999,
  });

  assert.deepEqual(normalized, {
    guildId: '1234567890',
    provider: 'openai',
    model: 'gpt-5.6-terra',
    modelProfile: 'balanced',
    feature: 'knowledge.qa',
    resultCategory: 'success',
    errorCategory: null,
    inputTokens: 0,
    outputTokens: 10_000_000,
    totalTokens: 100,
    estimatedCostUsd: 0,
    durationMs: 600_000,
  });
});

test('空のguildId/providerを安全な代替値へ変換する', () => {
  const normalized = normalizeAiGenerationEventInput({
    guildId: '   ',
    provider: '',
    model: '',
    modelProfile: '',
    feature: '',
    resultCategory: 'failed',
    errorCategory: ' timeout ',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
  });

  assert.equal(normalized.guildId, 'unknown-guild');
  assert.equal(normalized.provider, 'unknown-provider');
  assert.equal(normalized.model, 'unknown-model');
  assert.equal(normalized.modelProfile, 'unknown-profile');
  assert.equal(normalized.feature, 'unknown-feature');
  assert.equal(normalized.errorCategory, 'timeout');
});

test('resultCategoryがsuccess以外ならerrorCategoryが無くても保持できる', () => {
  const normalized = normalizeAiGenerationEventInput({
    guildId: 'guild-1',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    modelProfile: 'balanced',
    feature: 'chat',
    resultCategory: 'rejected',
    errorCategory: undefined,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimatedCostUsd: 0.001,
    durationMs: 500,
  });

  assert.equal(normalized.errorCategory, null);
  assert.equal(normalized.resultCategory, 'rejected');
});

test('過去7日の日次データで欠損日を0件として補完する', () => {
  const result = fillAiUsageDays(
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
  const result = fillAiUsageDays([], new Date('2026-07-27T03:00:00.000Z'), 30);
  assert.equal(result.length, 30);
  assert.equal(result[0]?.date, '2026-06-28');
  assert.equal(result[29]?.date, '2026-07-27');
});

test('analytics日数を1〜90日へ丸める', () => {
  assert.equal(normalizeAiAnalyticsDays(undefined), 7);
  assert.equal(normalizeAiAnalyticsDays(0), 1);
  assert.equal(normalizeAiAnalyticsDays(-5), 1);
  assert.equal(normalizeAiAnalyticsDays(365), 90);
  assert.equal(normalizeAiAnalyticsDays(30), 30);
});

test('成功率を1桁小数のパーセンテージへ丸める', () => {
  assert.equal(calculateAiSuccessRate({ total: 0, succeeded: 0, failed: 0 }), null);
  assert.equal(calculateAiSuccessRate({ total: 3, succeeded: 2, failed: 1 }), 66.7);
  assert.equal(calculateAiSuccessRate({ total: 10, succeeded: 10, failed: 0 }), 100);
});
