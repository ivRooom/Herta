import { describe, expect, it } from 'vitest';
import {
  buildDiscordGuildInstallUrl,
  DEFAULT_DISCORD_BOT_PERMISSIONS,
} from './discord-install';

describe('buildDiscordGuildInstallUrl', () => {
  it('Guild Install用のscopeとinstallation contextを設定する', () => {
    const url = new URL(
      buildDiscordGuildInstallUrl({
        clientId: '1521451822521520128',
      }),
    );

    expect(url.origin).toBe('https://discord.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('1521451822521520128');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('integration_type')).toBe('0');
    expect(url.searchParams.get('permissions')).toBe(DEFAULT_DISCORD_BOT_PERMISSIONS);
    expect(url.searchParams.has('guild_id')).toBe(false);
    expect(url.searchParams.has('disable_guild_select')).toBe(false);
  });

  it('対象Guildを固定したInstall URLを生成する', () => {
    const url = new URL(
      buildDiscordGuildInstallUrl({
        clientId: '1521451822521520128',
        guildId: '123456789012345678',
        permissions: '3072',
      }),
    );

    expect(url.searchParams.get('guild_id')).toBe('123456789012345678');
    expect(url.searchParams.get('disable_guild_select')).toBe('true');
    expect(url.searchParams.get('permissions')).toBe('3072');
  });

  it.each([
    { name: 'clientId', value: 'not-a-snowflake' },
    { name: 'guildId', value: '123abc' },
    { name: 'permissions', value: '-1' },
  ])('$nameが数字以外を含む場合は拒否する', ({ name, value }) => {
    expect(() =>
      buildDiscordGuildInstallUrl({
        clientId: name === 'clientId' ? value : '1521451822521520128',
        guildId: name === 'guildId' ? value : undefined,
        permissions: name === 'permissions' ? value : undefined,
      }),
    ).toThrow(`${name} must contain only digits`);
  });
});
