import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

async function deliveryTransaction<T>(
  prisma: PrismaClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      return run(tx);
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

export interface LeasedCommonPointsEvent {
  id: string;
  body: string;
  bodySha256: string;
  attempts: number;
  leaseToken: string;
}

/** Atomic claim; HTTP must occur outside any database transaction. */
export async function leaseCommonPointsEvents(
  prisma: PrismaClient,
  guildId: string,
  limit = 5,
): Promise<LeasedCommonPointsEvent[]> {
  if (!/^[0-9]{17,20}$/.test(guildId) || !Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new Error('invalid_common_points_lease');
  const token = randomUUID();
  return deliveryTransaction(
    prisma,
    (tx) => tx.$queryRaw<LeasedCommonPointsEvent[]>`
    WITH picked AS (
      SELECT o.id FROM common_points_outbox o
      JOIN common_points_source_receipts r ON r.id=o.source_receipt_id
      JOIN common_points_policies p ON p.guild_id=r.guild_id
      WHERE r.guild_id=${guildId} AND p.enabled AND p.baseline_complete
        AND ((o.status='pending' AND o.next_attempt_at<=CURRENT_TIMESTAMP)
          OR (o.status='leased' AND o.lease_expires_at<=CURRENT_TIMESTAMP))
      ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT ${limit}
    ) UPDATE common_points_outbox o SET status='leased',lease_token=${token}::uuid,
      lease_expires_at=clock_timestamp()+INTERVAL '30 seconds',attempts=LEAST(o.attempts,2147483646)+1
    FROM picked WHERE o.id=picked.id
    RETURNING o.id::text,o.body,o.body_sha256 AS "bodySha256",o.attempts,o.lease_token::text AS "leaseToken"`,
  );
}

export type CommonPointsDeliveryOutcome =
  | { state: 'acked'; transactionId: string; userId: string }
  | { state: 'pending' | 'quarantined'; code: string; delaySeconds: number };

/** Token and expiry fence a stale worker from acknowledging another worker's lease. */
export async function settleCommonPointsEvent(
  prisma: PrismaClient,
  event: Pick<LeasedCommonPointsEvent, 'id' | 'leaseToken'>,
  outcome: CommonPointsDeliveryOutcome,
): Promise<boolean> {
  return deliveryTransaction(prisma, (tx) => settleInTransaction(tx, event, outcome));
}

async function settleInTransaction(
  prisma: Prisma.TransactionClient,
  event: Pick<LeasedCommonPointsEvent, 'id' | 'leaseToken'>,
  outcome: CommonPointsDeliveryOutcome,
): Promise<boolean> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!uuid.test(event.id) || !uuid.test(event.leaseToken))
    throw new Error('invalid_common_points_fence');
  // Acquire the row BEFORE evaluating the real-time expiry. An UPDATE's WHERE
  // can be evaluated before waiting for an unchanged, row-locked tuple.
  await prisma.$queryRaw`SELECT id FROM common_points_outbox WHERE id=${event.id}::uuid FOR UPDATE`;
  if (outcome.state === 'acked') {
    if (
      ![outcome.transactionId, outcome.userId].every(
        (v) => typeof v === 'string' && v.length > 0 && v.length <= 160,
      )
    )
      throw new Error('invalid_common_points_ack');
    const count = await prisma.$executeRaw`
      UPDATE common_points_outbox SET status='acked',acknowledged_at=CURRENT_TIMESTAMP,
        remote_transaction_id=${outcome.transactionId},remote_user_id=${outcome.userId},last_error_code=NULL,lease_token=NULL,lease_expires_at=NULL
      WHERE id=${event.id}::uuid AND status='leased' AND lease_token=${event.leaseToken}::uuid AND lease_expires_at>clock_timestamp()`;
    return count === 1;
  }
  if (
    !['pending', 'quarantined'].includes(outcome.state) ||
    !/^[a-z0-9_]{1,64}$/.test(outcome.code) ||
    !Number.isInteger(outcome.delaySeconds) ||
    outcome.delaySeconds < 1 ||
    outcome.delaySeconds > 3600
  )
    throw new Error('invalid_common_points_retry');
  const count = await prisma.$executeRaw`
    UPDATE common_points_outbox SET status=${outcome.state},last_error_code=${outcome.code},
      next_attempt_at=CURRENT_TIMESTAMP+${outcome.delaySeconds}*INTERVAL '1 second',lease_token=NULL,lease_expires_at=NULL
    WHERE id=${event.id}::uuid AND status='leased' AND lease_token=${event.leaseToken}::uuid AND lease_expires_at>clock_timestamp()`;
  return count === 1;
}

export async function getCommonPointsDeliveryHealth(
  prisma: PrismaClient,
  guildId: string,
): Promise<{ pending: number; quarantined: number; oldestPendingSeconds: number }> {
  if (!/^[0-9]{17,20}$/.test(guildId)) throw new Error('invalid_common_points_guild');
  const rows = await deliveryTransaction(
    prisma,
    (tx) => tx.$queryRaw<Array<{ pending: bigint; quarantined: bigint; oldest: number | null }>>`
    SELECT count(*) FILTER(WHERE o.status IN ('pending','leased'))::bigint AS pending,
      count(*) FILTER(WHERE o.status='quarantined')::bigint AS quarantined,
      EXTRACT(EPOCH FROM CURRENT_TIMESTAMP-min(o.created_at) FILTER(WHERE o.status IN ('pending','leased')))::float8 AS oldest
    FROM common_points_outbox o JOIN common_points_source_receipts r ON r.id=o.source_receipt_id WHERE r.guild_id=${guildId}`,
  );
  const row = rows[0],
    pending = Number(row?.pending ?? 0n),
    quarantined = Number(row?.quarantined ?? 0n),
    oldestPendingSeconds = Math.max(0, Math.floor(row?.oldest ?? 0));
  if (![pending, quarantined, oldestPendingSeconds].every(Number.isSafeInteger))
    throw new Error('invalid_common_points_health');
  return { pending, quarantined, oldestPendingSeconds };
}
