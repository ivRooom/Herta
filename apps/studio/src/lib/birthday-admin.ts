import { prisma } from '@/lib/db';
import {
  BIRTHDAY_ADMIN_DISCORD_ID_PATTERN,
  isValidBirthdayDate,
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
      "user_id" AS "userId",
      "month",
      "day"
    FROM "birthday_registrations"
    WHERE "guild_id" = ${guildId}
    ORDER BY "month" ASC, "day" ASC, "user_id" ASC
  `;
}

export async function setBirthdayRegistration(input: {
  guildId: string;
  actorId: string;
  userId: string;
  month: number;
  day: number;
}): Promise<BirthdayRegistration> {
  assertBirthdayInput(input.userId, input.month, input.day);

  return prisma.$transaction(async (tx) => {
    const beforeRows = await tx.$queryRaw<Array<{ month: number; day: number }>>`
      SELECT "month", "day"
      FROM "birthday_registrations"
      WHERE "guild_id" = ${input.guildId} AND "user_id" = ${input.userId}
      LIMIT 1
    `;
    const before = beforeRows[0]
      ? { userId: input.userId, month: beforeRows[0].month, day: beforeRows[0].day }
      : null;
    const after: BirthdayRegistration = {
      userId: input.userId,
      month: input.month,
      day: input.day,
    };

    await tx.$executeRaw`
      INSERT INTO "birthday_registrations" (
        "guild_id", "user_id", "month", "day", "updated_at"
      ) VALUES (
        ${input.guildId}, ${input.userId}, ${input.month}, ${input.day}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("guild_id", "user_id") DO UPDATE SET
        "month" = EXCLUDED."month",
        "day" = EXCLUDED."day",
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
        changes: { before, after },
        metadata: { operationSource: 'dashboard', storesBirthYear: false },
      },
    });

    return after;
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
    const beforeRows = await tx.$queryRaw<Array<{ month: number; day: number }>>`
      SELECT "month", "day"
      FROM "birthday_registrations"
      WHERE "guild_id" = ${input.guildId} AND "user_id" = ${input.userId}
      LIMIT 1
    `;
    const before = beforeRows[0]
      ? { userId: input.userId, month: beforeRows[0].month, day: beforeRows[0].day }
      : null;
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
        changes: { before, after: null, changed },
        metadata: { operationSource: 'dashboard', storesBirthYear: false },
      },
    });

    return changed;
  });
}

function assertBirthdayInput(userId: string, month: number, day: number): void {
  if (!BIRTHDAY_ADMIN_DISCORD_ID_PATTERN.test(userId)) {
    throw new BirthdayAdminValidationError('DiscordユーザーIDが不正です');
  }
  if (!isValidBirthdayDate(month, day)) {
    throw new BirthdayAdminValidationError('誕生日の月日が不正です');
  }
}
