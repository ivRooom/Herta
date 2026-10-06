import type { PrismaClient } from '@herta/db';
import type { ValorantRegion } from '@herta/plugin-catalog';
import type { RiotIdInput } from './valorant-client.js';

export interface ValorantLinkRecord {
  riotName: string;
  riotTag: string;
  region: ValorantRegion;
}

export async function getValorantLink(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<ValorantLinkRecord | null> {
  const record = await prisma.valorantAccountLink.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!record) return null;
  return {
    riotName: record.riotName,
    riotTag: record.riotTag,
    region: record.region as ValorantRegion,
  };
}

export async function upsertValorantLink(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  riotId: RiotIdInput,
  region: ValorantRegion,
): Promise<void> {
  await prisma.valorantAccountLink.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, riotName: riotId.name, riotTag: riotId.tag, region },
    update: { riotName: riotId.name, riotTag: riotId.tag, region },
  });
}

export async function deleteValorantLink(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<boolean> {
  try {
    await prisma.valorantAccountLink.delete({ where: { guildId_userId: { guildId, userId } } });
    return true;
  } catch {
    return false;
  }
}
