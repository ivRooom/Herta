import assert from 'node:assert/strict';
import test from 'node:test';

import { renderGrypeConfig, validateAllowlist } from './prepare-grype-config.mjs';

const now = new Date('2026-07-23T12:00:00.000Z');

function validEntry(overrides = {}) {
  return {
    id: 'CVE-2026-12345',
    reason: '修正版が未公開のため影響範囲を限定して一時的に許可する',
    expires: '2026-08-15',
    issue: 'https://github.com/ivRooom/Herta/issues/123',
    package: {
      name: 'example-package',
      type: 'npm',
    },
    ...overrides,
  };
}

test('空のallowlistから有効なGrype設定を生成する', () => {
  const entries = validateAllowlist([], now);
  assert.equal(renderGrypeConfig(entries), 'ignore: []\n');
});

test('理由・期限・Issue・package条件をGrype設定へ反映する', () => {
  const entries = validateAllowlist([validEntry()], now);
  const config = renderGrypeConfig(entries);

  assert.match(config, /vulnerability: "CVE-2026-12345"/);
  assert.match(config, /name: "example-package"/);
  assert.match(config, /type: "npm"/);
  assert.match(config, /expires: 2026-08-15/);
  assert.match(config, /issues\/123/);
});

test('期限切れの例外を拒否する', () => {
  assert.throws(() => validateAllowlist([validEntry({ expires: '2026-07-23' })], now), /期限切れ/);
});

test('90日を超える例外を拒否する', () => {
  assert.throws(() => validateAllowlist([validEntry({ expires: '2026-11-01' })], now), /90日以内/);
});

test('Issue URLがない例外を拒否する', () => {
  assert.throws(() => validateAllowlist([validEntry({ issue: '#123' })], now), /Issue URL/);
});

test('短すぎる理由を拒否する', () => {
  assert.throws(() => validateAllowlist([validEntry({ reason: '一時許可' })], now), /10文字以上/);
});

test('同じ脆弱性とpackage条件の重複を拒否する', () => {
  assert.throws(() => validateAllowlist([validEntry(), validEntry()], now), /重複/);
});

test('package条件を省略したGHSA例外を許可する', () => {
  const entry = validEntry({
    id: 'GHSA-xxxx-yyyy-zzzz',
    package: undefined,
  });

  const entries = validateAllowlist([entry], now);
  assert.equal(entries[0].id, 'GHSA-XXXX-YYYY-ZZZZ');
  assert.doesNotMatch(renderGrypeConfig(entries), /package:/);
});
