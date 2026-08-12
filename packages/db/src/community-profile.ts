import type { PrismaClient } from '@prisma/client';

export type CommunityProfilePeriod = '7d' | '30d' | 'all';

export interface CommunityProfilePreferenceData {
  isPublic: boolean;
  featuredAchievementIds: string[];
  titleAchievementId: string | null;
}

export interface CommunityProfileXp {
  xp: number;
  rank: number | null;
  participants: number;
}

export interface CommunityProfileActivity {
  messages: number;
  reactionsGiven: number;
  reactionsReceived: number;
  voiceSeconds: number;
  minecraftSeconds: number;
}

export interface CommunityProfileAchievementUnlock {
  achievementId: string;
  unlockedAt: Date;
}

export interface CommunityProfileAchievements {
  unlocks: CommunityProfileAchievementUnlock[];
  rank: number | null;
  participants: number;
}

export interface CommunityProfileSnapshotData {
  guildId: string;
  userId: string;
  period: CommunityProfilePeriod;
  xp: CommunityProfileXp;
  activity: CommunityProfileActivity;
  achievements: CommunityProfileAchievements;
  preference: CommunityProfilePreferenceData;
}

export type AddFeaturedAchievementResult =
  | { status: 'added'; featuredAchievementIds: string[] }
  | { status: 'already-featured'; featuredAchievementIds: string[] }
  | { status: 'limit-reached'; featuredAchievementIds: string[] }
  | { status: 'not-unlocked'; featuredAchievementIds: string[] };

export type RemoveFeaturedAchievementResult =
  | { status: 'removed'; featuredAchievementIds: string[] }
  | { status: 'not-featured'; featuredAchievementIds: string[] };

interface XpRankRow {
  xp: bigint;
  rank: bigint | null;
  participants: bigint;
}

interface ActivityRow {
  metric: string;
  total: bigint;
}

interface AchievementRankRow {
  rank: bigint | null;
  participants: bigint;
}

interface PreferenceRow {
  isPublic: boolean;
  featuredAchievementIds: string[];
  titleAchievementId: string | null;
}

export function communityProfilePeriodStart(
  period: CommunityProfilePeriod,
  now = new Date(),
): Date {
  if (period === 'all') return new Date('1970-01-01T00:00:00.000Z');
  const local = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const key = local.toISOString().slice(0, 10);
  const today = new Date(`${key}T00:00:00.000Z`);
  const days = period === '7d' ? 6 : 29;
  return new Date(today.getTime() - days * 86_400_000);
}

export async function getCommunityProfileSnapshotData(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  period: CommunityProfilePeriod,
): Promise<CommunityProfileSnapshotData> {
  const start = communityProfilePeriodStart(period);
  const [xpRows, activityRows, unlocks, achievementRankRows, preferenceRows] = await Promise.all([
    prisma.$queryRaw<XpRankRow[]>`
      WITH ranked AS (
        SELECT
          "user_id",
          "xp",
          RANK() OVER (ORDER BY "xp" DESC, "created_at" ASC, "user_id" ASC)::bigint AS "rank"
        FROM "xp_profiles"
        WHERE "guild_id" = ${guildId}
      )
      SELECT
        COALESCE(ranked."xp", 0)::bigint AS "xp",
        ranked."rank",
        (SELECT COUNT(*)::bigint FROM ranked) AS "participants"
      FROM (VALUES (1)) AS seed(value)
      LEFT JOIN ranked ON ranked."user_id" = ${userId}
      LIMIT 1
    `,
    prisma.$queryRaw<ActivityRow[]>`
      SELECT "metric", COALESCE(SUM("value"), 0)::bigint AS "total"
      FROM "community_activity_daily"
      WHERE "guild_id" = ${guildId}
        AND "user_id" = ${userId}
        AND "activity_date" >= ${start}
      GROUP BY "metric"
    `,
    prisma.$queryRaw<CommunityProfileAchievementUnlock[]>`
      SELECT "achievement_id" AS "achievementId", "unlocked_at" AS "unlockedAt"
      FROM "achievement_unlocks"
      WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
      ORDER BY "unlocked_at" DESC, "achievement_id" ASC
    `,
    prisma.$queryRaw<AchievementRankRow[]>`
      WITH totals AS (
        SELECT "user_id", COUNT(*)::bigint AS "unlock_count"
        FROM "achievement_unlocks"
        WHERE "guild_id" = ${guildId}
        GROUP BY "user_id"
      ), ranked AS (
        SELECT
          "user_id",
          RANK() OVER (ORDER BY "unlock_count" DESC, "user_id" ASC)::bigint AS "rank"
        FROM totals
      )
      SELECT
        ranked."rank",
        (SELECT COUNT(*)::bigint FROM totals) AS "participants"
      FROM (VALUES (1)) AS seed(value)
      LEFT JOIN ranked ON ranked."user_id" = ${userId}
      LIMIT 1
    `,
    prisma.$queryRaw<PreferenceRow[]>`
      SELECT
        "is_public" AS "isPublic",
        "featured_achievement_ids" AS "featuredAchievementIds",
        "title_achievement_id" AS "titleAchievementId"
      FROM "community_profile_preferences"
      WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
      LIMIT 1
    `,
  ]);

  const activity = new Map(activityRows.map((row) => [row.metric, Number(row.total)]));
  const xp = xpRows[0];
  const achievementRank = achievementRankRows[0];
  const preference = preferenceRows[0];

  return {
    guildId,
    userId,
    period,
    xp: {
      xp: Number(xp?.xp ?? 0n),
      rank: xp?.rank === null || xp?.rank === undefined ? null : Number(xp.rank),
      participants: Number(xp?.participants ?? 0n),
    },
    activity: {
      messages: activity.get('messages') ?? 0,
      reactionsGiven: activity.get('reactions_given') ?? 0,
      reactionsReceived: activity.get('reactions_received') ?? 0,
      voiceSeconds: activity.get('voice_seconds') ?? 0,
      minecraftSeconds: activity.get('minecraft_seconds') ?? 0,
    },
    achievements: {
      unlocks,
      rank:
        achievementRank?.rank === null || achievementRank?.rank === undefined
          ? null
          : Number(achievementRank.rank),
      participants: Number(achievementRank?.participants ?? 0n),
    },
    preference: preference
      ? {
          isPublic: preference.isPublic,
          featuredAchievementIds: normalizedAchievementIds(preference.featuredAchievementIds),
          titleAchievementId: normalizedNullableAchievementId(preference.titleAchievementId),
        }
      : { isPublic: true, featuredAchievementIds: [], titleAchievementId: null },
  };
}

export async function setCommunityProfileVisibility(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  isPublic: boolean,
): Promise<CommunityProfilePreferenceData> {
  const [row] = await prisma.$queryRaw<PreferenceRow[]>`
    INSERT INTO "community_profile_preferences" (
      "guild_id", "user_id", "is_public", "featured_achievement_ids", "updated_at"
    ) VALUES (${guildId}, ${userId}, ${isPublic}, ARRAY[]::text[], NOW())
    ON CONFLICT ("guild_id", "user_id") DO UPDATE
    SET "is_public" = EXCLUDED."is_public", "updated_at" = NOW()
    RETURNING
      "is_public" AS "isPublic",
      "featured_achievement_ids" AS "featuredAchievementIds",
      "title_achievement_id" AS "titleAchievementId"
  `;
  return {
    isPublic: row?.isPublic ?? isPublic,
    featuredAchievementIds: normalizedAchievementIds(row?.featuredAchievementIds ?? []),
    titleAchievementId: normalizedNullableAchievementId(row?.titleAchievementId ?? null),
  };
}

export async function addFeaturedAchievement(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  achievementId: string,
  maxItems: number,
): Promise<AddFeaturedAchievementResult> {
  const safeMax = Math.max(1, Math.min(5, Math.trunc(maxItems)));
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`profile:${guildId}:${userId}`}, 0))`;
    const unlocked = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM "achievement_unlocks"
        WHERE "guild_id" = ${guildId}
          AND "user_id" = ${userId}
          AND "achievement_id" = ${achievementId}
      ) AS "exists"
    `;
    const current = await getPreferenceInTransaction(tx, guildId, userId);
    const ids = normalizedAchievementIds(current.featuredAchievementIds);
    if (!unlocked[0]?.exists) return { status: 'not-unlocked', featuredAchievementIds: ids };
    if (ids.includes(achievementId)) {
      return { status: 'already-featured', featuredAchievementIds: ids };
    }
    if (ids.length >= safeMax) return { status: 'limit-reached', featuredAchievementIds: ids };
    const next = [...ids, achievementId];
    await writeFeaturedAchievementIds(tx, guildId, userId, next);
    return { status: 'added', featuredAchievementIds: next };
  });
}

export async function removeFeaturedAchievement(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  achievementId: string,
): Promise<RemoveFeaturedAchievementResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`profile:${guildId}:${userId}`}, 0))`;
    const current = await getPreferenceInTransaction(tx, guildId, userId);
    const ids = normalizedAchievementIds(current.featuredAchievementIds);
    if (!ids.includes(achievementId))
      return { status: 'not-featured', featuredAchievementIds: ids };
    const next = ids.filter((id) => id !== achievementId);
    await writeFeaturedAchievementIds(tx, guildId, userId, next);
    return { status: 'removed', featuredAchievementIds: next };
  });
}

export async function clearFeaturedAchievements(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "community_profile_preferences" (
      "guild_id", "user_id", "is_public", "featured_achievement_ids", "updated_at"
    ) VALUES (${guildId}, ${userId}, TRUE, ARRAY[]::text[], NOW())
    ON CONFLICT ("guild_id", "user_id") DO UPDATE
    SET "featured_achievement_ids" = ARRAY[]::text[], "updated_at" = NOW()
  `;
}

export type SetCommunityProfileTitleResult =
  | { status: 'set'; titleAchievementId: string }
  | { status: 'not-unlocked'; titleAchievementId: string | null };

export async function setCommunityProfileTitle(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  achievementId: string,
): Promise<SetCommunityProfileTitleResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`profile:${guildId}:${userId}`}, 0))`;
    const unlocked = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM "achievement_unlocks"
        WHERE "guild_id" = ${guildId}
          AND "user_id" = ${userId}
          AND "achievement_id" = ${achievementId}
      ) AS "exists"
    `;
    const current = await getPreferenceInTransaction(tx, guildId, userId);
    if (!unlocked[0]?.exists) {
      return { status: 'not-unlocked', titleAchievementId: current.titleAchievementId };
    }
    await tx.$executeRaw`
      INSERT INTO "community_profile_preferences" (
        "guild_id", "user_id", "is_public", "featured_achievement_ids",
        "title_achievement_id", "updated_at"
      ) VALUES (${guildId}, ${userId}, TRUE, ARRAY[]::text[], ${achievementId}, NOW())
      ON CONFLICT ("guild_id", "user_id") DO UPDATE
      SET "title_achievement_id" = EXCLUDED."title_achievement_id", "updated_at" = NOW()
    `;
    return { status: 'set', titleAchievementId: achievementId };
  });
}

export async function clearCommunityProfileTitle(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "community_profile_preferences" (
      "guild_id", "user_id", "is_public", "featured_achievement_ids",
      "title_achievement_id", "updated_at"
    ) VALUES (${guildId}, ${userId}, TRUE, ARRAY[]::text[], NULL, NOW())
    ON CONFLICT ("guild_id", "user_id") DO UPDATE
    SET "title_achievement_id" = NULL, "updated_at" = NOW()
  `;
}

function normalizedAchievementIds(value: readonly string[]): string[] {
  return [...new Set(value.filter((id) => typeof id === 'string' && id.length > 0))].slice(0, 5);
}

function normalizedNullableAchievementId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function getPreferenceInTransaction(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  guildId: string,
  userId: string,
): Promise<CommunityProfilePreferenceData> {
  const rows = await prisma.$queryRaw<PreferenceRow[]>`
    SELECT
      "is_public" AS "isPublic",
      "featured_achievement_ids" AS "featuredAchievementIds",
      "title_achievement_id" AS "titleAchievementId"
    FROM "community_profile_preferences"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        isPublic: row.isPublic,
        featuredAchievementIds: normalizedAchievementIds(row.featuredAchievementIds),
        titleAchievementId: normalizedNullableAchievementId(row.titleAchievementId),
      }
    : { isPublic: true, featuredAchievementIds: [], titleAchievementId: null };
}

async function writeFeaturedAchievementIds(
  prisma: Pick<PrismaClient, '$executeRaw'>,
  guildId: string,
  userId: string,
  ids: readonly string[],
): Promise<void> {
  const normalized = normalizedAchievementIds(ids);
  await prisma.$executeRaw`
    INSERT INTO "community_profile_preferences" (
      "guild_id", "user_id", "is_public", "featured_achievement_ids", "updated_at"
    ) VALUES (${guildId}, ${userId}, TRUE, ${normalized}::text[], NOW())
    ON CONFLICT ("guild_id", "user_id") DO UPDATE
    SET "featured_achievement_ids" = EXCLUDED."featured_achievement_ids", "updated_at" = NOW()
  `;
}
