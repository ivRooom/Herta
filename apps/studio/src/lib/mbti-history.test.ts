import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMbtiHistory, readMbtiHistoryPercentages } from './mbti-history.ts';
const sample = { EI: 60, SN: 30, TF: 50, JP: 100, AT: 0 };
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
