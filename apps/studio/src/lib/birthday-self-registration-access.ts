import { searchGuildMembers } from './bot-guild-members.ts';
import { getGuildPlugin } from './guild-plugins.ts';
import {
  birthdaySelfRegistrationEligibility,
  isBirthdaySelfRegistrationAllowed,
  type BirthdaySelfRegistrationEligibility,
} from './birthday-self-registration-core.ts';

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;

export type BirthdaySelfRegistrationAccess =
  | { ok: true; displayName: string; allowSelfRegistration: boolean }
  | { ok: false; reason: BirthdaySelfRegistrationEligibility | 'unavailable' };

export async function resolveBirthdaySelfRegistrationAccess(
  guildId: string,
  userId: string,
): Promise<BirthdaySelfRegistrationAccess> {
  if (!DISCORD_ID_PATTERN.test(guildId) || !DISCORD_ID_PATTERN.test(userId)) {
    return { ok: false, reason: 'not-member' };
  }

  // Shared registration is intentionally based on current Guild membership, not a pre-existing
  // Birthday record or a fixed role name. Exact ID lookup remains the server-side authorization gate.
  const [members, plugin] = await Promise.all([
    searchGuildMembers(guildId, userId, 1),
    getGuildPlugin(guildId, 'birthday-role'),
  ]);
  if (members === null) {
    return { ok: false, reason: 'unavailable' };
  }

  const member = members.find((candidate) => candidate.id === userId) ?? null;
  const eligibility = birthdaySelfRegistrationEligibility(userId, member);
  if (eligibility !== 'eligible') return { ok: false, reason: eligibility };

  return {
    ok: true,
    displayName: member?.displayName ?? userId,
    allowSelfRegistration: isBirthdaySelfRegistrationAllowed(plugin?.config ?? {}),
  };
}
