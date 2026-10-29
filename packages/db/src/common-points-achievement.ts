import { createHash } from 'node:crypto';
import { commitCommonPointAccrualInTransaction } from './common-points-outbox.js';
import type { CommonPointsTransaction } from './common-points-outbox.js';

export function achievementCommonPointSourceId(achievementId: string): string {
  return `achievement:${createHash('sha256').update(achievementId).digest('hex')}`;
}

/**
 * Call only after an actual new INSERT, in its owner transaction holding the
 * guild/user achievement lock. Regrant changes the achievement state but never
 * credits a previously receipted unlock twice. Pre-cutoff grants must be seeded
 * as zero-credit source tombstones by the reviewed baseline operator package.
 */
export async function creditAchievementUnlockIfEnabled(
  tx: CommonPointsTransaction,
  guildId: string,
  discordUserId: string,
  achievementId: string,
  occurredAt: Date,
  env: Partial<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (
    env['HERTA_COMMON_POINTS_ACCRUAL_ENABLED'] !== 'true' ||
    env['HERTA_POINTS_GUILD_ID'] !== guildId
  )
    return;
  if (!achievementId || achievementId.startsWith('blocked:'))
    throw new Error('invalid_common_point_achievement');
  const sourceId = achievementCommonPointSourceId(achievementId);
  const existing = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM common_points_source_receipts WHERE guild_id=${guildId}
      AND discord_user_id=${discordUserId} AND metric='achievement_unlocks' AND source_id=${sourceId}`;
  if (existing.length) return;
  await commitCommonPointAccrualInTransaction(
    tx,
    {
      guildId,
      discordUserId,
      metric: 'achievement_unlocks',
      sourceId,
      units: 1n,
      occurredAt,
    },
    async () => {},
  );
}
