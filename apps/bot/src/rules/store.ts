import {
  enqueueDiscordRoleCreateOperation,
  enqueueDiscordRoleDeleteOperation,
  listEnabledRuleRuntimeRecords,
  listGuildIdsWithEnabledRuleTrigger,
  recordInvalidStoredRuleExecution,
  recordRuleRuntimeExecution,
  reserveRuleRuntimeExecution,
  type PrismaClient,
} from '@herta/db';
import type { RuleRuntimeStore } from './runtime.js';

export function createPrismaRuleRuntimeStore(prisma: PrismaClient): RuleRuntimeStore {
  return {
    listRules: (guildId, triggerType) =>
      listEnabledRuleRuntimeRecords(prisma, guildId, triggerType),
    listGuildIdsWithTrigger: (triggerType) =>
      listGuildIdsWithEnabledRuleTrigger(prisma, triggerType),
    reserveExecution: (input) => reserveRuleRuntimeExecution(prisma, input),
    recordExecution: (input) => recordRuleRuntimeExecution(prisma, input),
    recordInvalidRule: (input) => recordInvalidStoredRuleExecution(prisma, input),
    enqueueRoleCreate: (input) => enqueueDiscordRoleCreateOperation(prisma, input),
    enqueueRoleDelete: (input) => enqueueDiscordRoleDeleteOperation(prisma, input),
  };
}
