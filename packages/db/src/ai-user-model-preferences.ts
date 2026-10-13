import type { PrismaClient } from '@prisma/client';

export interface AiUserModelPreferenceInput {
  guildId: string;
  userId: string;
  provider: string;
  modelProfile: string;
}

export interface AiUserModelPreferenceRecord {
  guildId: string;
  userId: string;
  provider: string;
  modelProfile: string;
  updatedAt: Date;
}

export async function getAiUserModelPreference(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<AiUserModelPreferenceRecord | null> {
  return prisma.aiUserModelPreference.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
}

export async function setAiUserModelPreference(
  prisma: PrismaClient,
  input: AiUserModelPreferenceInput,
): Promise<void> {
  await prisma.aiUserModelPreference.upsert({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    create: input,
    update: { provider: input.provider, modelProfile: input.modelProfile },
  });
}

/** 削除した行があればtrueを返す（存在しない設定のclearをUI側で区別できるように）。 */
export async function clearAiUserModelPreference(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<boolean> {
  const result = await prisma.aiUserModelPreference.deleteMany({ where: { guildId, userId } });
  return result.count > 0;
}
