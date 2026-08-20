import type { Client, GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { isAllowedMemberSearchQuery, searchGuildMemberOptions } from './guild-members.js';

const GUILD_ID = '123456789012345678';
const USER_ID = '987654321098765432';

function member(roleIds: string[]): GuildMember {
  return {
    id: USER_ID,
    user: { username: 'herta-user', bot: false },
    displayName: 'Herta User',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png',
    roles: { cache: new Map(roleIds.map((roleId) => [roleId, {}])) },
    guild: { id: GUILD_ID },
  } as unknown as GuildMember;
}

function clientWithMemberFetch(fetchMember: ReturnType<typeof vi.fn>): Client {
  return {
    guilds: {
      cache: new Map([
        [
          GUILD_ID,
          {
            id: GUILD_ID,
            members: { fetch: fetchMember },
          },
        ],
      ]),
    },
  } as unknown as Client;
}

describe('Guild member search query', () => {
  it('2文字以上の名前検索を許可する', () => {
    expect(isAllowedMemberSearchQuery('iv')).toBe(true);
    expect(isAllowedMemberSearchQuery('  Herta  ')).toBe(true);
  });

  it('1文字だけの名前検索は拒否する', () => {
    expect(isAllowedMemberSearchQuery('a')).toBe(false);
    expect(isAllowedMemberSearchQuery(' ')).toBe(false);
  });

  it('Discord Snowflake IDは直接検索を許可する', () => {
    expect(isAllowedMemberSearchQuery('688313716055343104')).toBe(true);
  });

  it('短い数値は全件に近い検索を避けるため拒否する', () => {
    expect(isAllowedMemberSearchQuery('1234')).toBe(true);
    expect(isAllowedMemberSearchQuery('1')).toBe(false);
  });

  it('Snowflake完全一致は検索cacheを使わずDiscordから毎回force fetchする', async () => {
    const fetchMember = vi
      .fn()
      .mockResolvedValueOnce(member(['111111111111111111']))
      .mockResolvedValueOnce(member(['222222222222222222']));
    const client = clientWithMemberFetch(fetchMember);

    const first = await searchGuildMemberOptions(client, GUILD_ID, USER_ID, 1);
    const second = await searchGuildMemberOptions(client, GUILD_ID, USER_ID, 1);

    expect(fetchMember).toHaveBeenCalledTimes(2);
    expect(fetchMember).toHaveBeenNthCalledWith(1, { user: USER_ID, force: true });
    expect(fetchMember).toHaveBeenNthCalledWith(2, { user: USER_ID, force: true });
    expect(first?.[0]?.roleIds).toEqual(['111111111111111111']);
    expect(second?.[0]?.roleIds).toEqual(['222222222222222222']);
  });

  it('Discord Unknown MemberはGuild未所属として空結果を返す', async () => {
    const error = Object.assign(new Error('Unknown Member'), { code: 10_007 });
    const fetchMember = vi.fn().mockRejectedValue(error);

    await expect(
      searchGuildMemberOptions(clientWithMemberFetch(fetchMember), GUILD_ID, USER_ID, 1),
    ).resolves.toEqual([]);
  });

  it('Discord transport障害はMember不在へ変換せず上位へ伝播する', async () => {
    const fetchMember = vi.fn().mockRejectedValue(new Error('network unavailable'));

    await expect(
      searchGuildMemberOptions(clientWithMemberFetch(fetchMember), GUILD_ID, USER_ID, 1),
    ).rejects.toThrow('network unavailable');
  });
});
