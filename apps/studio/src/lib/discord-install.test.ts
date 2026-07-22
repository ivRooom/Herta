import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiscordGuildInstallUrl, DEFAULT_DISCORD_BOT_PERMISSIONS } from './discord-install.ts';

test('Guild Install用のscopeとinstallation contextを設定する', () => {
  const url = new URL(
    buildDiscordGuildInstallUrl({
      clientId: '1521451822521520128',
    }),
  );

  assert.equal(url.origin, 'https://discord.com');
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), '1521451822521520128');
  assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
  assert.equal(url.searchParams.get('integration_type'), '0');
  assert.equal(url.searchParams.get('permissions'), DEFAULT_DISCORD_BOT_PERMISSIONS);
  assert.equal(url.searchParams.has('guild_id'), false);
  assert.equal(url.searchParams.has('disable_guild_select'), false);
});

test('対象Guildを固定したInstall URLを生成する', () => {
  const url = new URL(
    buildDiscordGuildInstallUrl({
      clientId: '1521451822521520128',
      guildId: '123456789012345678',
      permissions: '3072',
    }),
  );

  assert.equal(url.searchParams.get('guild_id'), '123456789012345678');
  assert.equal(url.searchParams.get('disable_guild_select'), 'true');
  assert.equal(url.searchParams.get('permissions'), '3072');
});

const invalidParameters = [
  { name: 'clientId', value: 'not-a-snowflake' },
  { name: 'guildId', value: '123abc' },
  { name: 'permissions', value: '-1' },
] as const;

for (const { name, value } of invalidParameters) {
  test(`${name}が数字以外を含む場合は拒否する`, () => {
    assert.throws(
      () =>
        buildDiscordGuildInstallUrl({
          clientId: name === 'clientId' ? value : '1521451822521520128',
          guildId: name === 'guildId' ? value : undefined,
          permissions: name === 'permissions' ? value : undefined,
        }),
      new RegExp(`${name} must contain only digits`),
    );
  });
}
