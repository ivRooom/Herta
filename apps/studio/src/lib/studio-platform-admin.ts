import { prisma } from '@/lib/db';

/**
 * Global Herta / Studio administrator check.
 * This is intentionally independent from per-Guild IAM because runtime provider
 * credentials affect every Guild that opts into AI.
 */
export async function isStudioPlatformAdmin(userId: string): Promise<boolean> {
  const normalized = userId.trim();
  if (!normalized) return false;
  const user = await prisma.user.findUnique({
    where: { id: normalized },
    select: { isAdmin: true },
  });
  return user?.isAdmin === true;
}
