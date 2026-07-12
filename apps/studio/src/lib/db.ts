import { getPrismaClient } from '@herta/db';

/** Studio 全体で共有する PrismaClient シングルトン */
export const prisma = getPrismaClient();
