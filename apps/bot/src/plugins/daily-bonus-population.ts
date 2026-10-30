import type { Guild } from 'discord.js';

/** Fresh full-roster fetch only. Partial caches must never become a denominator. */
export async function captureDailyBonusPopulation(
  guild: Pick<Guild, 'members'>,
  roleId: string,
  timeoutMs = 10000,
): Promise<{ count: number; capturedAt: Date } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const members = await Promise.race([
      guild.members.fetch({ time: timeoutMs }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PopulationFetchTimeout')), timeoutMs);
      }),
    ]);
    return {
      count: members.filter((member) => !member.user.bot && member.roles.cache.has(roleId)).size,
      capturedAt: new Date(),
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
