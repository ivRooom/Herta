import { searchGuildMembers } from './bot-guild-members.ts';
import {
  birthdaySelfRegistrationEligibility,
  birthdaySelfRegistrationEnabled,
  type BirthdaySelfRegistrationEligibility,
} from './birthday-self-registration-core.ts';
import { getGuildPlugin } from './guild-plugins.ts';

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;

type BirthdaySelfRegistrationDenialReason = Exclude<
  BirthdaySelfRegistrationEligibility,
  'eligible'
>;

export type BirthdaySelfRegistrationAccess =
  | { ok: true; displayName: string; registrationEnabled: boolean }
  | { ok: false; reason: BirthdaySelfRegistrationDenialReason | 'unavailable' };

export async function resolveBirthdaySelfRegistrationAccess(
  guildId: string,
  userId: string,
): Promise<BirthdaySelfRegistrationAccess> {
  if (!DISCORD_ID_PATTERN.test(guildId) || !DISCORD_ID_PATTERN.test(userId)) {
    return { ok: false, reason: 'not-member' };
  }

  try {
    const [members, plugin] = await Promise.all([
      searchGuildMembers(guildId, userId, 1),
      getGuildPlugin(guildId, 'birthday-role'),
    ]);
    if (members === null || !plugin) {
      return { ok: false, reason: 'unavailable' };
    }

    const member = members.find((candidate) => candidate.id === userId) ?? null;
    const eligibility = birthdaySelfRegistrationEligibility(userId, member);
    if (eligibility !== 'eligible') return { ok: false, reason: eligibility };

    return {
      ok: true,
      displayName: member?.displayName ?? userId,
      registrationEnabled: birthdaySelfRegistrationEnabled(plugin),
    };
  } catch (error) {
    console.error('Birthday self registration access check failed', {
      guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { ok: false, reason: 'unavailable' };
  }
}
