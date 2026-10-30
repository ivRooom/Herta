export { PrismaClient } from '@prisma/client';
export * from './daily-bonus.js';
export type * from '@prisma/client';
export * from './achievement-unlocks.js';
export * from './ai-generation-analytics.js';
export * from './ai-guild-monthly-budget.js';
export * from './ai-user-model-preferences.js';
export * from './birthday-card-assets.js';
export * from './birthday-card-background.js';
export * from './command-analytics.js';
export * from './community-profile.js';
export * from './community-leaderboard.js';
export * from './community-activity-insights.js';
export * from './community-activity-channel-breakdown.js';
export * from './community-game-breakdown.js';
export * from './community-points-leaderboard.js';
export * from './common-points-accrual.js';
export * from './common-points-achievement.js';
export * from './common-points-delivery.js';
export * from './common-points-outbox.js';
export * from './community-season-snapshot.js';
export * from './community-user-activity-summary.js';
export * from './community-user-game-breakdown.js';
export * from './health-snapshots.js';
export * from './member-activity-feed.js';
export * from './mbti-stats-analytics.js';
export * from './mbti-web-quiz-session.js';
export * from './mbti-personal-results.js';
export * from './discord-role-operations.js';
export * from './discord-role-references.js';
export * from './studio-access-control.js';
export * from './studio-access-groups-admin.js';
export * from './studio-access-management.js';
export * from './rule-runtime.js';
export * from './runtime-secrets.js';
export * from './runtime-configurations.js';
export * from './user-data-consent.js';
export * from './vc-recap.js';
export * from './voice-consent-access.js';

import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/** シングルトン PrismaClient を取得する */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
