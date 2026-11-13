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

/**
 * The daily slot date: the acceptance window for a slot runs 09:00 JST to
 * the next 09:00 JST, so before 09:00 JST the current slot is still the
 * previous calendar day. Claims and answers are attributed to this date;
 * it is the only "today" the admission checks below ever consult.
 */
export function dailyBonusDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid clock');
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (jst.getUTCHours() < 9) jst.setTime(jst.getTime() - 86400000);
  return jst.toISOString().slice(0, 10);
}

/**
 * The JST calendar date. Only the announcement scheduler uses this: a
 * day's announcement is created for the calendar day whose 09:00 JST
 * opens the slot, and a past slot's announcement is never created late.
 */
export function dailyBonusCalendarDate(now: Date): string {
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
