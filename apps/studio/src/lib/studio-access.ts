import type { ManageableGuild } from '@/lib/discord';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { authorizeGuild } from '@/lib/guild-plugins';
import {
  evaluateStudioAccessPolicy,
  isStudioRootRole,
  type StudioPolicyAction,
} from '@/lib/studio-access-policy';
import {
  listStudioRolePolicies,
  type StudioRolePolicyRecord,
} from '@/lib/studio-role-policy-store';

export interface StudioAccessContext {
  guildId: string;
  userId: string;
  roleIds: string[];
  isRoot: boolean;
  policies: StudioRolePolicyRecord[];
}

export type StudioAccessResult =
  | { ok: true; guild: ManageableGuild; access: StudioAccessContext }
  | { ok: false; response: Response };

export async function resolveStudioAccess(
  guildId: string,
  userId: string,
): Promise<StudioAccessResult> {
  const guildAuthorization = await authorizeGuild(guildId, userId);
  if (guildAuthorization.response) {
    return { ok: false, response: guildAuthorization.response };
  }

  const member = await getGuildMemberById(guildId, userId);
  if (!member) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Discordロールを確認できませんでした。Bot接続状態を確認してください' },
        { status: 503 },
      ),
    };
  }

  const isRoot = isStudioRootRole(member.roleIds);
  const policies = isRoot ? [] : await listStudioRolePolicies(guildId);
  return {
    ok: true,
    guild: guildAuthorization.guild,
    access: { guildId, userId, roleIds: member.roleIds, isRoot, policies },
  };
}

export async function authorizeStudioPermission(
  guildId: string,
  userId: string,
  action: StudioPolicyAction,
  resource = `guild:${guildId}:*`,
): Promise<StudioAccessResult> {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (hasStudioPermission(resolved.access, action, resource)) return resolved;

  return {
    ok: false,
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
