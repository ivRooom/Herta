import { hasStudioPermission, resolveStudioAccess, type StudioAccessResult } from './studio-access.ts';
import {
  hasApplicableStudioPolicy,
  studioPageResource,
  type StudioPageId,
} from './studio-policy-resources.ts';

export async function authorizeStudioPageView(
  guildId: string,
  userId: string,
  pageId: StudioPageId,
): Promise<StudioAccessResult> {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (resolved.access.isRoot) return resolved;

  // Managed/Legacy Policyをまだ割り当てていないManage Guildユーザーは従来挙動を維持する。
  // Policyを1つでも適用した時点からdefault denyへ移行し、page resourceを明示的に評価する。
  if (!hasApplicableStudioPolicy(resolved.access)) return resolved;

  const resource = studioPageResource(guildId, pageId);
  if (hasStudioPermission(resolved.access, 'studio.page.view', resource)) return resolved;

  return {
    ok: false,
    response: Response.json(
      {
        error: 'このStudioページを閲覧する権限がありません',
        resource,
      },
      { status: 403 },
    ),
  };
}
