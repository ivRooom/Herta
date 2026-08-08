import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDiscordMessageUrl,
  normalizeDiscordMessageTarget,
  parseDiscordMessageReference,
} from './discord-message-target.ts';
import {
  applySchemaDefaults,
  fieldMatchesSearch,
  makeDefaultValue,
  moveArrayItem,
  normalizeConfigForStudio,
  parseConfigJson,
  removeConfigValue,
  resolveArrayItemBounds,
  stringifyConfig,
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

test('array minItems/maxItemsを安全なUI境界へ解決する', () => {
  assert.deepEqual(resolveArrayItemBounds({ type: 'array', minItems: 2, maxItems: 5 }), {
    minItems: 2,
    maxItems: 5,
  });
  assert.deepEqual(resolveArrayItemBounds({ type: 'array', minItems: 3, maxItems: 1 }), {
    minItems: 3,
    maxItems: 3,
  });
  assert.deepEqual(resolveArrayItemBounds({ type: 'array', minItems: -1, maxItems: -1 }), {
    minItems: 0,
    maxItems: undefined,
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

test('Advanced JSON往復でもSchema外の既存キーを保持する', () => {
  const original = normalizeConfigForStudio(schema, {
    retries: 8,
    futurePluginSetting: { mode: 'experimental', flags: ['a', 'b'] },
  });
  const roundTrip = normalizeConfigForStudio(schema, parseConfigJson(stringifyConfig(original)));

  assert.deepEqual(roundTrip.futurePluginSetting, {
    mode: 'experimental',
    flags: ['a', 'b'],
  });
  assert.equal(roundTrip.retries, 8);
});

test('Discord Picker用metadataをSchema互換のまま保持できる', () => {
  const channelSchema: JsonSchema = {
    type: ['string', 'null'],
    title: '通知チャンネル',
    ['x-herta-ui']: {
      widget: 'discord-channel',
      placeholder: 'チャンネルを検索',
    },
  };
  const roleSchema: JsonSchema = {
    type: 'array',
    items: { type: 'string' },
    ['x-herta-ui']: {
      widget: 'discord-role',
      multiple: true,
      editableOnly: true,
      mentionableOnly: false,
    },
  };

  assert.equal(channelSchema['x-herta-ui']?.widget, 'discord-channel');
  assert.equal(channelSchema['x-herta-ui']?.placeholder, 'チャンネルを検索');
  assert.equal(roleSchema['x-herta-ui']?.widget, 'discord-role');
  assert.equal(roleSchema['x-herta-ui']?.multiple, true);
  assert.equal(roleSchema['x-herta-ui']?.editableOnly, true);
});

test('Discord Picker付きSchemaでも保存済みIDを変換せず保持する', () => {
  const discordSchema: JsonSchema = {
    type: 'object',
    properties: {
      channelId: {
        type: ['string', 'null'],
        default: null,
        ['x-herta-ui']: { widget: 'discord-channel' },
      },
      roleIds: {
        type: 'array',
        items: { type: 'string' },
        default: [],
        ['x-herta-ui']: { widget: 'discord-role', multiple: true },
      },
    },
  };

  const current = {
    channelId: '1175075504940908635',
    roleIds: ['964326043420872706', '964326043420872707'],
  };
  assert.deepEqual(normalizeConfigForStudio(discordSchema, current), current);
  assert.deepEqual(parseConfigJson(stringifyConfig(current)), current);
});

test('multiple metadataはstring SchemaのJSON型を配列へ変更しない', () => {
  const malformedUiSchema: JsonSchema = {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        default: '1175075504940908635',
        ['x-herta-ui']: { widget: 'discord-channel', multiple: true },
      },
    },
  };

  const normalized = normalizeConfigForStudio(malformedUiSchema, {
    channelId: '1175075504940908635',
  });
  assert.equal(normalized.channelId, '1175075504940908635');
  assert.equal(Array.isArray(normalized.channelId), false);
});

test('Discord Message Target metadataと保存objectを保持する', () => {
  const messageTargetSchema: JsonSchema = {
    type: 'object',
    properties: {
      channelId: { type: 'string' },
      messageId: { type: 'string' },
    },
    required: ['channelId', 'messageId'],
    ['x-herta-ui']: { widget: 'discord-message-target' },
  };
  const current = {
    channelId: '1175075504940908635',
    messageId: '1175075504940908636',
  };

  assert.equal(messageTargetSchema['x-herta-ui']?.widget, 'discord-message-target');
  assert.deepEqual(normalizeConfigForStudio(messageTargetSchema, current), current);
  assert.deepEqual(normalizeDiscordMessageTarget({ ...current, unexpected: true }), current);
});

test('Discord message URLは同じGuildのChannel/Message IDへ変換する', () => {
  const guildId = '964326043420872704';
  const channelId = '1175075504940908635';
  const messageId = '1175075504940908636';

  assert.deepEqual(
    parseDiscordMessageReference(
      `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
      guildId,
    ),
    { channelId, messageId },
  );
  assert.equal(
    parseDiscordMessageReference(
      `https://discord.com/channels/964326043420872799/${channelId}/${messageId}`,
      guildId,
    ),
    null,
  );
  assert.equal(
    buildDiscordMessageUrl(guildId, { channelId, messageId }),
    `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
  );
});

test('Discord以外のURLと不完全なmessage URLを拒否する', () => {
  const guildId = '964326043420872704';
  const channelId = '1175075504940908635';
  const messageId = '1175075504940908636';

  assert.equal(
    parseDiscordMessageReference(
      `https://example.com/channels/${guildId}/${channelId}/${messageId}`,
      guildId,
    ),
    null,
  );
  assert.equal(
    parseDiscordMessageReference(`https://discord.com/channels/${guildId}/${channelId}`, guildId),
    null,
  );
});

test('Message ID単体は選択済みChannelがある場合だけ受け入れる', () => {
  const guildId = '964326043420872704';
  const channelId = '1175075504940908635';
  const messageId = '1175075504940908636';

  assert.deepEqual(parseDiscordMessageReference(messageId, guildId, channelId), {
    channelId,
    messageId,
  });
  assert.equal(parseDiscordMessageReference(messageId, guildId), null);
});

test('検索は親・子のtitle/descriptionを対象にする', () => {
  assert.equal(fieldMatchesSearch('nested', schema.properties?.nested ?? {}, '表示名'), true);
  assert.equal(fieldMatchesSearch('rules', schema.properties?.rules ?? {}, '存在しない'), false);
});

test('undefinedにはSchema defaultが適用される', () => {
  assert.equal(applySchemaDefaults({ type: 'integer', default: 5 }, undefined), 5);
});
