import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  AchievementOperationValidationError,
  applyAchievementOperation,
  getAchievementCatalog,
  getAchievementOperationsSnapshot,
  getAchievementUserProgress,
  parseAchievementOperationRequest,
} from '@/lib/achievement-operations';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const plugin = await getGuildPlugin(guildId, 'achievements');
  if (!plugin) return NextResponse.json({ error: 'Achievements Pluginが見つかりません' }, { status: 404 });

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId')?.trim() ?? '';
  try {
    const [snapshot, progress] = await Promise.all([
      getAchievementOperationsSnapshot(guildId, plugin.config),
      userId ? getAchievementUserProgress(guildId, userId, plugin.config) : Promise.resolve(null),
    ]);
    return NextResponse.json(
      {
        snapshot,
        catalog: getAchievementCatalog(plugin.config),
        progress,
        pluginEnabled: plugin.enabled,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return achievementOperationErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body が不正です' }, { status: 400 });
  }
  const parsed = parseAchievementOperationRequest(body);
  if (!parsed) return NextResponse.json({ error: 'Achievement操作の入力が不正です' }, { status: 400 });

  const plugin = await getGuildPlugin(guildId, 'achievements');
  if (!plugin) return NextResponse.json({ error: 'Achievements Pluginが見つかりません' }, { status: 404 });

  try {
    const result = await applyAchievementOperation({
      guildId,
      actorId: session.user.id,
      config: plugin.config,
      request: parsed,
    });
    const progress = await getAchievementUserProgress(guildId, parsed.userId, plugin.config);
    return NextResponse.json({ result, progress });
  } catch (error) {
    return achievementOperationErrorResponse(error);
  }
}

function achievementOperationErrorResponse(error: unknown): NextResponse {
  if (error instanceof AchievementOperationValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Achievement operations API request failed', error);
  return NextResponse.json({ error: 'Achievementの運用処理に失敗しました' }, { status: 500 });
}
