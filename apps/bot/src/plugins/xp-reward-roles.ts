import type { GuildMember } from 'discord.js';
import type { Logger } from '@herta/logger';
import type { XpLevelConfig } from './xp-level.js';

export interface XpRewardRoleTarget {
  roleId: string;
  level: number;
  shouldHave: boolean;
}

export interface XpRewardRoleReconciliationResult {
  level: number;
  addedRoleIds: string[];
  removedRoleIds: string[];
  unchangedRoleIds: string[];
  skippedRoleIds: string[];
  failedRoleIds: string[];
}

export function resolveXpRewardRoleTargets(
  config: XpLevelConfig,
  level: number,
): XpRewardRoleTarget[] {
  const thresholds = new Map<string, number>();
  for (const reward of [
    { level: config.reward1Level, roleId: config.reward1RoleId },
    { level: config.reward2Level, roleId: config.reward2RoleId },
    { level: config.reward3Level, roleId: config.reward3RoleId },
  ]) {
    if (!reward.roleId) continue;
    const existing = thresholds.get(reward.roleId);
    thresholds.set(reward.roleId, existing === undefined ? reward.level : Math.min(existing, reward.level));
  }

  return [...thresholds.entries()]
    .map(([roleId, threshold]) => ({
      roleId,
      level: threshold,
      shouldHave: level >= threshold,
    }))
    .sort((left, right) => left.level - right.level || left.roleId.localeCompare(right.roleId));
}

export async function reconcileXpRewardRoles(input: {
  member: GuildMember;
  config: XpLevelConfig;
  level: number;
  logger: Logger;
}): Promise<XpRewardRoleReconciliationResult> {
  const result: XpRewardRoleReconciliationResult = {
    level: input.level,
    addedRoleIds: [],
    removedRoleIds: [],
    unchangedRoleIds: [],
    skippedRoleIds: [],
    failedRoleIds: [],
  };

  for (const target of resolveXpRewardRoleTargets(input.config, input.level)) {
    const hasRole = input.member.roles.cache.has(target.roleId);
    if (hasRole === target.shouldHave) {
      result.unchangedRoleIds.push(target.roleId);
      continue;
    }

    try {
      const role = await input.member.guild.roles.fetch(target.roleId);
      if (!role?.editable) {
        result.skippedRoleIds.push(target.roleId);
        input.logger.warn(
          {
            guildId: input.member.guild.id,
            userId: input.member.id,
            roleId: target.roleId,
            level: input.level,
          },
          'XP報酬Roleを編集できないため再同期をスキップしました',
        );
        continue;
      }

      if (target.shouldHave) {
        await input.member.roles.add(target.roleId);
        result.addedRoleIds.push(target.roleId);
      } else {
        await input.member.roles.remove(target.roleId);
        result.removedRoleIds.push(target.roleId);
      }
    } catch (error) {
      result.failedRoleIds.push(target.roleId);
      input.logger.warn(
        {
          err: error,
          guildId: input.member.guild.id,
          userId: input.member.id,
          roleId: target.roleId,
          level: input.level,
        },
        'XP報酬Roleの再同期に失敗しました',
      );
    }
  }

  return result;
}
