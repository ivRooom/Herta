import type { StudioPolicyAction } from './studio-access-policy.ts';
import { resolveStudioAccess, type StudioAccessResult } from './studio-access.ts';
import { hasEffectivePluginPermission } from './studio-plugin-permissions.ts';

export async function authorizeBirthdayStudioPermission(
  guildId: string,
  userId: string,
  action: StudioPolicyAction,
  resource: string,
): Promise<StudioAccessResult> {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (hasEffectivePluginPermission(resolved.access, action, resource)) return resolved;

  return {
    ok: false,
    response: Response.json(
      { error: 'このBirthday Card操作を実行するHerta Studio権限がありません' },
      { status: 403 },
    ),
  };
}
