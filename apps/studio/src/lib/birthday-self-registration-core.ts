import { isValidBirthdayDate, isValidBirthYear } from './birthday-admin-core.ts';

export const BIRTHDAY_SELF_REGISTRATION_MEMBER_ROLE_NAME = 'Member';

const INVALID_INTEGER = Symbol('invalid-integer');

export interface BirthdaySelfRegistrationRequest {
  month: number;
  day: number;
  birthYear: number | null;
}

export interface BirthdaySelfRegistrationMember {
  id: string;
  bot: boolean;
  roleIds: readonly string[];
}

export interface BirthdaySelfRegistrationRole {
  id: string;
  name: string;
}

export type BirthdaySelfRegistrationEligibility =
  'eligible' | 'not-member' | 'bot' | 'member-role-missing';

export function parseBirthdaySelfRegistrationRequest(
  value: unknown,
  currentYear = new Date().getUTCFullYear(),
): BirthdaySelfRegistrationRequest | null {
  if (!isRecord(value)) return null;

  const month = toInteger(value.month);
  const day = toInteger(value.day);
  if (month === null || day === null || !isValidBirthdayDate(month, day)) return null;

  const birthYear = emptyToNullInteger(value.birthYear);
  if (birthYear === INVALID_INTEGER) return null;
  if (birthYear !== null && !isValidBirthYear(birthYear, currentYear)) return null;

  return { month, day, birthYear };
}

export function birthdaySelfRegistrationEligibility(
  userId: string,
  member: BirthdaySelfRegistrationMember | null,
  roles: readonly BirthdaySelfRegistrationRole[],
  requiredRoleName = BIRTHDAY_SELF_REGISTRATION_MEMBER_ROLE_NAME,
): BirthdaySelfRegistrationEligibility {
  if (!member || member.id !== userId) return 'not-member';
  if (member.bot) return 'bot';

  const requiredRoleIds = new Set(
    roles.filter((role) => role.name === requiredRoleName).map((role) => role.id),
  );
  if (requiredRoleIds.size === 0) return 'member-role-missing';
  if (member.roleIds.some((roleId) => requiredRoleIds.has(roleId))) return 'eligible';
  return 'member-role-missing';
}

function emptyToNullInteger(value: unknown): number | null | typeof INVALID_INTEGER {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return toInteger(value) ?? INVALID_INTEGER;
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
