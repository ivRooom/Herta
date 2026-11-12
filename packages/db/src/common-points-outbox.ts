import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  assertFrozenCommonPointsTariff,
  calculateCommonPointsDelta,
  commonPointsJstDay,
} from './common-points-accrual.js';
import type { CommonPointsMetric, FrozenCommonPointsTariff } from './common-points-accrual.js';

export interface CommonPointSourceIncrement {
  guildId: string;
  discordUserId: string;
  metric: CommonPointsMetric;
  /** Stable native source identity; never a newly generated retry UUID. */
  sourceId: string;
  units: bigint;
  occurredAt: Date;
}
interface Policy {
  epoch: string;
  ruleVersion: string;
  tariffJson: string;
  cutoffAt: Date;
  enabled: boolean;
  baselineComplete: boolean;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const fail = (): never => {
  throw new Error('invalid_common_point_source');
};

/**
 * Prepared source-side primitive, not automatically wired/enabled by import.
 * The callback MUST mutate the source through tx only (no external IO/nested tx).
 * Baseline counters at the cutoff require separately reviewed operator seeding.
 */
export async function commitCommonPointAccrual(
  prisma: PrismaClient,
  input: CommonPointSourceIncrement,
  mutateSource: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<{ replayed: boolean; creditedPoints: bigint }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '10s'`;
      return commitCommonPointAccrualInTransaction(tx, input, () => mutateSource(tx));
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

export type CommonPointsTransaction = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

/**
 * Existing owner transaction variant. Pass its actual transaction client, never
 * a root client. The owner sets timeouts and owns commit/rollback. The callback
 * must perform the domain mutation through that SAME transaction. No nested tx.
 */
export async function commitCommonPointAccrualInTransaction(
  tx: CommonPointsTransaction,
  input: CommonPointSourceIncrement,
  mutateSource: () => Promise<void>,
): Promise<{ replayed: boolean; creditedPoints: bigint }> {
  if (
    !/^[0-9]{17,20}$/.test(input.guildId) ||
    !/^[0-9]{17,20}$/.test(input.discordUserId) ||
    !/^[a-zA-Z0-9:._-]{1,160}$/.test(input.sourceId) ||
    typeof input.units !== 'bigint' ||
    input.units <= 0n ||
    input.units > 9_223_372_036_854_775_807n ||
    !Number.isFinite(input.occurredAt.getTime()) ||
    input.occurredAt.getTime() > Date.now()
  )
    fail();
  const activityDay = commonPointsJstDay(input.occurredAt);
  const policies = await tx.$queryRaw<Policy[]>`
      SELECT epoch, rule_version AS "ruleVersion", tariff_json AS "tariffJson",
        cutoff_at AS "cutoffAt", enabled, baseline_complete AS "baselineComplete"
      FROM common_points_policies WHERE guild_id=${input.guildId} FOR SHARE`;
  const policy = policies[0];
  if (!policy?.enabled || !policy.baselineComplete) throw new Error('common_points_not_ready');
  if (!Number.isFinite(policy.cutoffAt.getTime()) || input.occurredAt <= policy.cutoffAt)
    throw new Error('common_points_before_cutoff');
  const tariff = JSON.parse(policy.tariffJson) as FrozenCommonPointsTariff;
  assertFrozenCommonPointsTariff(tariff);
  if (
    tariff.ruleVersion !== policy.ruleVersion ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(policy.epoch)
  )
    throw new Error('common_points_policy_mismatch');
  // Validate metric even for replay; excluded activity/XP/season/badges cannot mint.
  calculateCommonPointsDelta(tariff, input.metric, 0n, 0n);
  const immutableInput = JSON.stringify({
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    metric: input.metric,
    sourceId: input.sourceId,
    units: input.units.toString(),
    occurredAt: input.occurredAt.toISOString(),
    activityDay,
    epoch: policy.epoch,
    ruleVersion: policy.ruleVersion,
  });
  const inputHash = digest(immutableInput);
  const sourceLock = JSON.stringify([
    'points-source',
    input.guildId,
    input.discordUserId,
    input.metric,
    input.sourceId,
  ]);
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${sourceLock},0))`;
  const receipts = await tx.$queryRaw<Array<{ inputSha256: string; creditedPoints: bigint }>>`
      SELECT input_sha256 AS "inputSha256", credited_points AS "creditedPoints"
      FROM common_points_source_receipts WHERE guild_id=${input.guildId}
        AND discord_user_id=${input.discordUserId} AND metric=${input.metric} AND source_id=${input.sourceId}`;
  const prior = receipts[0];
  if (prior) {
    if (prior.inputSha256 !== inputHash) throw new Error('common_points_source_conflict');
    return { replayed: true, creditedPoints: prior.creditedPoints };
  }
  await tx.$executeRaw`
      INSERT INTO common_points_daily_counters (guild_id,discord_user_id,activity_day,metric,units)
      VALUES (${input.guildId},${input.discordUserId},${activityDay}::date,${input.metric},0)
      ON CONFLICT DO NOTHING`;
  const counters = await tx.$queryRaw<Array<{ units: bigint }>>`
      SELECT units FROM common_points_daily_counters WHERE guild_id=${input.guildId}
        AND discord_user_id=${input.discordUserId} AND activity_day=${activityDay}::date AND metric=${input.metric} FOR UPDATE`;
  const before = counters[0]?.units;
  if (before === undefined) throw new Error('common_points_counter_missing');
  const after = before + input.units;
  const credit = calculateCommonPointsDelta(tariff, input.metric, before, after);
  // Bound work and per-event API limit. Misconfiguration fails the whole source
  // transaction; never silently truncate credit or enqueue an invalid amount.
  if (credit > 64_000_000n) throw new Error('common_points_event_bound');
  await mutateSource();
  await tx.$executeRaw`
      UPDATE common_points_daily_counters SET units=${after} WHERE guild_id=${input.guildId}
        AND discord_user_id=${input.discordUserId} AND activity_day=${activityDay}::date AND metric=${input.metric}`;
  const receiptId = randomUUID();
  await tx.$executeRaw`
      INSERT INTO common_points_source_receipts (id,guild_id,discord_user_id,metric,source_id,input_sha256,credited_points)
      VALUES (${receiptId}::uuid,${input.guildId},${input.discordUserId},${input.metric},${input.sourceId},${inputHash},${credit})`;
  for (let remaining = credit, part = 0; remaining > 0n; part++) {
    const amount = remaining > 1_000_000n ? 1_000_000n : remaining;
    const eventId = randomUUID(),
      earningId = `herta:${receiptId}:${part}`;
    const body = JSON.stringify({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      amount: Number(amount),
      earningId,
      epoch: policy.epoch,
      ruleVersion: policy.ruleVersion,
      occurredAt: input.occurredAt.toISOString(),
    });
    await tx.$executeRaw`
        INSERT INTO common_points_outbox (id,source_receipt_id,earning_id,body,body_sha256)
        VALUES (${eventId}::uuid,${receiptId}::uuid,${earningId},${body},${digest(body)})`;
    remaining -= amount;
  }
  return { replayed: false, creditedPoints: credit };
}
