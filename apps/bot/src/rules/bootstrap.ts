import { getPrismaClient } from '@herta/db';
import { HERTA_STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';
import type { Logger } from '@herta/logger';
import type { HertaBot } from '../bot.js';
import { RuleProductionRuntime, type RuleRuntimeSecurity } from './runtime.js';
import { createPrismaRuleRuntimeStore } from './store.js';

export function createRuleProductionRuntime(bot: HertaBot, logger: Logger): RuleProductionRuntime {
  const prisma = getPrismaClient();
  const security: RuleRuntimeSecurity = {
    authorizeRuleActor: async (guildId, actorId) => {
      const members = await bot.searchGuildMembers(guildId, actorId, 1);
      const actor = members?.find((member) => member.id === actorId);
      return actor?.roleIds.includes(HERTA_STUDIO_ROOT_DISCORD_ROLE_ID) ?? false;
    },
    canCreateRole: async (guildId) => {
      const options = await bot.getGuildConfigurationOptions(guildId);
      return options?.bot.manageRoles ?? false;
    },
    canDeleteRole: async (guildId, roleId) => {
      if (roleId === HERTA_STUDIO_ROOT_DISCORD_ROLE_ID) return false;
      const options = await bot.getGuildConfigurationOptions(guildId);
      if (!options?.bot.manageRoles) return false;
      return options.roles.some((role) => role.id === roleId && role.editable && !role.managed);
    },
  };

  return new RuleProductionRuntime({
    store: createPrismaRuleRuntimeStore(prisma),
    security,
    logger,
  });
}
