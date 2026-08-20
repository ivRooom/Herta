import { listEffectiveStudioAccessPolicyDocuments } from '@herta/db';
import type { ManageableGuild } from '@/lib/discord';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { prisma } from '@/lib/db';
import { authorizeGuild } from '@/lib/guild-plugins';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';
import {
  evaluateStudioPolicyDocuments,
  isStudioRootRole,
  validateStudioAccessPolicy,
  type StudioAccessPolicy,
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
  managedPolicies: StudioAccessPolicy[];
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
  if (isRoot) {
    return {
      ok: true,
      guild: guildAuthorization.guild,
      access: {
        guildId,
        userId,
        roleIds: member.roleIds,
        isRoot: true,
        policies: [],
        managedPolicies: [],
      },
    };
  }

  try {
    const [policies, managedDocuments] = await Promise.all([
      listStudioRolePolicies(guildId),
      listEffectiveStudioAccessPolicyDocuments(prisma, guildId, userId, member.roleIds),
    ]);
    const managedPolicies: StudioAccessPolicy[] = [];
    for (const managedDocument of managedDocuments) {
      const validation = validateStudioAccessPolicy(managedDocument.document, guildId);
      if (!validation.valid || !validation.policy) {
        console.error('Invalid managed Studio access policy stored in database', {
          guildId,
          userId,
          policyId: managedDocument.id,
          validationErrors: validation.errors,
        });
        return {
          ok: false,
          response: Response.json(
            { error: 'Studio権限設定を安全に評価できませんでした' },
            { status: 503 },
          ),
        };
      }
      managedPolicies.push(validation.policy);
    }

    return {
      ok: true,
      guild: guildAuthorization.guild,
      access: { guildId, userId, roleIds: member.roleIds, isRoot, policies, managedPolicies },
    };
  } catch (error) {
    console.error('Failed to resolve Studio access policies', {
      guildId,
      userId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return {
      ok: false,
      response: Response.json({ error: 'Studio権限設定を取得できませんでした' }, { status: 503 }),
    };
  }
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

  return studioPermissionDenied();
}

/**
 * Authorizes resources that participate in Herta's staged IAM rollout.
 *
 * Manage Guild users with no effective Studio policy keep the legacy allow behavior,
 * matching `hasEffectivePluginPermission` and the corresponding Studio UI. Once any
 * effective policy is attached, normal policy evaluation (including explicit Deny)
 * becomes authoritative.
 */
export async function authorizeEffectiveStudioPermission(
  guildId: string,
  userId: string,
  action: StudioPolicyAction,
  resource = `guild:${guildId}:*`,
): Promise<StudioAccessResult> {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (hasEffectivePluginPermission(resolved.access, action, resource)) return resolved;

  return studioPermissionDenied();
}

export function hasStudioPermission(
  access: StudioAccessContext,
  action: StudioPolicyAction,
  resource = `guild:${access.guildId}:*`,
): boolean {
  if (access.isRoot) return true;
  const activeRoleIds = new Set(access.roleIds);
  const legacyPolicies = access.policies
    .filter((record) => activeRoleIds.has(record.discordRoleId))
    .map((record) => record.policy);
  return evaluateStudioPolicyDocuments(
    [...access.managedPolicies, ...legacyPolicies],
    action,
    resource,
  );
}

function studioPermissionDenied(): StudioAccessResult {
  return {
    ok: false,
    response: Response.json(
      { error: 'この操作を実行するHerta Studio権限がありません' },
      { status: 403 },
    ),
  };
}
