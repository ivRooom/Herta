import { assertDiscordId, assertRuleId } from './config.js';
import type { AutoResponsePrismaClient } from './service.js';

export const PREPARATION_FAILURE_THROTTLE_SECONDS = 30;

export interface RecordPreparationFailureInput {
  guildId: string;
  ruleId: string;
  durationMs: number;
  errorName: string;
  now?: Date;
}

/**
 * 権限不足やEmbed構築失敗をGuild/Rule単位で間引いて記録する。
 * 通常応答のlastTriggeredAtは更新せず、復旧後の送信Cooldownへ影響させない。
 */
export async function recordPreparationFailureIfDue(
  prisma: AutoResponsePrismaClient,
  input: RecordPreparationFailureInput,
): Promise<boolean> {
  assertDiscordId(input.guildId, 'Guild ID');
  assertRuleId(input.ruleId);

  const now = input.now ?? new Date();
  const errorName = normalizeErrorName(input.errorName);
  const durationMs = Math.max(0, Math.min(Math.floor(input.durationMs), 60_000));

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', input.guildId);

    const rule = await tx.autoResponse.findFirst({
      where: { id: input.ruleId, guildId: input.guildId, enabled: true },
    });
    if (!rule) return false;

    const latest = await tx.autoResponseExecutionEvent.findFirst({
      where: {
        guildId: input.guildId,
        ruleId: input.ruleId,
        status: 'failure',
        errorName,
      },
      orderBy: { executedAt: 'desc' },
    });
    const throttleSeconds = Math.max(PREPARATION_FAILURE_THROTTLE_SECONDS, rule.cooldownSeconds);
    if (latest && now.getTime() - latest.executedAt.getTime() < throttleSeconds * 1000) {
      return false;
    }

    await tx.autoResponseExecutionEvent.create({
      data: {
        guildId: input.guildId,
        ruleId: input.ruleId,
        status: 'failure',
        durationMs,
        errorName,
        executedAt: now,
      },
    });
    await tx.autoResponse.update({
      where: { id: input.ruleId },
      data: { failureCount: { increment: 1 } },
    });
    return true;
  });
}

function normalizeErrorName(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 100) : 'UnknownError';
}
