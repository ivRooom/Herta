import assert from 'node:assert/strict';
import test from 'node:test';

import { getAllPluginManifests } from '@herta/plugin-catalog';

import { createPluginConfigAjv } from './plugin-config-ajv.ts';

type ConfigSchema = {
  properties: Record<string, { default?: unknown }>;
  required?: string[];
};

function activityRulesSchema(): ConfigSchema {
  const manifest = getAllPluginManifests().find((item) => item.id === 'activity-rules');
  assert.ok(manifest, 'activity-rules manifest が見つかりません');
  return manifest.configSchema as ConfigSchema;
}

/**
 * excludedGameActivityNames を追加する前に保存されたGuild設定を模す。
 * 全プロパティの既定値から、このキーだけを欠いた形にする。
 */
function legacyConfigWithoutExcludedNames(schema: ConfigSchema): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(schema.properties)) {
    if (key === 'excludedGameActivityNames') continue;
    config[key] = structuredClone(property.default);
  }
  return config;
}

test('excludedGameActivityNamesはrequiredに入っていない (#980)', () => {
  const schema = activityRulesSchema();
  assert.equal(schema.required?.includes('excludedGameActivityNames') ?? false, false);
  // 新規・リセット時の既定値は維持される
  assert.deepEqual(schema.properties.excludedGameActivityNames?.default, ['Valorant Tracker App']);
});

test('キーを持たない既存のactivity-rules設定でも無関係な項目を保存できる (#980)', () => {
  const schema = activityRulesSchema();
  const ajv = createPluginConfigAjv();
  const validate = ajv.compile(schema);

  const candidate = legacyConfigWithoutExcludedNames(schema);
  // 無関係な項目の変更を模す
  candidate.messageCooldownSeconds = 15;

  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  // 検証時に既定値が補われ、除外リストの既定が効く
  assert.deepEqual(candidate.excludedGameActivityNames, ['Valorant Tracker App']);
});

test('新規設定は既定の除外リストで検証を通る (#980)', () => {
  const schema = activityRulesSchema();
  const ajv = createPluginConfigAjv();
  const validate = ajv.compile(schema);

  const candidate: Record<string, unknown> = {};
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  assert.deepEqual(candidate.excludedGameActivityNames, ['Valorant Tracker App']);
});

test('excludedGameApplicationIdsはrequiredに入っておらず既定は空 (#1060)', () => {
  const schema = activityRulesSchema();
  assert.equal(schema.required?.includes('excludedGameApplicationIds') ?? false, false);
  assert.deepEqual(schema.properties.excludedGameApplicationIds?.default, []);

  const ajv = createPluginConfigAjv();
  const validate = ajv.compile(schema);
  const candidate: Record<string, unknown> = {};
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  assert.deepEqual(candidate.excludedGameApplicationIds, []);
});
