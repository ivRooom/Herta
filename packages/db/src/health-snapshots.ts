import type { PrismaClient } from '@prisma/client';

export interface ServiceHealthSnapshotInput {
  serviceId: string;
  version: string;
  status: string;
  discordStatus: string;
  databaseStatus: string;
  redisStatus: string;
  workerStatus: string;
  databaseLatencyMs: number | null;
  redisLatencyMs: number | null;
  workerLatencyMs: number | null;
  guildCount: number;
  uptimeSeconds: number;
  checkedAt: Date;
}

export interface ServiceHealthSnapshotRecord extends ServiceHealthSnapshotInput {
  id: string;
}

const DEFAULT_HEALTH_SNAPSHOT_LIMIT = 10_000;
const MAX_HEALTH_SNAPSHOT_LIMIT = 50_000;
const DEFAULT_HEALTH_SNAPSHOT_RETENTION_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1_000;
const HEALTH_SNAPSHOT_SELECT = {
  id: true,
  serviceId: true,
  version: true,
  status: true,
  discordStatus: true,
  databaseStatus: true,
  redisStatus: true,
  workerStatus: true,
  databaseLatencyMs: true,
  redisLatencyMs: true,
  workerLatencyMs: true,
  guildCount: true,
  uptimeSeconds: true,
  checkedAt: true,
} as const;

export function normalizeServiceHealthSnapshotLimit(limit: number | null | undefined): number {
  const finiteLimit =
    typeof limit === 'number' && Number.isFinite(limit) ? limit : DEFAULT_HEALTH_SNAPSHOT_LIMIT;
  return Math.min(Math.max(Math.trunc(finiteLimit), 1), MAX_HEALTH_SNAPSHOT_LIMIT);
}

export function getServiceHealthSnapshotRetentionCutoff(
  retentionDays: number | null | undefined = DEFAULT_HEALTH_SNAPSHOT_RETENTION_DAYS,
  now = new Date(),
): Date {
  const finiteDays =
    typeof retentionDays === 'number' && Number.isFinite(retentionDays)
      ? retentionDays
      : DEFAULT_HEALTH_SNAPSHOT_RETENTION_DAYS;
  const safeDays = Math.max(1, Math.trunc(finiteDays));
  return new Date(now.getTime() - safeDays * DAY_MS);
}

export async function recordServiceHealthSnapshot(
  prisma: PrismaClient,
  input: ServiceHealthSnapshotInput,
): Promise<void> {
  await prisma.serviceHealthSnapshot.create({
    data: {
      serviceId: input.serviceId,
      version: input.version,
      status: input.status,
      discordStatus: input.discordStatus,
      databaseStatus: input.databaseStatus,
      redisStatus: input.redisStatus,
      workerStatus: input.workerStatus,
      databaseLatencyMs: input.databaseLatencyMs,
      redisLatencyMs: input.redisLatencyMs,
      workerLatencyMs: input.workerLatencyMs,
      guildCount: input.guildCount,
      uptimeSeconds: input.uptimeSeconds,
      checkedAt: input.checkedAt,
    },
  });
}

export async function listServiceHealthSnapshots(
  prisma: PrismaClient,
  serviceId: string,
  since: Date,
  limit: number | null | undefined = DEFAULT_HEALTH_SNAPSHOT_LIMIT,
): Promise<ServiceHealthSnapshotRecord[]> {
  const safeLimit = normalizeServiceHealthSnapshotLimit(limit);
  return prisma.serviceHealthSnapshot.findMany({
    where: {
      serviceId,
      checkedAt: { gte: since },
    },
    orderBy: { checkedAt: 'asc' },
    take: safeLimit,
    select: HEALTH_SNAPSHOT_SELECT,
  });
}

export async function getServiceHealthSnapshotBefore(
  prisma: PrismaClient,
  serviceId: string,
  before: Date,
): Promise<ServiceHealthSnapshotRecord | null> {
  return prisma.serviceHealthSnapshot.findFirst({
    where: {
      serviceId,
      checkedAt: { lt: before },
    },
    orderBy: { checkedAt: 'desc' },
    select: HEALTH_SNAPSHOT_SELECT,
  });
}

export async function pruneServiceHealthSnapshots(
  prisma: PrismaClient,
  retentionDays: number | null | undefined = DEFAULT_HEALTH_SNAPSHOT_RETENTION_DAYS,
  now = new Date(),
): Promise<number> {
  const cutoff = getServiceHealthSnapshotRetentionCutoff(retentionDays, now);
  const result = await prisma.serviceHealthSnapshot.deleteMany({
    where: { checkedAt: { lt: cutoff } },
  });
  return result.count;
}
