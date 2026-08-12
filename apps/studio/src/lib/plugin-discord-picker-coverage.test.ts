import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllPluginManifests } from '@herta/plugin-catalog';

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  if?: Schema;
  then?: Schema;
  else?: Schema;
  'x-herta-ui'?: {
    widget?: string;
  };
};

const ENTITY_FIELDS: Array<{ pattern: RegExp; widget: string; label: string }> = [
  { pattern: /channelIds?$/i, widget: 'discord-channel', label: 'Channel' },
  { pattern: /roleIds?$/i, widget: 'discord-role', label: 'Role' },
  { pattern: /userIds?$/i, widget: 'discord-user', label: 'User' },
  { pattern: /emojiIds?$/i, widget: 'discord-emoji', label: 'Emoji' },
];

test('公式PluginのDiscord entity ID設定はPickerを使用する', () => {
  const violations: string[] = [];

  for (const manifest of getAllPluginManifests()) {
    inspectSchema(manifest.configSchema as Schema, manifest.id, '$', false, violations);
  }

  assert.deepEqual(
    violations,
    [],
    `ID直接入力になる設定があります:\n${violations.map((item) => `- ${item}`).join('\n')}`,
  );
});

function inspectSchema(
  schema: Schema,
  pluginId: string,
  path: string,
  insideMessageTarget: boolean,
  violations: string[],
): void {
  const messageTarget =
    insideMessageTarget || schema['x-herta-ui']?.widget === 'discord-message-target';

  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const propertyPath = `${path}.${key}`;
    const expected = ENTITY_FIELDS.find(({ pattern }) => pattern.test(key));

    if (expected && !(messageTarget && /^channelId$/i.test(key))) {
      const actualWidget = property['x-herta-ui']?.widget;
      if (actualWidget !== expected.widget) {
        violations.push(
          `${pluginId} ${propertyPath}: ${expected.label} IDは${expected.widget}を指定してください` +
            (actualWidget ? `（現在: ${actualWidget}）` : ''),
        );
      }
    }

    inspectSchema(property, pluginId, propertyPath, messageTarget, violations);
  }

  if (schema.items) inspectSchema(schema.items, pluginId, `${path}[]`, messageTarget, violations);
  for (const [label, branches] of [
    ['oneOf', schema.oneOf],
    ['anyOf', schema.anyOf],
    ['allOf', schema.allOf],
  ] as const) {
    branches?.forEach((branch, index) =>
      inspectSchema(branch, pluginId, `${path}.${label}[${index}]`, messageTarget, violations),
    );
  }

  if (schema.if) inspectSchema(schema.if, pluginId, `${path}.if`, messageTarget, violations);
  if (schema.then) inspectSchema(schema.then, pluginId, `${path}.then`, messageTarget, violations);
  if (schema.else) inspectSchema(schema.else, pluginId, `${path}.else`, messageTarget, violations);
}
