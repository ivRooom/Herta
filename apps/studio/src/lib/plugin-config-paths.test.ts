import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configPathAncestorPaths,
  filterPluginConfigByReadablePaths,
  listConcretePluginConfigValues,
  pluginConfigPermissionFields,
  resolvePluginConfigPermissionPath,
} from './plugin-config-paths.ts';

const schema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean', title: '有効化' },
    limits: {
      type: 'object',
      title: '閾値',
      properties: {
        burst: { type: 'integer', title: '連投上限' },
        duplicate: { type: 'integer', title: '重複上限' },
      },
    },
    policies: {
      type: 'array',
      title: '自動対応ポリシー',
      items: {
        type: 'object',
        properties: {
          selector: { type: 'string', title: 'ルール' },
          action: { type: 'string', title: 'Action' },
          severity: { type: 'string', title: '危険度' },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

test('objectとarray<object>を設定パスへ展開する', () => {
  assert.deepEqual(
    pluginConfigPermissionFields(schema).map((field) => field.path),
    [
      'enabled',
      'limits',
      'limits.burst',
      'limits.duplicate',
      'policies',
      'policies[].selector',
      'policies[].action',
      'policies[].severity',
    ],
  );
});

test('concrete array indexをcanonical IAM pathへ正規化する', () => {
  assert.equal(
    resolvePluginConfigPermissionPath(schema, ['policies', 0, 'action']),
    'policies[].action',
  );
  assert.equal(resolvePluginConfigPermissionPath(schema, ['limits', 'burst']), 'limits.burst');
  assert.equal(resolvePluginConfigPermissionPath(schema, ['policies', 0]), null);
  assert.equal(resolvePluginConfigPermissionPath(schema, ['missing']), null);
});

test('設定パスの親Resourceを列挙する', () => {
  assert.deepEqual(configPathAncestorPaths('policies[].action'), ['policies', 'policies[].action']);
  assert.deepEqual(configPathAncestorPaths('limits.burst'), ['limits', 'limits.burst']);
});

test('readable pathだけを残しarray shapeを保つ', () => {
  const config = {
    enabled: true,
    limits: { burst: 5, duplicate: 3 },
    policies: [
      { selector: 'invite', action: 'delete', severity: 'high' },
      { selector: 'spam', action: 'timeout', severity: 'medium' },
    ],
  };
  const readable = new Set(['enabled', 'limits.burst', 'policies[].action']);
  assert.deepEqual(
    filterPluginConfigByReadablePaths(config, schema, (path) => readable.has(path)),
    {
      enabled: true,
      limits: { burst: 5 },
      policies: [{ action: 'delete' }, { action: 'timeout' }],
    },
  );
});

test('visible configからarray index付き編集pathを生成する', () => {
  const values = listConcretePluginConfigValues(
    {
      policies: [
        { action: 'delete' },
        { action: 'timeout' },
      ],
    },
    schema,
  );
  assert.deepEqual(
    values.map((entry) => ({ path: entry.path, permissionPath: entry.permissionPath, value: entry.value })),
    [
      { path: ['policies', 0, 'action'], permissionPath: 'policies[].action', value: 'delete' },
      { path: ['policies', 1, 'action'], permissionPath: 'policies[].action', value: 'timeout' },
    ],
  );
});
