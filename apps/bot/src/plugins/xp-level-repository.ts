import type { PrismaClient } from '@herta/db';

export interface XpProfileRecord {
  guildId: string;
  userId: string;
  xp: number;
  lastXpAt: Date | null;
}

export interface XpAwardResult {
  awarded: boolean;
  xp: number;
}

export async function awardMessageXp(
  prisma: PrismaClient,
  input: {
    guildId: string;
    userId: string;
    amount: number;
    cooldownSeconds: number;
    now?: Date;
  },
): Promise<XpAwardResult> {
  const now = input.now ?? new Date();
  const cooldownStart = new Date(now.getTime() - input.cooldownSeconds * 1000);
  const rows = await prisma.$queryRaw<Array<{ xp: bigint }>>`
    INSERT INTO "xp_profiles" (
      "guild_id", "user_id", "xp", "last_xp_at", "created_at", "updated_at"
    ) VALUES (
      ${input.guildId}, ${input.userId}, ${input.amount}, ${now}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("guild_id", "user_id") DO UPDATE
    SET
      "xp" = "xp_profiles"."xp" + ${input.amount},
      "last_xp_at" = ${now},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "xp_profiles"."last_xp_at" IS NULL
       OR "xp_profiles"."last_xp_at" <= ${cooldownStart}
    RETURNING "xp"
  `;
  const row = rows[0];
  if (!row) {
    const profile = await getXpProfile(prisma, input.guildId, input.userId);
    return { awarded: false, xp: profile?.xp ?? 0 };
  }
  return { awarded: true, xp: Number(row.xp) };
}

export async function getXpProfile(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<XpProfileRecord | null> {
  const rows = await prisma.$queryRaw<Array<{ guildId: string; userId: string; xp: bigint; lastXpAt: Date | null }>>`
    SELECT
      "guild_id" AS "guildId",
      "user_id" AS "userId",
      "xp",
      "last_xp_at" AS "lastXpAt"
    FROM "xp_profiles"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { ...row, xp: Number(row.xp) } : null;
}

export async function listXpLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  limit: number,
): Promise<XpProfileRecord[]> {
  const rows = await prisma.$queryRaw<Array<{ guildId: string; userId: string; xp: bigint; lastXpAt: Date | null }>>`
    SELECT
      "guild_id" AS "guildId",
      "user_id" AS "userId",
      "xp",
      "last_xp_at" AS "lastXpAt"
    FROM "xp_profiles"
    WHERE "guild_id" = ${guildId}
    ORDER BY "xp" DESC, "updated_at" ASC, "user_id" ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ ...row, xp: Number(row.xp) }));
}

export async function getXpRank(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ rank: bigint | number }>>`
    WITH ranked AS (
      SELECT
        "user_id",
        ROW_NUMBER() OVER (ORDER BY "xp" DESC, "updated_at" ASC, "user_id" ASC) AS "rank"
      FROM "xp_profiles"
      WHERE "guild_id" = ${guildId}
    )
    SELECT "rank" FROM ranked WHERE "user_id" = ${userId} LIMIT 1
  `;
  const value = rows[0]?.rank;
  return value === undefined ? null : Number(value);
}
