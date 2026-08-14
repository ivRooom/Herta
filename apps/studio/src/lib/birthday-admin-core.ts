export const BIRTHDAY_ADMIN_DISCORD_ID_PATTERN = /^\d{17,20}$/u;

export interface BirthdayRegistration {
  userId: string;
  month: number;
  day: number;
}

export interface BirthdayMemberCandidate {
  id: string;
  bot: boolean;
}

export type BirthdayMemberEligibility = 'eligible' | 'not-found' | 'bot';

export type BirthdayAdminAction = 'set' | 'remove';

export interface BirthdayAdminRequest {
  action: BirthdayAdminAction;
  userId: string;
  month: number | null;
  day: number | null;
}

export function daysInBirthdayMonth(month: number): number {
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number.isInteger(month) && month >= 1 && month <= 12 ? (days[month - 1] ?? 0) : 0;
}

export function isValidBirthdayDate(month: number, day: number): boolean {
  const maxDay = daysInBirthdayMonth(month);
  return Number.isInteger(day) && day >= 1 && day <= maxDay;
}

export function birthdayMemberEligibility(
  userId: string,
  members: readonly BirthdayMemberCandidate[],
): BirthdayMemberEligibility {
  const member = members.find((candidate) => candidate.id === userId);
  if (!member) return 'not-found';
  return member.bot ? 'bot' : 'eligible';
}

export function sortBirthdayRegistrations(
  registrations: readonly BirthdayRegistration[],
): BirthdayRegistration[] {
  return [...registrations].sort(
    (left, right) =>
      left.month - right.month || left.day - right.day || left.userId.localeCompare(right.userId),
  );
}

export function filterBirthdayRegistrations(
  registrations: readonly BirthdayRegistration[],
  query: string,
  month: number | null,
): BirthdayRegistration[] {
  const normalizedQuery = query.trim();
  return sortBirthdayRegistrations(
    registrations.filter((registration) => {
      if (month !== null && registration.month !== month) return false;
      if (normalizedQuery && !registration.userId.includes(normalizedQuery)) return false;
      return true;
    }),
  );
}

export function buildBirthdayCsv(registrations: readonly BirthdayRegistration[]): string {
  const rows = sortBirthdayRegistrations(registrations).map(
    (registration) => `${registration.userId},${registration.month},${registration.day}`,
  );
  return ['discord_user_id,month,day', ...rows].join('\n');
}

export function parseBirthdayAdminRequest(value: unknown): BirthdayAdminRequest | null {
  if (!isRecord(value)) return null;
  if (value.action !== 'set' && value.action !== 'remove') return null;

  const userId = typeof value.userId === 'string' ? value.userId.trim() : '';
  if (!BIRTHDAY_ADMIN_DISCORD_ID_PATTERN.test(userId)) return null;

  if (value.action === 'remove') {
    return { action: 'remove', userId, month: null, day: null };
  }

  const month = toInteger(value.month);
  const day = toInteger(value.day);
  if (month === null || day === null || !isValidBirthdayDate(month, day)) return null;
  return { action: 'set', userId, month, day };
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
