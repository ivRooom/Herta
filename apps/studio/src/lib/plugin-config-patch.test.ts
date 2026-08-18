import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedTopLevelConfigFields,
  resolvePluginConfigCandidate,
} from './plugin-config-patch.ts';

test('partial patchは見えていない既存設定を保持する', () => {
  assert.deepEqual(
    resolvePluginConfigCandidate(
      { visible: 1, hiddenSecretLikeSetting: 'keep', nested: { enabled: true } },
      { configPatch: { visible: 2 } },
    ),
    { visible: 2, hiddenSecretLikeSetting: 'keep', nested: { enabled: true } },
  );
});

test('removeConfigFieldsは指定されたtop-level fieldだけを削除する', () => {
  assert.deepEqual(
    resolvePluginConfigCandidate(
      { keep: 'value', removeMe: 'old', nested: { removeMe: 'nested-kept' } },
      { removeConfigFields: ['removeMe'] },
    ),
    { keep: 'value', nested: { removeMe: 'nested-kept' } },
  );
});

test('full config指定時はpartial入力よりfull configを正本にする', () => {
  assert.deepEqual(
    resolvePluginConfigCandidate(
      { old: true },
      { config: { replacement: true }, configPatch: { ignored: true } },
    ),
    { replacement: true },
  );
});

test('設定変更がない場合はcandidateを生成しない', () => {
  assert.equal(resolvePluginConfigCandidate({ keep: true }, {}), undefined);
});

test('changed fieldsは追加・変更・削除だけを安定順で返す', () => {
  assert.deepEqual(
    changedTopLevelConfigFields(
      { unchanged: [1, 2], changed: 1, removed: true },
      { unchanged: [1, 2], changed: 2, added: 'new' },
    ),
    ['added', 'changed', 'removed'],
  );
});
