import { prisma } from '@/lib/db';
import {
  BIRTHDAY_ADMIN_DISCORD_ID_PATTERN,
  isValidBirthdayDate,
  isValidBirthYear,
  type BirthdayRegistration,
} from './birthday-admin-core';

export class BirthdayAdminValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BirthdayAdminValidationError';
  }
}

export async function listBirthdayRegistrations(guildId: string): Promise<BirthdayRegistration[]> {
  return prisma.$queryRaw<BirthdayRegistration[]>`
    SELECT
      registrations."user_id" AS "userId",
      registrations."month",
      registrations."day",
      registrations."birth_year" AS "birthYear",
      latest."age" AS "latestAge",
      latest."server_birthday_number" AS "latestServerBirthdayNumber",
      COALESCE(stats."celebrationCount", 0)::INTEGER AS "celebrationCount"
    FROM "birthday_registrations" registrations
    LEFT JOIN LATERAL (
      SELECT "age", "server_birthday_number"
      FROM "birthday_celebrations"
      WHERE "guild_id" = registrations."guild_id"
        AND "user_id" = registrations."user_id"
      ORDER BY "local_date" DESC
      LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INTEGER AS "celebrationCount"
      FROM "birthday_celebrations"
      WHERE "guild_id" = registrations."guild_id"
        AND "user_id" = registrations."user_id"
    ) stats ON TRUE
    WHERE registrations."guild_id" = ${guildId}
    ORDER BY registrations."month" ASC, registrations."day" ASC, registrations."user_id" ASC
  `;
}

export async function getBirthdayRegistration(
  guildId: string,
  userId: string,
): Promise<BirthdayRegistration | null> {
  if (!BIRTHDAY_ADMIN_DISCORD_ID_PATTERN.test(userId)) return null;

  const registrations = await prisma.$queryRaw<BirthdayRegistration[]>`
    SELECT
      "user_id" AS "userId",
      "month",
      "day",
      "birth_year" AS "birthYear"
    FROM "birthday_registrations"
    WHERE "guild_id" = ${guildId}
      AND "user_id" = ${userId}
    LIMIT 1
  `;
  return registrations[0] ?? null;
}

export async function setBirthdayRegistration(input: {
  guildId: string;
  actorId: string;
  userId: string;
  month: number;
  day: number;
  birthYear: number | null;
}): Promise<BirthdayRegistration> {
  assertBirthdayInput(input.userId, input.month, input.day, input.birthYear);

  return prisma.$transaction(async (tx) => {
    const previous = await tx.$queryRaw<
      Array<{ month: number; day: number; birthYear: number | null }>
    >`
      SELECT "month", "day", "birth_year" AS "birthYear"
      FROM "birthday_registrations"
      WHERE "guild_id" = ${input.guildId} AND "user_id" = ${input.userId}
      LIMIT 1
    `;

    await tx.$executeRaw`
      INSERT INTO "birthday_registrations" (
        "guild_id", "user_id", "month", "day", "birth_year", "updated_at"
      ) VALUES (
        ${input.guildId}, ${input.userId}, ${input.month}, ${input.day}, ${input.birthYear}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("guild_id", "user_id") DO UPDATE SET
        "month" = EXCLUDED."month",
        "day" = EXCLUDED."day",
        "birth_year" = EXCLUDED."birth_year",
        "updated_at" = CURRENT_TIMESTAMP
    `;

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'birthday.registration_set',
        targetType: 'birthday_registration',
        targetId: input.userId,
        severity: 'info',
        changes: {
          before: previous[0]
            ? {
                month: previous[0].month,
                day: previous[0].day,
                hasBirthYear: previous[0].birthYear !== null,
              }
            : null,
          after: { month: input.month, day: input.day, hasBirthYear: input.birthYear !== null },
        },
        metadata: { operationSource: 'dashboard' },
      },
    });

    return {
      userId: input.userId,
      month: input.month,
      day: input.day,
      birthYear: input.birthYear,
    };
  });
}

export async function removeBirthdayRegistration(input: {
  guildId: string;
  actorId: string;
  userId: string;
}): Promise<boolean> {
  if (!BIRTHDAY_ADMIN_DISCORD_ID_PATTERN.test(input.userId)) {
    throw new BirthdayAdminValidationError('DiscordユーザーIDが不正です');
  }

  return prisma.$transaction(async (tx) => {
    const previous = await tx.$queryRaw<
      Array<{ month: number; day: number; birthYear: number | null }>
    >`
      SELECT "month", "day", "birth_year" AS "birthYear"
      FROM "birthday_registrations"
      WHERE "guild_id" = ${input.guildId} AND "user_id" = ${input.userId}
      LIMIT 1
    `;
    const deleted = await tx.$executeRaw`
      DELETE FROM "birthday_registrations"
      WHERE "guild_id" = ${input.guildId} AND "user_id" = ${input.userId}
    `;
    const changed = Number(deleted) > 0;

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'birthday.registration_remove',
        targetType: 'birthday_registration',
        targetId: input.userId,
        severity: 'info',
        changes: {
          before: previous[0]
            ? {
                month: previous[0].month,
                day: previous[0].day,
                hasBirthYear: previous[0].birthYear !== null,
              }
            : null,
          after: null,
          changed,
        },
        metadata: { operationSource: 'dashboard' },
      },
    });

    return changed;
  });
}

function assertBirthdayInput(
  userId: string,
  month: number,
  day: number,
  birthYear: number | null,
): void {
  if (!BIRTHDAY_ADMIN_DISCORD_ID_PATTERN.test(userId)) {
    throw new BirthdayAdminValidationError('DiscordユーザーIDが不正です');
  }
  if (!isValidBirthdayDate(month, day)) {
    throw new BirthdayAdminValidationError('誕生日の月日が不正です');
  }
  if (birthYear !== null && !isValidBirthYear(birthYear)) {
    throw new BirthdayAdminValidationError('生年は1900年から現在年までで指定してください');
  }
}