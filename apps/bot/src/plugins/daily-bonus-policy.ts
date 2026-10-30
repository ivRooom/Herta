/** Admission checks only. The canonical Web ledger owns rewards and deduplication. */
export interface DailyBonusAdmission {
  enabled: boolean;
  configuredGuildId: string;
  interactionGuildId: string | null;
  configuredRoleId: string;
  memberRoleIds: readonly string[];
  announcementMessageId: string;
  interactionMessageId: string;
  announcementDate: string;
  announcementStatus: 'sent' | 'pending' | 'failed' | 'disabled';
  now: Date;
}

export type DailyBonusRejection = 'disabled' | 'guild' | 'role' | 'message' | 'expired';

export function dailyBonusDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid clock');
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function rejectDailyBonus(input: DailyBonusAdmission): DailyBonusRejection | null {
  if (!input.enabled) return 'disabled';
  if (!input.configuredGuildId || input.interactionGuildId !== input.configuredGuildId)
    return 'guild';
  if (!input.configuredRoleId || !input.memberRoleIds.includes(input.configuredRoleId))
    return 'role';
  if (
    !input.announcementMessageId ||
    input.announcementStatus !== 'sent' ||
    input.interactionMessageId !== input.announcementMessageId
  )
    return 'message';
  if (!Number.isFinite(input.now.getTime())) return 'expired';
  const date = dailyBonusDate(input.now);
  const opensAt = Date.parse(`${date}T09:00:00+09:00`);
  if (input.announcementDate !== date || input.now.getTime() < opensAt) return 'expired';
  return null;
}

/** Never parse mentions from operator-controlled text. */
export function dailyBonusAllowedMentions(roleId: string) {
  if (!/^\d{17,20}$/.test(roleId)) throw new Error('Invalid notification role');
  return { parse: [] as const, roles: [roleId], users: [], repliedUser: false };
}
