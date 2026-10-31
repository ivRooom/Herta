import type { Prisma } from '@prisma/client';

/**
 * Per-Discord-user transaction lock shared by a future VC storage writer and
 * all VC consent revocation/erasure entry points. Parameterized PostgreSQL
 * advisory lock; no user ID is interpolated into SQL.
 */
export async function lockVcRecapStorageOwner(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  if (!/^\d{15,22}$/.test(userId)) {
    // Legacy callers may have test or imported non-numeric identifiers;
    // a lock is still meaningful, so only reject empty input.
    if (!userId.trim()) throw new Error('Missing VC Recap owner ID');
  }
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    'vc-recap-storage:' + userId,
  );
}
