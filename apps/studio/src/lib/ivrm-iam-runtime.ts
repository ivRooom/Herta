import {
  changeStudioAccessGroupMembers,
  changeStudioAccessPolicyAttachments,
  deleteStudioAccessGroupIfCurrent,
  findManagedStudioAccessPolicy,
  listStudioAccessGroups,
  updateStudioAccessGroupIfCurrent,
} from '@herta/db';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { prisma } from '@/lib/db';
import { createIvrmIamHandlers } from '@/lib/ivrm-iam-handlers';
import { createFixedWindowRateLimiter, readRateLimitPerMinute } from '@/lib/ivrm-iam-management';
import { authorizeIvrmIntegrationRequest } from '@/lib/ivrm-integration-auth';
import { isPrismaRawUniqueViolation } from '@/lib/prisma-raw-error';

/** integration token ごとのレート制限(1 分あたり。既定 120)。 */
const rateLimiter = createFixedWindowRateLimiter({
  limit: readRateLimitPerMinute(),
  windowMs: 60_000,
});

/** 実際の DB・bot・監査につないだ ivRooom IAM 連携ハンドラ。 */
export const ivrmIamHandlers = createIvrmIamHandlers({
  authorize: (request) => authorizeIvrmIntegrationRequest(request),
  rateLimiter,
  listGroups: (guildId) => listStudioAccessGroups(prisma, guildId),
  findPolicy: async (guildId, policyId) => {
    const policy = await findManagedStudioAccessPolicy(prisma, guildId, policyId);
    return policy ? { id: policy.id, name: policy.name } : null;
  },
  updateGroupIfCurrent: (input) => updateStudioAccessGroupIfCurrent(prisma, input),
  deleteGroupIfCurrent: (input) => deleteStudioAccessGroupIfCurrent(prisma, input),
  changeMembers: (input) => changeStudioAccessGroupMembers(prisma, input),
  changeAttachments: (input) => changeStudioAccessPolicyAttachments(prisma, input),
  getRoleIds: async (guildId) => {
    const options = await getGuildConfigurationOptions(guildId);
    return options ? new Set(options.roles.map((role) => role.id)) : null;
  },
  hasGuildMember: async (guildId, userId) => (await getGuildMemberById(guildId, userId)) !== null,
  audit: async ({ guildId, actorId, event, targetType, targetId, changes }) => {
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId,
        event,
        targetType,
        targetId,
        changes,
        severity: 'warning',
        // 既存の連携経由の監査(グループ作成)と同じ operationSource。Studio からの操作('studio')と区別する。
        metadata: { operationSource: 'ivrm-admin', securitySensitive: true },
      },
    });
  },
  isUniqueViolation: (error) => isPrismaRawUniqueViolation(error),
});
