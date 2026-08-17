import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { authorizeGuild } from '@/lib/guild-plugins';
import {
  deleteMessageStudioDraft,
  listMessageStudioDrafts,
  parseMessageStudioDraftPayload,
  saveMessageStudioDraft,
  toDraftJson,
} from '@/lib/message-studio-drafts';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const MAX_DRAFT_BODY_BYTES = 96 * 1024;
type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const drafts = await listMessageStudioDrafts(guildId, session.user.id);
  return NextResponse.json({ drafts: drafts.map(toDraftJson) });
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正な送信元からのリクエストです' }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const body = await readJsonObject(request);
  if ('response' in body) return body.response;
  const name = typeof body.value.name === 'string' ? body.value.name.trim() : '';
  const id = typeof body.value.id === 'string' ? body.value.id.trim() : undefined;
  const payload = parseMessageStudioDraftPayload(body.value.payload);
  if (!name || name.length > 100 || !payload) {
    return NextResponse.json({ error: '下書きの内容が不正です' }, { status: 400 });
  }

  try {
    const draft = await saveMessageStudioDraft(guildId, session.user.id, { id, name, payload });
    return NextResponse.json({ draft: toDraftJson(draft) }, { status: id ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'draft_not_owned') {
      return NextResponse.json({ error: 'この下書きは更新できません' }, { status: 403 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正な送信元からのリクエストです' }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const id = new URL(request.url).searchParams.get('id') ?? '';
  const deleted = await deleteMessageStudioDraft(guildId, session.user.id, id);
  if (!deleted) return NextResponse.json({ error: '下書きが見つかりません' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

async function readJsonObject(
  request: Request,
): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_DRAFT_BODY_BYTES);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { response: NextResponse.json({ error: 'JSONオブジェクトが必要です' }, { status: 400 }) };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      response: NextResponse.json(
        {
          error:
            error instanceof RequestBodyTooLargeError
              ? '下書きデータが大きすぎます'
              : 'JSONが不正です',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}
