export { PrismaClient } from '@prisma/client';
export type * from '@prisma/client';
export * from './command-analytics.js';
export * from './community-profile.js';
export * from './community-leaderboard.js';
export * from './community-season-snapshot.js';
export * from './health-snapshots.js';
export * from './discord-role-operations.js';

import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/** シングルトン PrismaClient を取得する */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
