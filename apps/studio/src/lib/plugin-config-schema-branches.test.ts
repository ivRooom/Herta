import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSchemaBranchState,
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
