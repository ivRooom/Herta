import { prisma } from '@/lib/db';

export async function getDefaultStudioGuildId(userId: string): Promise<string | null> {
  const preference = await prisma.studioUserPreference.findUnique({
    where: { userId },
    select: { defaultGuildId: true },
  });
  return preference?.defaultGuildId ?? null;
}

export async function setDefaultStudioGuildId(
  userId: string,
  defaultGuildId: string | null,
): Promise<void> {
  await prisma.studioUserPreference.upsert({
    where: { userId },
    create: { userId, defaultGuildId },
    update: { defaultGuildId },
  });
}
