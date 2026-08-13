import type { Guild, GuildMember } from 'discord.js';
import type { Logger } from '@herta/logger';
import type { PrismaClient } from '@herta/db';
import { listGuildXpProfiles } from './xp-level-repository.js';
import { levelForXp, type XpLevelConfig } from './xp-level.js';
import {
  reconcileXpRewardRoles,
  resolveXpRewardRoleTargets,
  type XpRewardRoleReconciliationResult,
} from './xp-reward-roles.js';

const SWEEP_CONCURRENCY = 3;

export interface XpRoleSweepResult extends Record<string, number> {
  membersFetched: number;
  xpProfiles: number;
  profilesWithoutMember: number;
  candidates: number;
  processed: number;
  addedRoles: number;
  removedRoles: number;
  skippedRoles: number;
  failedRoles: number;
  durationMs: number;
}

export async function sweepGuildXpRewardRoles(input: {
  guild: Guild;
  prisma: PrismaClient;
  config: XpLevelConfig;
  logger: Logger;
}): Promise<XpRoleSweepResult> {
  const startedAt = Date.now();
  const [members, profiles] = await Promise.all([
    input.guild.members.fetch(),
    listGuildXpProfiles(input.prisma, input.guild.id),
  ]);
  const xpByUserId = new Map(profiles.map((profile) => [profile.userId, profile.xp]));
  const configuredRoleIds = new Set(
    resolveXpRewardRoleTargets(input.config, 0).map((target) => target.roleId),
  );
  const candidates = [...members.values()].filter((member) =>
    shouldSweepMember(member, xpByUserId, configuredRoleIds),
  );
  const totals = {
    processed: 0,
    addedRoles: 0,
    removedRoles: 0,
    skippedRoles: 0,
    failedRoles: 0,
  };

  let cursor = 0;
  const workerCount = Math.min(SWEEP_CONCURRENCY, candidates.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < candidates.length) {
        const index = cursor;
        cursor += 1;
        const member = candidates[index];
        if (!member) continue;

        const level = levelForXp(xpByUserId.get(member.id) ?? 0);
        const result = await reconcileXpRewardRoles({
          member,
          config: input.config,
          level,
          logger: input.logger,
        });
        addResult(totals, result);
      }
    }),
  );

  const memberIds = new Set(members.keys());
  return {
    membersFetched: members.size,
    xpProfiles: profiles.length,
    profilesWithoutMember: profiles.filter((profile) => !memberIds.has(profile.userId)).length,
    candidates: candidates.length,
    ...totals,
    durationMs: Date.now() - startedAt,
  };
}

export function shouldSweepMember(
  member: Pick<GuildMember, 'id' | 'user' | 'roles'>,
  xpByUserId: ReadonlyMap<string, number>,
  configuredRoleIds: ReadonlySet<string>,
): boolean {
  if (member.user.bot) return false;
  if ((xpByUserId.get(member.id) ?? 0) > 0) return true;
  for (const roleId of configuredRoleIds) {
    if (member.roles.cache.has(roleId)) return true;
  }
  return false;
}

function addResult(
  totals: {
    processed: number;
    addedRoles: number;
    removedRoles: number;
    skippedRoles: number;
    failedRoles: number;
  },
  result: XpRewardRoleReconciliationResult,
): void {
  totals.processed += 1;
  totals.addedRoles += result.addedRoleIds.length;
  totals.removedRoles += result.removedRoleIds.length;
  totals.skippedRoles += result.skippedRoleIds.length;
  totals.failedRoles += result.failedRoleIds.length;
}
