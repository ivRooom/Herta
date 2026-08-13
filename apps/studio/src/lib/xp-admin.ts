import { prisma } from '@/lib/db';
import {
  nextXpAfterAdminAction,
  XP_ADMIN_DISCORD_ID_PATTERN,
  XpAdminValidationError,
  xpAdminLevelForXp,
  type XpAdminGuildSummary,
  type XpAdminProfile,
  type XpAdminRequest,
  type XpAdminResult,
} from './xp-admin-core';

export {
  parseXpAdminRequest,
  XP_ADMIN_MAX_DELTA,
  XP_ADMIN_MAX_XP,
  XpAdminValidationError,
} from './xp-admin-core';
export type {
  XpAdminAction,
  XpAdminGuildSummary,
  XpAdminProfile,
  XpAdminRequest,
  XpAdminResult,
} from './xp-admin-core';

export async function getXpAdminGuildSummary(guildId: string): Promise<XpAdminGuildSummary> {
  const rows = await prisma.$queryRaw<
    Array<{ profiles: bigint; totalXp: bigint; highestXp: bigint }>
  >`
    SELECT
      COUNT(*)::bigint AS "profiles",
      COALESCE(SUM("xp"), 0)::bigint AS "totalXp",
      COALESCE(MAX("xp"), 0)::bigint AS "highestXp"
    FROM "xp_profiles"
    WHERE "guild_id" = ${guildId}
  `;
  const row = rows[0];
  return {
    profiles: Number(row?.profiles ?? 0n),
    totalXp: Number(row?.totalXp ?? 0n),
    highestXp: Number(row?.highestXp ?? 0n),
  };
}

export async function getXpAdminProfile(guildId: string, userId: string): Promise<XpAdminProfile> {
  if (!XP_ADMIN_DISCORD_ID_PATTERN.test(userId)) {
    throw new XpAdminValidationError('DiscordユーザーIDが不正です');
  }
  const rows = await prisma.$queryRaw<Array<{ userId: string; xp: bigint; rank: bigint }>>`
    WITH ranked AS (
      SELECT
        "user_id" AS "userId",
        "xp"::bigint AS "xp",
        ROW_NUMBER() OVER (ORDER BY "xp" DESC, "updated_at" ASC, "user_id" ASC)::bigint AS "rank"
      FROM "xp_profiles"
      WHERE "guild_id" = ${guildId}
    )
    SELECT "userId", "xp", "rank"
    FROM ranked
    WHERE "userId" = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  const xp = Number(row?.xp ?? 0n);
  return {
    userId,
    xp,
    level: xpAdminLevelForXp(xp),
    rank: row ? Number(row.rank) : null,
  };
}

export async function applyXpAdminOperation(input: {
  guildId: string;
  actorId: string;
  request: XpAdminRequest;
}): Promise<XpAdminResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`xp-admin:${input.guildId}`}, 0))`;

    if (input.request.action === 'reset_guild') {
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count"
        FROM "xp_profiles"
        WHERE "guild_id" = ${input.guildId}
      `;
      const affectedProfiles = Number(countRows[0]?.count ?? 0n);
      const deleted = await tx.$executeRaw`
        DELETE FROM "xp_profiles"
        WHERE "guild_id" = ${input.guildId}
      `;
      const changed = Number(deleted) > 0;

      await tx.auditLog.create({
        data: {
          guildId: input.guildId,
          actorId: input.actorId,
          event: 'leaderboard.xp_reset_guild',
          targetType: 'guild',
          targetId: input.guildId,
          severity: 'warning',
          changes: { affectedProfiles, changed },
          metadata: {
            operationSource: 'dashboard',
            reason: input.request.reason,
            rewardRoleSyncRequired: changed,
          },
        },
      });

      return {
        action: input.request.action,
        changed,
        beforeXp: null,
        afterXp: null,
        beforeLevel: null,
        afterLevel: null,
        affectedProfiles,
        rewardRoleSyncRequired: changed,
      };
    }

    const userId = input.request.userId;
    if (!userId) throw new XpAdminValidationError('対象ユーザーが指定されていません');

    const rows = await tx.$queryRaw<Array<{ xp: bigint }>>`
      SELECT "xp"::bigint AS "xp"
      FROM "xp_profiles"
      WHERE "guild_id" = ${input.guildId} AND "user_id" = ${userId}
      LIMIT 1
    `;
    const existed = Boolean(rows[0]);
    const beforeXp = Number(rows[0]?.xp ?? 0n);
    const beforeLevel = xpAdminLevelForXp(beforeXp);

    let afterXp = beforeXp;
    let changed = false;

    if (input.request.action === 'reset_user') {
      const deleted = await tx.$executeRaw`
        DELETE FROM "xp_profiles"
        WHERE "guild_id" = ${input.guildId} AND "user_id" = ${userId}
      `;
      changed = Number(deleted) > 0;
      afterXp = 0;
    } else {
      if (input.request.amount === null) {
        throw new XpAdminValidationError('XP値が指定されていません');
      }
      afterXp = nextXpAfterAdminAction(beforeXp, input.request.action, input.request.amount);
      changed = afterXp !== beforeXp;

      if (changed && afterXp === 0) {
        await tx.$executeRaw`
          DELETE FROM "xp_profiles"
          WHERE "guild_id" = ${input.guildId} AND "user_id" = ${userId}
        `;
      } else if (changed || (!existed && afterXp > 0)) {
        await tx.$executeRaw`
          INSERT INTO "xp_profiles" (
            "guild_id", "user_id", "xp", "last_xp_at", "created_at", "updated_at"
          ) VALUES (
            ${input.guildId}, ${userId}, ${afterXp}, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON CONFLICT ("guild_id", "user_id") DO UPDATE
          SET "xp" = ${afterXp}, "updated_at" = CURRENT_TIMESTAMP
        `;
        changed = true;
      }
    }

    const afterLevel = xpAdminLevelForXp(afterXp);
    const rewardRoleSyncRequired = changed && beforeLevel !== afterLevel;
    const event = `leaderboard.xp_${input.request.action}`;

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event,
        targetType: 'xp_profile',
        targetId: userId,
        severity: input.request.action === 'reset_user' ? 'warning' : 'info',
        changes: {
          beforeXp,
          afterXp,
          beforeLevel,
          afterLevel,
          amount: input.request.amount,
          changed,
        },
        metadata: {
          operationSource: 'dashboard',
          reason: input.request.reason,
          rewardRoleSyncRequired,
        },
      },
    });

    return {
      action: input.request.action,
      changed,
      beforeXp,
      afterXp,
      beforeLevel,
      afterLevel,
      affectedProfiles: changed ? 1 : 0,
      rewardRoleSyncRequired,
    };
  });
}
