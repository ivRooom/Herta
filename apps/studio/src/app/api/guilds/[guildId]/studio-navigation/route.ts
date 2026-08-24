import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readRequestBodyBytes, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isDiscordGuildId } from '@/lib/guild-context-nav';
import {
  parseStoredStudioNavigationConfig,
  parseStudioNavigationPatch,
  studioNavigationSettingsResource,
} from '@/lib/studio-navigation-config';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';

export const dynamic = 'force-dynamic';

const MAX_NAVIGATION_PATCH_BODY_BYTES = 4 * 1024;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  if (!isDiscordGuildId(guildId)) {
    return NextResponse.json({ error: 'Server IDが不正です' }, { status: 400 });
  }

  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;

  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { settingsJson: true },
  });
  const config = parseStoredStudioNavigationConfig(settings?.settingsJson);
  const canManage = hasEffectivePluginPermission(
    access.access,
    'studio.settings.write',
    studioNavigationSettingsResource(guildId),
  );

  return NextResponse.json({ ...config, canManage });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'application/jsonが必要です' }, { status: 415 });
  }

  const { guildId } = await params;
  if (!isDiscordGuildId(guildId)) {
    return NextResponse.json({ error: 'Server IDが不正です' }, { status: 400 });
  }

  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;
  if (
    !hasEffectivePluginPermission(
      access.access,
      'studio.settings.write',
      studioNavigationSettingsResource(guildId),
    )
  ) {
    return NextResponse.json(
      {
        error: 'Studioのナビゲーション表示を変更する権限がありません',
        resource: studioNavigationSettingsResource(guildId),
      },
      { status: 403 },
    );
  }

  const body = await readNavigationPatchBody(request);
  if ('response' in body) return body.response;

  // GuildSettingsがまだ存在しないGuildでも安全に初期化する。既存行は変更しない。
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: {
      guildId,
      modRoleIds: [],
      adminRoleIds: [],
      settingsJson: {},
    },
    update: {},
  });

  // settingsJson全体をread-modify-writeしない。DB側のjsonb部分更新にすることで、
  // 別設定の同時更新を上書きせずstudioNavigation配下の対象fieldだけを変更する。
  // 古いデータや手動編集でroot/studioNavigationがobject以外になっていても、
  // object部分だけを安全に再初期化して今回の設定更新で復旧できるようにする。
  const visiblePluginTabIdsJson = JSON.stringify(body.value.visiblePluginTabIds);
  await prisma.$executeRaw`
    UPDATE guild_settings
    SET settings_json = jsonb_set(
          CASE
            WHEN jsonb_typeof(COALESCE(settings_json, '{}'::jsonb)) = 'object'
              THEN COALESCE(settings_json, '{}'::jsonb)
            ELSE '{}'::jsonb
          END,
          '{studioNavigation}',
          (
            CASE
              WHEN jsonb_typeof(COALESCE(settings_json -> 'studioNavigation', '{}'::jsonb)) = 'object'
                THEN COALESCE(settings_json -> 'studioNavigation', '{}'::jsonb)
              ELSE '{}'::jsonb
            END
          ) || jsonb_build_object('visiblePluginTabIds', ${visiblePluginTabIdsJson}::jsonb),
          true
        ),
        version = version + 1,
        updated_at = NOW()
    WHERE guild_id = ${guildId}
  `;

  return NextResponse.json({ ...body.value, canManage: true });
}

async function readNavigationPatchBody(
  request: Request,
): Promise<
  | { value: ReturnType<typeof parseStoredStudioNavigationConfig> }
  | { response: Response }
> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_NAVIGATION_PATCH_BODY_BYTES);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    const result = parseStudioNavigationPatch(parsed);
    if (!result.ok) {
      return { response: NextResponse.json({ error: result.error }, { status: 400 }) };
    }
    return { value: result.value };
  } catch (error) {
    return {
      response: NextResponse.json(
        {
          error:
            error instanceof RequestBodyTooLargeError
              ? 'ナビゲーション設定が大きすぎます'
              : 'JSON bodyが不正です',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}
