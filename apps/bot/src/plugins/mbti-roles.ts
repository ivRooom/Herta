import type { GuildMember } from 'discord.js';
import type { Logger } from '@herta/logger';

export interface MbtiRoleReconciliationResult {
  type: string;
  addedRoleId: string | null;
  removedRoleIds: string[];
  skippedRoleIds: string[];
  failedRoleIds: string[];
}

/**
 * MBTIタイプは互いに排他(1人1タイプ)のため、xp-reward-rolesの累積Roleとは異なり、
 * 診断結果に対応するRole以外の既存MBTI Roleは剥奪する。
 */
export async function reconcileMbtiRole(input: {
  member: GuildMember;
  roleMap: Readonly<Record<string, string | null>>;
  resultType: string;
  logger: Logger;
}): Promise<MbtiRoleReconciliationResult> {
  const result: MbtiRoleReconciliationResult = {
    type: input.resultType,
    addedRoleId: null,
    removedRoleIds: [],
    skippedRoleIds: [],
    failedRoleIds: [],
  };

  const targetRoleId = input.roleMap[input.resultType] ?? null;
  const allMappedRoleIds = [
    ...new Set(Object.values(input.roleMap).filter((id) => id)),
  ] as string[];

  for (const roleId of allMappedRoleIds) {
    if (roleId === targetRoleId) continue;
    if (!input.member.roles.cache.has(roleId)) continue;

    try {
      const role = await input.member.guild.roles.fetch(roleId);
      if (!role?.editable) {
        result.skippedRoleIds.push(roleId);
        input.logger.warn(
          { guildId: input.member.guild.id, userId: input.member.id, roleId },
          'MBTI Roleを編集できないため剥奪をスキップしました',
        );
        continue;
      }
      await input.member.roles.remove(roleId);
      result.removedRoleIds.push(roleId);
    } catch (error) {
      result.failedRoleIds.push(roleId);
      input.logger.warn(
        { err: error, guildId: input.member.guild.id, userId: input.member.id, roleId },
        'MBTI Roleの剥奪に失敗しました',
      );
    }
  }

  if (targetRoleId && !input.member.roles.cache.has(targetRoleId)) {
    try {
      const role = await input.member.guild.roles.fetch(targetRoleId);
      if (!role?.editable) {
        result.skippedRoleIds.push(targetRoleId);
        input.logger.warn(
          { guildId: input.member.guild.id, userId: input.member.id, roleId: targetRoleId },
          'MBTI Roleを編集できないため付与をスキップしました',
        );
      } else {
        await input.member.roles.add(targetRoleId);
        result.addedRoleId = targetRoleId;
      }
    } catch (error) {
      result.failedRoleIds.push(targetRoleId);
      input.logger.warn(
        {
          err: error,
          guildId: input.member.guild.id,
          userId: input.member.id,
          roleId: targetRoleId,
        },
        'MBTI Roleの付与に失敗しました',
      );
    }
  }

  return result;
}
