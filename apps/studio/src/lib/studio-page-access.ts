import {
  resolveStudioAccess,
  studioPermissionDecision,
  type StudioAccessResult,
} from './studio-access.ts';
import { mergeStudioPolicyDecisions } from './studio-access-policy.ts';
import {
  hasConfiguredStudioPagePolicy,
  studioPageResource,
  studioParentPageId,
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
  const exactDecision = studioPermissionDecision(resolved.access, 'studio.page.view', resource);

  // Moderationの旧page権限はsubpage分割後も一括権限として扱う。
  // 親・子のどちらかにExplicit Denyがある場合はAWS IAMと同様にAllowより優先する。
  const parentPageId = studioParentPageId(pageId);
  const parentDecision = parentPageId
    ? studioPermissionDecision(
        resolved.access,
        'studio.page.view',
        studioPageResource(guildId, parentPageId),
      )
    : null;
  const decision = mergeStudioPolicyDecisions(exactDecision, parentDecision);
  if (decision === 'Allow') return resolved;

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
