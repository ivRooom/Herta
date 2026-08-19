import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidGuildAnniversaryDate } from './guild-anniversary.ts';

const TODAY = new Date('2026-08-19T09:00:00.000Z');

test('サーバー周年日は実在する過去日と当日を許可する', () => {
  assert.equal(isValidGuildAnniversaryDate('2020-08-19', TODAY), true);
  assert.equal(isValidGuildAnniversaryDate('2026-08-19', TODAY), true);
  assert.equal(isValidGuildAnniversaryDate('2024-02-29', TODAY), true);
});

test('存在しない日付・未来日・形式違いを拒否する', () => {
  assert.equal(isValidGuildAnniversaryDate('2026-02-29', TODAY), false);
  assert.equal(isValidGuildAnniversaryDate('2026-04-31', TODAY), false);
  assert.equal(isValidGuildAnniversaryDate('2026-08-20', TODAY), false);
  assert.equal(isValidGuildAnniversaryDate('2026/08/19', TODAY), false);
});
