import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareMbtiHistory,
  readMbtiHistoryPercentages,
  mbtiHistorySourceLabel,
} from './mbti-history.ts';
const sample = { EI: 60, SN: 30, TF: 50, JP: 100, AT: 0 };
test('estimated scores are labelled and never treated as measured movement', () => {
  assert.match(mbtiHistorySourceLabel('estimate', 0), /推定/);
  const estimate = { percentages: sample, scoringVersion: 'historical-estimate-v1' };
  assert.equal(compareMbtiHistory(estimate, estimate), null);
  assert.equal(
    compareMbtiHistory(estimate, { percentages: sample, scoringVersion: 'likert-62-v1' }),
    null,
  );
});
test('history measures percentage point movement and boundary crossing without rescaling old scores', () => {
  const current = { percentages: sample, scoringVersion: 'v1' };
  const before = { percentages: { ...sample, EI: 40, SN: 70, TF: 49 }, scoringVersion: 'v1' };
  const result = compareMbtiHistory(current, before)!;
  assert.deepEqual(
    result.map((r) => r.delta),
    [20, -40, 1, 0, 0],
  );
  assert.deepEqual(
    result.map((r) => r.crossed),
    [true, true, true, false, false],
  );
  assert.equal(compareMbtiHistory(current, { ...before, scoringVersion: 'v2' }), null);
});
test('malformed or missing saved percentages cannot become a comparison', () => {
  for (const bad of [
    null,
    [],
    {},
    { ...sample, AT: NaN },
    { ...sample, EI: 101 },
    { ...sample, EI: '20' },
  ]) {
    assert.equal(readMbtiHistoryPercentages(bad), null);
  }
  assert.deepEqual(readMbtiHistoryPercentages(sample), sample);
});

test('manual corrections never masquerade as a new diagnosis or a score comparison', () => {
  assert.equal(mbtiHistorySourceLabel('correction', 0), '手動訂正（診断スコアなし）');
  assert.equal(mbtiHistorySourceLabel('discord', 62), '62問 · Discord');
  assert.equal(
    compareMbtiHistory(
      { percentages: null, scoringVersion: 'manual-correction-v1' },
      { percentages: sample, scoringVersion: 'likert-62-v1' },
    ),
    null,
  );
});
