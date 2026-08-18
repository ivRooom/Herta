import { hasStudioPermission, resolveStudioAccess, type StudioAccessResult } from './studio-access.ts';
import {
  hasConfiguredStudioPagePolicy,
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

  // page.viewをまだ導入していない既存Policyは従来のページ閲覧挙動を維持する。
  // 実効Policyにpage.viewを1つでも定義した時点からpage単位のdefault denyへ移行する。
  if (!hasConfiguredStudioPagePolicy(resolved.access)) return resolved;

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
