import { prisma } from '@/lib/db';

export const GUILD_ANNIVERSARY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface GuildAnniversary {
  anniversaryDate: string;
  updatedAt: string;
}

export function isValidGuildAnniversaryDate(value: string, today = new Date()): boolean {
  if (!GUILD_ANNIVERSARY_DATE_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return date.getTime() <= todayUtc;
}

export async function getGuildAnniversary(guildId: string): Promise<GuildAnniversary | null> {
  const rows = await prisma.$queryRaw<Array<{ anniversaryDate: string; updatedAt: Date }>>`
    SELECT
      TO_CHAR("anniversary_date", 'YYYY-MM-DD') AS "anniversaryDate",
      "updated_at" AS "updatedAt"
    FROM "guild_anniversaries"
    WHERE "guild_id" = ${guildId}
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? { anniversaryDate: row.anniversaryDate, updatedAt: row.updatedAt.toISOString() }
    : null;
}

export async function setGuildAnniversary(input: {
  guildId: string;
  actorId: string;
  anniversaryDate: string;
}): Promise<GuildAnniversary> {
  if (!isValidGuildAnniversaryDate(input.anniversaryDate)) {
    throw new Error('InvalidGuildAnniversaryDate');
  }

  return prisma.$transaction(async (tx) => {
    const beforeRows = await tx.$queryRaw<Array<{ anniversaryDate: string }>>`
      SELECT TO_CHAR("anniversary_date", 'YYYY-MM-DD') AS "anniversaryDate"
      FROM "guild_anniversaries"
      WHERE "guild_id" = ${input.guildId}
      LIMIT 1
    `;
    await tx.$executeRaw`
      INSERT INTO "guild_anniversaries" (
        "guild_id", "anniversary_date", "updated_by", "updated_at"
      ) VALUES (
        ${input.guildId}, CAST(${input.anniversaryDate} AS DATE), ${input.actorId}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("guild_id") DO UPDATE SET
        "anniversary_date" = EXCLUDED."anniversary_date",
        "updated_by" = EXCLUDED."updated_by",
        "updated_at" = CURRENT_TIMESTAMP
    `;
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'guild.anniversary_set',
        targetType: 'guild_anniversary',
        targetId: input.guildId,
        severity: 'info',
        changes: {
          before: beforeRows[0]?.anniversaryDate ?? null,
          after: input.anniversaryDate,
        },
        metadata: { operationSource: 'bot-profile' },
      },
    });
    return { anniversaryDate: input.anniversaryDate, updatedAt: new Date().toISOString() };
  });
}

export async function removeGuildAnniversary(input: {
  guildId: string;
  actorId: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const beforeRows = await tx.$queryRaw<Array<{ anniversaryDate: string }>>`
      SELECT TO_CHAR("anniversary_date", 'YYYY-MM-DD') AS "anniversaryDate"
      FROM "guild_anniversaries"
      WHERE "guild_id" = ${input.guildId}
      LIMIT 1
    `;
    const deleted = await tx.$executeRaw`
      DELETE FROM "guild_anniversaries" WHERE "guild_id" = ${input.guildId}
    `;
    const changed = Number(deleted) > 0;
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'guild.anniversary_remove',
        targetType: 'guild_anniversary',
        targetId: input.guildId,
        severity: 'info',
        changes: { before: beforeRows[0]?.anniversaryDate ?? null, after: null, changed },
        metadata: { operationSource: 'bot-profile' },
      },
    });
    return changed;
  });
}
