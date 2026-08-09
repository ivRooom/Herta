import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSchemaBranchState,
  resolveSchemaForArrayItem,
  resolveSchemaForValue,
  schemaMatchesValue,
  selectSchemaBranch,
} from './plugin-config-schema-branches.ts';
import type { JsonSchema } from './plugin-config-studio.ts';

const oneOfSchema = {
  type: 'object',
  oneOf: [
    {
      title: 'Discord Channel',
      properties: {
        targetType: { type: 'string', const: 'channel' },
        channelId: { type: 'string', default: '' },
      },
      required: ['targetType', 'channelId'],
    },
    {
      title: 'Discord User',
      properties: {
        targetType: { type: 'string', const: 'user' },
        userId: { type: 'string', default: '' },
      },
      required: ['targetType', 'userId'],
    },
  ],
} as unknown as JsonSchema;

test('oneOfのdiscriminatorを自動検出して現在branchを判定する', () => {
  const state = getSchemaBranchState(oneOfSchema, {
    targetType: 'user',
    userId: '123',
  });

  assert.equal(state?.mode, 'oneOf');
  assert.equal(state?.options[0]?.discriminatorKey, 'targetType');
  assert.equal(state?.options[0]?.active, false);
  assert.equal(state?.options[1]?.active, true);
  assert.equal(state?.options[1]?.label, 'Discord User');
});

test('branch切替時に既存の未知キーを保持しつつdiscriminatorを更新する', () => {
  const next = selectSchemaBranch(
    oneOfSchema,
    {
      targetType: 'channel',
      channelId: '456',
      memo: 'keep-me',
    },
    1,
  );

  assert.deepEqual(next, {
    targetType: 'user',
    userId: '',
    channelId: '456',
    memo: 'keep-me',
  });
});

test('現在値に合うoneOf branchだけをeffective schemaへ展開する', () => {
  const resolved = resolveSchemaForValue(oneOfSchema, {
    targetType: 'user',
    userId: '123',
  });

  assert.ok(resolved.properties?.targetType);
  assert.ok(resolved.properties?.userId);
  assert.equal(resolved.properties?.channelId, undefined);
  assert.deepEqual(resolved.required, ['targetType', 'userId']);
});

test('if/then/elseで現在値に応じたfieldを展開する', () => {
  const schema = {
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
    },
    if: {
      properties: {
        enabled: { const: true },
      },
      required: ['enabled'],
    },
    then: {
      properties: {
        channelId: { type: 'string' },
      },
      required: ['channelId'],
    },
    else: {
      properties: {
        disabledReason: { type: 'string' },
      },
    },
  } as unknown as JsonSchema;

  const enabled = resolveSchemaForValue(schema, { enabled: true, channelId: '1' });
  const disabled = resolveSchemaForValue(schema, { enabled: false, disabledReason: 'maintenance' });

  assert.ok(enabled.properties?.channelId);
  assert.equal(enabled.properties?.disabledReason, undefined);
  assert.ok(disabled.properties?.disabledReason);
  assert.equal(disabled.properties?.channelId, undefined);
});

test('anyOfは一致する複数branchをeffective schemaへ統合する', () => {
  const schema = {
    type: 'object',
    anyOf: [
      {
        properties: {
          channelId: { type: 'string' },
        },
      },
      {
        properties: {
          message: { type: 'string' },
        },
      },
    ],
  } as unknown as JsonSchema;

  const resolved = resolveSchemaForValue(schema, {
    channelId: '1',
    message: 'hello',
  });

  assert.ok(resolved.properties?.channelId);
  assert.ok(resolved.properties?.message);
});

test('constを含む条件Schemaの一致判定を行える', () => {
  const condition = {
    type: 'object',
    properties: {
      mode: { const: 'advanced' },
    },
    required: ['mode'],
  } as unknown as JsonSchema;

  assert.equal(schemaMatchesValue(condition, { mode: 'advanced' }), true);
  assert.equal(schemaMatchesValue(condition, { mode: 'simple' }), false);
});

test('選択branch内のnested conditionalを解決してfieldを残す', () => {
  const schema = {
    type: 'object',
    oneOf: [
      {
        properties: {
          mode: { const: 'simple' },
        },
      },
      {
        properties: {
          mode: { const: 'advanced' },
          enabled: { type: 'boolean' },
        },
        if: {
          properties: {
            enabled: { const: true },
          },
          required: ['enabled'],
        },
        then: {
          properties: {
            retryCount: { type: 'integer' },
          },
        },
      },
    ],
  } as unknown as JsonSchema;

  const resolved = resolveSchemaForValue(schema, {
    mode: 'advanced',
    enabled: true,
    retryCount: 3,
  });

  assert.ok(resolved.properties?.retryCount);
});

test('配列itemは要素ごとに異なるconditional schemaを解決できる', () => {
  const itemSchema = {
    type: 'object',
    properties: {
      kind: { type: 'string' },
    },
    if: {
      properties: {
        kind: { const: 'channel' },
      },
      required: ['kind'],
    },
    then: {
      properties: {
        channelId: { type: 'string' },
      },
    },
    else: {
      properties: {
        userId: { type: 'string' },
      },
    },
  } as unknown as JsonSchema;

  const channel = resolveSchemaForArrayItem(itemSchema, { kind: 'channel', channelId: '1' });
  const user = resolveSchemaForArrayItem(itemSchema, { kind: 'user', userId: '2' });

  assert.ok(channel.properties?.channelId);
  assert.equal(channel.properties?.userId, undefined);
  assert.ok(user.properties?.userId);
  assert.equal(user.properties?.channelId, undefined);
});

test('ifが一致してもthen制約を満たさない値はSchema一致扱いにしない', () => {
  const schema = {
    type: 'object',
    if: {
      properties: {
        enabled: { const: true },
      },
      required: ['enabled'],
    },
    then: {
      required: ['channelId'],
      properties: {
        channelId: { type: 'string' },
      },
    },
  } as unknown as JsonSchema;

  assert.equal(schemaMatchesValue(schema, { enabled: true }), false);
  assert.equal(schemaMatchesValue(schema, { enabled: true, channelId: '1' }), true);
});

test('minimumやpatternなどの制約をbranch判定へ利用する', () => {
  const condition = {
    type: 'object',
    properties: {
      retryCount: { type: 'integer', minimum: 1, maximum: 5 },
      prefix: { type: 'string', minLength: 2, maxLength: 4, pattern: '^!' },
    },
  } as unknown as JsonSchema;

  assert.equal(schemaMatchesValue(condition, { retryCount: 3, prefix: '!go' }), true);
  assert.equal(schemaMatchesValue(condition, { retryCount: 8, prefix: '!go' }), false);
  assert.equal(schemaMatchesValue(condition, { retryCount: 3, prefix: 'go' }), false);
});

test('union typeは許可された全typeをbranch判定で受け入れる', () => {
  const schema = { type: ['string', 'integer', 'null'] } as JsonSchema;

  assert.equal(schemaMatchesValue(schema, 'text'), true);
  assert.equal(schemaMatchesValue(schema, 3), true);
  assert.equal(schemaMatchesValue(schema, null), true);
  assert.equal(schemaMatchesValue(schema, false), false);
});

test('branchのproperty制約をbase propertyへ再帰マージする', () => {
  const schema = {
    type: 'object',
    properties: {
      retryCount: {
        type: 'integer',
        title: 'Retry count',
        minimum: 0,
      },
    },
    oneOf: [
      {
        properties: {
          retryCount: { maximum: 10 },
          mode: { const: 'normal' },
        },
      },
      {
        properties: {
          retryCount: { maximum: 100 },
          mode: { const: 'extended' },
        },
      },
    ],
  } as unknown as JsonSchema;

  const resolved = resolveSchemaForValue(schema, { mode: 'normal', retryCount: 5 });
  assert.equal(resolved.properties?.retryCount?.type, 'integer');
  assert.equal(resolved.properties?.retryCount?.title, 'Retry count');
  assert.equal(resolved.properties?.retryCount?.minimum, 0);
  assert.equal(resolved.properties?.retryCount?.maximum, 10);
});

test('branch切替時に既存配列itemへ不足しているnested defaultを補完する', () => {
  const schema = {
    type: 'object',
    oneOf: [
      {
        properties: {
          mode: { const: 'simple' },
        },
      },
      {
        properties: {
          mode: { const: 'advanced' },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean', default: true },
                name: { type: 'string', default: '' },
              },
            },
          },
        },
      },
    ],
  } as unknown as JsonSchema;

  const next = selectSchemaBranch(schema, { mode: 'simple', rules: [{ name: 'rule-1' }] }, 1);
  assert.deepEqual(next, {
    mode: 'advanced',
    rules: [{ enabled: true, name: 'rule-1' }],
  });
});
