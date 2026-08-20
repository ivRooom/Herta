import { searchGuildMembers } from './bot-guild-members.ts';
import { getGuildConfigurationOptions } from './bot-guild-options.ts';
import {
  birthdaySelfRegistrationEligibility,
  type BirthdaySelfRegistrationEligibility,
} from './birthday-self-registration-core.ts';

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;

export type BirthdaySelfRegistrationAccess =
  | { ok: true; displayName: string }
  | { ok: false; reason: BirthdaySelfRegistrationEligibility | 'unavailable' };

export async function resolveBirthdaySelfRegistrationAccess(
  guildId: string,
  userId: string,
): Promise<BirthdaySelfRegistrationAccess> {
  if (!DISCORD_ID_PATTERN.test(guildId) || !DISCORD_ID_PATTERN.test(userId)) {
    return { ok: false, reason: 'not-member' };
  }

  const [members, options] = await Promise.all([
    searchGuildMembers(guildId, userId, 1),
    getGuildConfigurationOptions(guildId),
  ]);
  if (members === null || options === null) {
    return { ok: false, reason: 'unavailable' };
  }

  const member = members.find((candidate) => candidate.id === userId) ?? null;
  const eligibility = birthdaySelfRegistrationEligibility(userId, member, options.roles);
  if (eligibility !== 'eligible') return { ok: false, reason: eligibility };

  return { ok: true, displayName: member?.displayName ?? userId };
}
