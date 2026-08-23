import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedPluginConfigPermissionPaths,
  changedTopLevelConfigFields,
  PluginConfigPathPatchError,
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

test('validation後のnested差分はcanonical permission pathで返す', () => {
  const schema = {
    type: 'object',
    properties: {
      limits: {
        type: 'object',
        properties: {
          burst: { type: 'number' },
          sustained: { type: 'number' },
        },
      },
      policies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            severity: { type: 'string' },
          },
        },
      },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  assert.deepEqual(
    changedPluginConfigPermissionPaths(
      {
        limits: { burst: 2 },
        policies: [{ action: 'warn', severity: 'medium' }],
        tags: ['one'],
      },
      {
        limits: { burst: 2, sustained: 5 },
        policies: [{ action: 'timeout', severity: 'medium' }],
        tags: ['one', 'two'],
      },
      schema,
    ),
    ['limits.sustained', 'policies[].action', 'tags'],
  );
});

test('structured arrayの要素数変更はcontainer全体の差分として扱う', () => {
  const schema = {
    type: 'object',
    properties: {
      policies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            severity: { type: 'string' },
          },
        },
      },
    },
  };

  assert.deepEqual(
    changedPluginConfigPermissionPaths(
      { policies: [{ action: 'warn', severity: 'medium' }] },
      {
        policies: [
          { action: 'warn', severity: 'medium' },
          { action: 'ban', severity: 'critical' },
        ],
      },
      schema,
    ),
    ['policies'],
  );
});

test('schema外のvalidation差分は最も近い保護可能なcontainerへ寄せる', () => {
  const schema = {
    type: 'object',
    properties: {
      limits: {
        type: 'object',
        properties: { burst: { type: 'number' } },
      },
    },
  };

  assert.deepEqual(
    changedPluginConfigPermissionPaths(
      { limits: { burst: 2, legacy: true }, topLevelLegacy: 'remove-me' },
      { limits: { burst: 2 } },
      schema,
    ),
    ['limits', 'topLevelLegacy'],
  );
});

test('nested path patchは対象leafだけを変更し兄弟値を保持する', () => {
  const current = {
    autoEnforcementPolicies: [
      { selector: 'spam', action: 'delete', severity: 'high' },
      { selector: 'invite', action: 'warn', severity: 'medium' },
    ],
    hiddenSetting: 'keep',
  };
  assert.deepEqual(
    resolvePluginConfigCandidate(current, {
      configPathPatch: [{ path: ['autoEnforcementPolicies', 1, 'action'], value: 'timeout' }],
    }),
    {
      autoEnforcementPolicies: [
        { selector: 'spam', action: 'delete', severity: 'high' },
        { selector: 'invite', action: 'timeout', severity: 'medium' },
      ],
      hiddenSetting: 'keep',
    },
  );
  assert.equal(current.autoEnforcementPolicies[1]?.action, 'warn');
});

test('removeConfigPathsは既存object leafだけを削除する', () => {
  assert.deepEqual(
    resolvePluginConfigCandidate(
      { nested: { optional: 'remove', keep: true }, untouched: 'value' },
      { removeConfigPaths: [['nested', 'optional']] },
    ),
    { nested: { keep: true }, untouched: 'value' },
  );
});

test('path patchとlegacy whole patchの混在を拒否する', () => {
  assert.throws(
    () =>
      resolvePluginConfigCandidate(
        { nested: { value: 1 } },
        {
          configPatch: { nested: { value: 2 } },
          configPathPatch: [{ path: ['nested', 'value'], value: 3 }],
        },
      ),
    PluginConfigPathPatchError,
  );
});

test('存在しないpathと範囲外array indexを拒否する', () => {
  assert.throws(
    () =>
      resolvePluginConfigCandidate(
        { policies: [{ action: 'delete' }] },
        { configPathPatch: [{ path: ['policies', 3, 'action'], value: 'timeout' }] },
      ),
    PluginConfigPathPatchError,
  );
  assert.throws(
    () =>
      resolvePluginConfigCandidate(
        { nested: { value: 1 } },
        { configPathPatch: [{ path: ['nested', 'missing'], value: 2 }] },
      ),
    PluginConfigPathPatchError,
  );
});

test('prototype pollutionにつながるpath segmentを拒否する', () => {
  assert.throws(
    () =>
      resolvePluginConfigCandidate(
        { nested: { value: 1 } },
        { configPathPatch: [{ path: ['__proto__', 'polluted'], value: true }] },
      ),
    PluginConfigPathPatchError,
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('array element自体の削除は構造変更として拒否する', () => {
  assert.throws(
    () =>
      resolvePluginConfigCandidate(
        { policies: [{ action: 'delete' }] },
        { removeConfigPaths: [['policies', 0]] },
      ),
    PluginConfigPathPatchError,
  );
});
