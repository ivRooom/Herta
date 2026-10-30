import { describe, expect, it } from 'vitest';
import { Collection, type Guild, type GuildMember } from 'discord.js';
import { captureDailyBonusPopulation } from './daily-bonus-population.js';

describe('fresh announcement population', () => {
  it('counts only nonbot holders from the completed fetch, including a verified zero', async () => {
    const members = new Collection<string, GuildMember>();
    for (const [id, bot, eligible] of [
      ['human', false, true],
      ['bot', true, true],
      ['other', false, false],
    ] as const)
      members.set(id, {
        user: { bot },
        roles: { cache: new Map(eligible ? [['role', {}]] : []) },
      } as unknown as GuildMember);
    const guild = { members: { fetch: async () => members } } as unknown as Guild;
    expect((await captureDailyBonusPopulation(guild, 'role'))?.count).toBe(1);
    expect((await captureDailyBonusPopulation(guild, 'missing'))?.count).toBe(0);
  });
  it('returns unknown on failure or timeout instead of using a partial cache', async () => {
    const failed = {
      members: {
        fetch: async () => {
          throw new Error('missing intent');
        },
      },
    } as unknown as Guild;
    expect(await captureDailyBonusPopulation(failed, 'role')).toBeNull();
    const stalled = { members: { fetch: () => new Promise(() => {}) } } as unknown as Guild;
    expect(await captureDailyBonusPopulation(stalled, 'role', 5)).toBeNull();
  });
});
