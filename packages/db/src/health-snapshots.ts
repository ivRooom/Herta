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

export function normalizeServiceHealthSnapshotLimit(limit: number | null | undefined): number {
  const finiteLimit =
    typeof limit === 'number' && Number.isFinite(limit) ? limit : DEFAULT_HEALTH_SNAPSHOT_LIMIT;
  return Math.min(Math.max(Math.trunc(finiteLimit), 1), MAX_HEALTH_SNAPSHOT_LIMIT);
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
    select: {
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
    },
  });
}
