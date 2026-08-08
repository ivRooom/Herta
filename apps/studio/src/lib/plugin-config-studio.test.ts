import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySchemaDefaults,
  fieldMatchesSearch,
  makeDefaultValue,
  moveArrayItem,
  normalizeConfigForStudio,
  parseConfigJson,
  removeConfigValue,
  updateConfigValue,
  type JsonSchema,
} from './plugin-config-studio.ts';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean', default: true, title: '有効化' },
    retries: { type: 'integer', minimum: 0, default: 3, title: '再試行回数' },
    mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe', title: '動作モード' },
    nested: {
      type: 'object',
      title: '詳細設定',
      properties: {
        label: { type: 'string', default: 'Herta', description: '表示名' },
      },
    },
    rules: {
      type: 'array',
      title: 'カスタムルール',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string', default: '' },
          weight: { type: 'number', default: 1 },
        },
      },
    },
    nullableText: { type: ['string', 'null'], default: null },
  },
};

test('Schema defaultを既存設定へ安全に補完する', () => {
  assert.deepEqual(normalizeConfigForStudio(schema, { retries: 9, unknown: 'keep' }), {
    retries: 9,
    unknown: 'keep',
    enabled: true,
    mode: 'safe',
    nested: { label: 'Herta' },
    rules: [],
    nullableText: null,
  });
});

test('array objectの追加用defaultを生成できる', () => {
  const itemSchema = schema.properties?.rules.items;
  assert.deepEqual(makeDefaultValue(itemSchema ?? {}), { keyword: '', weight: 1 });
});

test('path指定でnested valueを更新できる', () => {
  const current = { nested: { label: 'Herta' }, rules: [{ keyword: 'a' }] };
  assert.deepEqual(updateConfigValue(current, ['nested', 'label'], 'Studio'), {
    nested: { label: 'Studio' },
    rules: [{ keyword: 'a' }],
  });
  assert.deepEqual(updateConfigValue(current, ['rules', 0, 'keyword'], 'hello'), {
    nested: { label: 'Herta' },
    rules: [{ keyword: 'hello' }],
  });
});

test('array itemを削除・並び替えできる', () => {
  const current = { rules: ['a', 'b', 'c'] };
  assert.deepEqual(removeConfigValue(current, ['rules', 1]), { rules: ['a', 'c'] });
  assert.deepEqual(moveArrayItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
});

test('JSONはobjectのみ許可する', () => {
  assert.deepEqual(parseConfigJson('{"enabled":true}'), { enabled: true });
  assert.throws(() => parseConfigJson('[]'), /オブジェクト形式/);
});

test('検索は親・子のtitle/descriptionを対象にする', () => {
  assert.equal(fieldMatchesSearch('nested', schema.properties?.nested ?? {}, '表示名'), true);
  assert.equal(fieldMatchesSearch('rules', schema.properties?.rules ?? {}, '存在しない'), false);
});

test('undefinedにはSchema defaultが適用される', () => {
  assert.equal(applySchemaDefaults({ type: 'integer', default: 5 }, undefined), 5);
});
