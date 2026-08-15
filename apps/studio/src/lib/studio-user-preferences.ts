import { prisma } from '@/lib/db';

interface StudioUserPreferenceRow {
  default_guild_id: string | null;
}

export async function getDefaultStudioGuildId(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<StudioUserPreferenceRow[]>`
    SELECT "default_guild_id"
    FROM "studio_user_preferences"
    WHERE "user_id" = ${userId}
    LIMIT 1
  `;
  return rows[0]?.default_guild_id ?? null;
}

export async function setDefaultStudioGuildId(
  userId: string,
  defaultGuildId: string | null,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "studio_user_preferences" ("user_id", "default_guild_id", "updated_at")
    VALUES (${userId}, ${defaultGuildId}, CURRENT_TIMESTAMP)
    ON CONFLICT ("user_id") DO UPDATE SET
      "default_guild_id" = EXCLUDED."default_guild_id",
      "updated_at" = CURRENT_TIMESTAMP
  `;
}
