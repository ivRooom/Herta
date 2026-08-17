import {
  createStudioAccessGroup,
  deleteStudioAccessGroup,
  listStudioAccessGroupMembers,
  listStudioAccessGroups,
  updateStudioAccessGroup,
} from '@herta/db';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { authorizeStudioPermission, resolveStudioAccess } from '@/lib/studio-access';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const MAX_GROUP_BODY_BYTES = 16 * 1024;
const GROUP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.roles.read',
    `guild:${guildId}:group:*`,
  );
  if (!authorization.ok) return authorization.response;
  const [groups, members] = await Promise.all([
    listStudioAccessGroups(prisma, guildId),
    listStudioAccessGroupMembers(prisma, guildId),
  ]);
  return NextResponse.json({ groups, members, canEdit: authorization.access.isRoot });
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  const { guildId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if (!root.ok) return root.response;
  const body = await parseJsonBody(request);
  if ('response' in body) return body.response;
  const metadata = parseGroupMetadata(body.value);
  if ('error' in metadata) return NextResponse.json({ error: metadata.error }, { status: 400 });
  const duplicate = (await listStudioAccessGroups(prisma, guildId)).some(
    (group) => group.name.toLocaleLowerCase() === metadata.name.toLocaleLowerCase(),
  );
  if (duplicate) return NextResponse.json({ error: '同名のGroupが存在します' }, { status: 409 });

  try {
    const group = await createStudioAccessGroup(prisma, {
      guildId,
      name: metadata.name,
      description: metadata.description,
      actorId: session.user.id,
    });
    await recordAudit(guildId, session.user.id, 'studio_access_group.created', group.id, {
      name: group.name,
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    console.error('Failed to create Studio access group', {
      guildId,
      actorId: session.user.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Groupを作成できませんでした' }, { status: 409 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  const { guildId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if (!root.ok) return root.response;
  const body = await parseJsonBody(request);
  if ('response' in body) return body.response;
  const groupId = typeof body.value.groupId === 'string' ? body.value.groupId : '';
  if (!GROUP_ID_PATTERN.test(groupId)) {
    return NextResponse.json({ error: 'Group IDが不正です' }, { status: 400 });
  }
  const metadata = parseGroupMetadata(body.value);
  if ('error' in metadata) return NextResponse.json({ error: metadata.error }, { status: 400 });
  const groups = await listStudioAccessGroups(prisma, guildId);
  if (!groups.some((group) => group.id === groupId)) {
    return NextResponse.json({ error: 'Groupが見つかりません' }, { status: 404 });
  }
  if (
    groups.some(
      (group) =>
        group.id !== groupId &&
        group.name.toLocaleLowerCase() === metadata.name.toLocaleLowerCase(),
    )
  ) {
    return NextResponse.json({ error: '同名のGroupが存在します' }, { status: 409 });
  }

  try {
    const updated = await updateStudioAccessGroup(prisma, {
      guildId,
      groupId,
      name: metadata.name,
      description: metadata.description,
      actorId: session.user.id,
    });
    if (!updated) return NextResponse.json({ error: 'Groupが見つかりません' }, { status: 404 });
    await recordAudit(guildId, session.user.id, 'studio_access_group.updated', groupId, {
      name: metadata.name,
    });
    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('Failed to update Studio access group', {
      guildId,
      groupId,
      actorId: session.user.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Groupを更新できませんでした' }, { status: 409 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  const { guildId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if (!root.ok) return root.response;
  const groupId = new URL(request.url).searchParams.get('groupId') ?? '';
  if (!GROUP_ID_PATTERN.test(groupId)) {
    return NextResponse.json({ error: 'Group IDが不正です' }, { status: 400 });
  }
  const current = (await listStudioAccessGroups(prisma, guildId)).find((group) => group.id === groupId);
  if (!current) return NextResponse.json({ error: 'Groupが見つかりません' }, { status: 404 });
  const deleted = await deleteStudioAccessGroup(prisma, guildId, groupId);
  if (!deleted) return NextResponse.json({ error: 'Groupが見つかりません' }, { status: 404 });
  await recordAudit(guildId, session.user.id, 'studio_access_group.deleted', groupId, {
    name: current.name,
  });
  return NextResponse.json({ deleted: true });
}

async function requireRoot(guildId: string, userId: string) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (resolved.access.isRoot) return resolved;
  return {
    ok: false as const,
    response: NextResponse.json(
      { error: 'Groupの変更にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
}

function parseGroupMetadata(value: Record<string, unknown>) {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (name.length < 1 || name.length > 100) return { error: 'Group名は1〜100文字で指定してください' };
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (description.length > 500) return { error: '説明は500文字以内で指定してください' };
  return { name, description: description || null };
}

async function parseJsonBody(
  request: Request,
): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_GROUP_BODY_BYTES);
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        response: NextResponse.json({ error: 'JSONオブジェクトが必要です' }, { status: 400 }),
      };
    }
    return { value: value as Record<string, unknown> };
  } catch (error) {
    return {
      response: NextResponse.json(
        {
          error:
            error instanceof RequestBodyTooLargeError ? 'Group設定が大きすぎます' : 'JSONが不正です',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}

async function recordAudit(
  guildId: string,
  actorId: string,
  event: string,
  targetId: string,
  changes: object,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      guildId,
      actorId,
      event,
      targetType: 'studio_access_group',
      targetId,
      changes,
      severity: 'warning',
      metadata: { operationSource: 'studio', securitySensitive: true },
    },
  });
}
