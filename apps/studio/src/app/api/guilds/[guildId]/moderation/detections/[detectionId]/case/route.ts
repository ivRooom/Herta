import { NextResponse } from 'next/server';
import {
  createModerationCaseFromDetection,
  getModerationCaseForDetection,
  ModerationValidationError,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ guildId: string; detectionId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const authorization = await authorizeRequest(params);
  if ('response' in authorization) return authorization.response;

  try {
    const moderationCase = await getModerationCaseForDetection(
      prisma as unknown as ModerationPrismaClient,
      authorization.guildId,
      authorization.detectionId,
    );
    return NextResponse.json({ case: moderationCase });
  } catch (error) {
    return caseErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const authorization = await authorizeRequest(params);
  if ('response' in authorization) return authorization.response;
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  try {
    const result = await createModerationCaseFromDetection(
      prisma as unknown as ModerationPrismaClient,
      {
        guildId: authorization.guildId,
        detectionId: authorization.detectionId,
        actorId: authorization.actorId,
      },
    );
    if (!result) {
      return NextResponse.json({ error: '検知履歴が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return caseErrorResponse(error);
  }
}

async function authorizeRequest(
  params: RouteContext['params'],
): Promise<{ guildId: string; detectionId: string; actorId: string } | { response: Response }> {
  const session = await auth();
  if (!session?.user) {
    return { response: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };
  }

  const { guildId, detectionId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if (authorization.response) return { response: authorization.response };

  return { guildId, detectionId, actorId: session.user.id };
}

function caseErrorResponse(error: unknown): NextResponse {
  if (error instanceof ModerationValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Moderation detection case request failed', error);
  return NextResponse.json({ error: 'ケース操作に失敗しました' }, { status: 500 });
}
