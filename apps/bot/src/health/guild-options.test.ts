import type { Client } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { loadGuildConfigurationOptions } from './guild-options.js';

const GUILD_ID = '123456789012345678';

function clientWithGuild(guild: unknown): Client {
  return {
    guilds: {
      cache: new Map(guild === null ? [] : [[GUILD_ID, guild]]),
    },
  } as unknown as Client;
}

function guildWithHighestRolePosition(highestRolePosition: number) {
  const me = {
    permissions: { has: () => true },
    roles: { highest: { position: highestRolePosition } },
  };
  return {
    id: GUILD_ID,
    name: 'Herta Test Guild',
    channels: {
      fetch: async () => new Map(),
      fetchActiveThreads: async () => ({ threads: new Map() }),
    },
    roles: {
      fetch: async () =>
        new Map([
          [
            GUILD_ID,
            {
              id: GUILD_ID,
              name: '@everyone',
              hexColor: '#000000',
              position: 0,
              managed: false,
              mentionable: false,
              editable: false,
            },
          ],
          [
            '222222222222222222',
            {
              id: '222222222222222222',
              name: 'Member',
              hexColor: '#5ee6b0',
              position: 2,
              managed: false,
              mentionable: true,
              editable: true,
            },
          ],
        ]),
    },
    emojis: { fetch: async () => new Map() },
    members: { me, fetchMe: async () => me },
  };
}

describe('loadGuildConfigurationOptions', () => {
  it('Bot自身の最高位ロールのpositionをbotスナップショットに含める', async () => {
    const options = await loadGuildConfigurationOptions(
      clientWithGuild(guildWithHighestRolePosition(10)),
      GUILD_ID,
    );

    expect(options?.bot.highestRolePosition).toBe(10);
    expect(options?.roles.map((role) => role.id)).toEqual(['222222222222222222']);
  });

  it('Guildがcacheに無い場合はnullを返す', async () => {
    await expect(
      loadGuildConfigurationOptions(clientWithGuild(null), GUILD_ID),
    ).resolves.toBeNull();
  });
});
