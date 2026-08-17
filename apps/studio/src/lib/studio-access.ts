import { getGuildMemberById } from '@/lib/bot-guild-members';
import { authorizeGuild } from '@/lib/guild-plugins';
import {
  evaluateStudioAccessPolicy,
  isStudioRootRole,
  type StudioPolicyAction,
} from '@/lib/studio-access-policy';
import { listStudioRolePolicies, type StudioRolePolicyRecord } from '@/lib/studio-role-policy-store';

export interface StudioAccessContext {
  guildId: string;
  userId: string;
  roleIds: string[];
  isRoot: boolean;
  policies: StudioRolePolicyRecord[];
}

export async function resolveStudioAccess(
  guildId: string,
  userId: string,
): Promise<
  | { access: StudioAccessContext; guild: Awaited<ReturnType<typeof authorizeGuild>> extends infer T ? T : never }
  | { response: Response }
> {
  const guildAuthorization = await authorizeGuild(guildId, userId);
  if ('response' in guildAuthorization) return guildAuthorization;

  const member = await getGuildMemberById(guildId, userId);
  if (!member) {
    return {
      response: Response.json(
        { error: 'Discordロールを確認できませんでした。Bot接続状態を確認してください' },
        { status: 503 },
      ),
    };
  }

  const isRoot = isStudioRootRole(member.roleIds);
  const policies = isRoot ? [] : await listStudioRolePolicies(guildId);
  return {
    guild: guildAuthorization.guild as never,
    access: { guildId, userId, roleIds: member.roleIds, isRoot, policies },
  };
}

export async function authorizeStudioPermission(
  guildId: string,
  userId: string,
  action: StudioPolicyAction,
  resource = `guild:${guildId}:*`,
) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if ('response' in resolved) return resolved;
  if (hasStudioPermission(resolved.access, action, resource)) return resolved;

  return {
    response: Response.json(
      { error: 'この操作を実行するHerta Studio権限がありません' },
      { status: 403 },
    ),
  };
}

export function hasStudioPermission(
  access: StudioAccessContext,
  action: StudioPolicyAction,
  resource = `guild:${access.guildId}:*`,
): boolean {
  if (access.isRoot) return true;
  return evaluateStudioAccessPolicy({
    roleIds: access.roleIds,
    policies: access.policies,
    action,
    resource,
  });
}
