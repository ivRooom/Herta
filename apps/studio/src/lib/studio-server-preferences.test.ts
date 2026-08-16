import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultStudioServerPreferences,
  parseStudioServerPreferences,
  resolveSelectedGuildId,
  serializeStudioServerPreferences,
} from './studio-server-preferences.ts';

const GUILD_A = '123456789012345678';
const GUILD_B = '223456789012345678';
const GUILD_C = '323456789012345678';

test('選択中Guildはroute → session → default → 先頭の優先順で解決する', () => {
  assert.equal(
    resolveSelectedGuildId({
      guildIds: [GUILD_A, GUILD_B, GUILD_C],
      routeGuildId: GUILD_C,
      sessionGuildId: GUILD_B,
      defaultGuildId: GUILD_A,
    }),
    GUILD_C,
  );
  assert.equal(
    resolveSelectedGuildId({
      guildIds: [GUILD_A, GUILD_B],
      sessionGuildId: GUILD_B,
      defaultGuildId: GUILD_A,
    }),
    GUILD_B,
  );
  assert.equal(
    resolveSelectedGuildId({ guildIds: [GUILD_A, GUILD_B], defaultGuildId: GUILD_B }),
    GUILD_B,
  );
  assert.equal(resolveSelectedGuildId({ guildIds: [GUILD_A, GUILD_B] }), GUILD_A);
});

test('管理対象外・不正なGuild IDは選択候補から除外する', () => {
  assert.equal(
    resolveSelectedGuildId({
      guildIds: [GUILD_A, GUILD_A, 'invalid'],
      routeGuildId: GUILD_B,
      sessionGuildId: '123',
      defaultGuildId: GUILD_C,
    }),
    GUILD_A,
  );
  assert.equal(resolveSelectedGuildId({ guildIds: [] }), null);
});

test('Studioサーバー設定を安全にserialize / parseできる', () => {
  const serialized = serializeStudioServerPreferences({ version: 1, defaultGuildId: GUILD_B });
  assert.deepEqual(parseStudioServerPreferences(serialized), {
    version: 1,
    defaultGuildId: GUILD_B,
  });
});

test('壊れた・旧version・巨大な設定はデフォルトへ戻す', () => {
  const expected = createDefaultStudioServerPreferences();
  assert.deepEqual(parseStudioServerPreferences('{'), expected);
  assert.deepEqual(parseStudioServerPreferences('{"version":2,"defaultGuildId":null}'), expected);
  assert.deepEqual(parseStudioServerPreferences('x'.repeat(513)), expected);
  assert.deepEqual(
    parseStudioServerPreferences('{"version":1,"defaultGuildId":"not-a-guild"}'),
    expected,
  );
});
