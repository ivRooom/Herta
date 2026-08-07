import { createModerationDetectionIdempotencyKey } from './detection-history.js';
import type { AutomaticModerationFinding } from './detection.js';
import type { ModerationPrismaClient, ModerationTransactionClient } from './service.js';

export interface ModerationBlacklistEntry {
  guildId: string;
  userId: string;
  reason: string | null;
  originDetectionId: string | null;
  createdBy: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ModerationBlacklistRow {
  guild_id: string;
  user_id: string;
  reason: string | null;
  origin_detection_id: string | null;
  created_by: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface BlacklistPresenceCacheEntry {
  hasActive: boolean;
  expiresAt: number;
}

const BLACKLIST_PRESENCE_TTL_MS = 30_000;
const blacklistPresenceCache = new Map<string, BlacklistPresenceCacheEntry>();

export async function getModerationDetectionIdForFinding(
  prisma: ModerationPrismaClient,
  input: {
    guildId: string;
    messageId: string;
    finding: AutomaticModerationFinding;
  },
): Promise<string | null> {
  const idempotencyKey = createModerationDetectionIdempotencyKey(input);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM moderation_detection_events
     WHERE guild_id = $1
       AND idempotency_key = $2
     LIMIT 1`,
    input.guildId,
    idempotencyKey,
  );
  return rows[0]?.id ?? null;
}

export async function upsertModerationBlacklistEntry(
  prisma: ModerationPrismaClient,
  input: {
    guildId: string;
    userId: string;
    reason: string | null;
    originDetectionId: string | null;
    createdBy: string;
  },
): Promise<ModerationBlacklistEntry> {
  const rows = await prisma.$queryRawUnsafe<ModerationBlacklistRow[]>(
    `INSERT INTO moderation_blacklist_entries (
       guild_id,
       user_id,
       reason,
       origin_detection_id,
       created_by,
       active
     ) VALUES ($1, $2, $3, $4::uuid, $5, TRUE)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET
       reason = EXCLUDED.reason,
       origin_detection_id = EXCLUDED.origin_detection_id,
       created_by = EXCLUDED.created_by,
       active = TRUE,
       updated_at = NOW()
     RETURNING *`,
    input.guildId,
    input.userId,
    input.reason,
    input.originDetectionId,
    input.createdBy,
  );
  const row = rows[0];
  if (!row) throw new Error('Moderationブラックリストの保存に失敗しました');
  blacklistPresenceCache.set(input.guildId, {
    hasActive: true,
    expiresAt: Date.now() + BLACKLIST_PRESENCE_TTL_MS,
  });
  return toBlacklistRecord(row);
}

export async function hasActiveModerationBlacklistEntries(
  prisma: ModerationPrismaClient,
  guildId: string,
): Promise<boolean> {
  const now = Date.now();
  const cached = blacklistPresenceCache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.hasActive;

  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM moderation_blacklist_entries
       WHERE guild_id = $1
         AND active = TRUE
     ) AS exists`,
    guildId,
  );
  const hasActive = rows[0]?.exists === true;
  blacklistPresenceCache.set(guildId, {
    hasActive,
    expiresAt: now + BLACKLIST_PRESENCE_TTL_MS,
  });
  return hasActive;
}

export async function getActiveModerationBlacklistEntry(
  prisma: ModerationPrismaClient,
  guildId: string,
  userId: string,
): Promise<ModerationBlacklistEntry | null> {
  const rows = await prisma.$queryRawUnsafe<ModerationBlacklistRow[]>(
    `SELECT *
     FROM moderation_blacklist_entries
     WHERE guild_id = $1
       AND user_id = $2
       AND active = TRUE
     LIMIT 1`,
    guildId,
    userId,
  );
  return rows[0] ? toBlacklistRecord(rows[0]) : null;
}

export async function listModerationBlacklistEntries(
  prisma: ModerationPrismaClient,
  guildId: string,
  options: { includeInactive?: boolean; limit?: number } = {},
): Promise<ModerationBlacklistEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<ModerationBlacklistRow[]>(
    `SELECT *
     FROM moderation_blacklist_entries
     WHERE guild_id = $1
       AND ($2::boolean = TRUE OR active = TRUE)
     ORDER BY active DESC, updated_at DESC, user_id ASC
     LIMIT $3`,
    guildId,
    options.includeInactive ?? false,
    limit,
  );
  return rows.map(toBlacklistRecord);
}

export async function setModerationBlacklistEntryActive(
  prisma: ModerationPrismaClient,
  input: { guildId: string; userId: string; active: boolean; actorId: string },
): Promise<ModerationBlacklistEntry | null> {
  const updated = await prisma.$transaction(async (tx: ModerationTransactionClient) => {
    const rows = await tx.$queryRawUnsafe<ModerationBlacklistRow[]>(
      `UPDATE moderation_blacklist_entries
       SET active = $3,
           updated_at = NOW()
       WHERE guild_id = $1
         AND user_id = $2
       RETURNING *`,
      input.guildId,
      input.userId,
      input.active,
    );
    const row = rows[0];
    if (!row) return null;

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: input.active ? 'moderation.blacklist.enable' : 'moderation.blacklist.disable',
        targetType: 'moderation_blacklist_entry',
        targetId: input.userId,
        changes: { after: { active: input.active } },
        metadata: { targetUserId: input.userId },
        severity: input.active ? 'warning' : 'info',
      },
    });
    return row;
  });

  blacklistPresenceCache.delete(input.guildId);
  return updated ? toBlacklistRecord(updated) : null;
}

export async function recordModerationAutomaticEventAudit(
  prisma: ModerationPrismaClient,
  input: {
    guildId: string;
    actorId: string;
    event: string;
    targetUserId: string;
    detectionId?: string | null;
    metadata?: Record<string, unknown>;
    severity?: 'info' | 'warning' | 'critical';
  },
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      guildId: input.guildId,
      actorId: input.actorId,
      actorType: 'system',
      event: input.event,
      targetType: 'discord_user',
      targetId: input.targetUserId,
      metadata: {
        targetUserId: input.targetUserId,
        detectionId: input.detectionId ?? null,
        ...(input.metadata ?? {}),
      },
      severity: input.severity ?? 'info',
    },
  });
}

function toBlacklistRecord(row: ModerationBlacklistRow): ModerationBlacklistEntry {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    reason: row.reason,
    originDetectionId: row.origin_detection_id,
    createdBy: row.created_by,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
