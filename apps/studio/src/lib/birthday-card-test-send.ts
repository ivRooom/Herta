import { BIRTHDAY_ADMIN_DISCORD_ID_PATTERN } from './birthday-admin-core';

export type BirthdayCardTestUserIdResult =
  | { ok: true; userId: string | null }
  | { ok: false };

export function parseBirthdayCardTestUserId(value: unknown): BirthdayCardTestUserIdResult {
  if (value === null || value === undefined || value === '') {
    return { ok: true, userId: null };
  }
  if (typeof value !== 'string') return { ok: false };
  const userId = value.trim();
  if (!userId) return { ok: true, userId: null };
  return BIRTHDAY_ADMIN_DISCORD_ID_PATTERN.test(userId)
    ? { ok: true, userId }
    : { ok: false };
}
