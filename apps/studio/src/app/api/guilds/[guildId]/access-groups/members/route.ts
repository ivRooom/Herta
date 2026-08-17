import {
  addStudioAccessGroupMember,
  listStudioAccessGroups,
  removeStudioAccessGroupMember,
} from '@herta/db';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

const MAX_MEMBER_BODY_BYTES = 16 * 1024;
const GROUP_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DISCORD_ID_PATTERN = /^\d{17,20}$/u;

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  return mutateMembership(request, params, 'add');
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  return mutateMembership(request, params, 'remove');
}

async function mutateMembership(
  request: Request,
  params: Promise<{ guildId: string }>,
  operation: 'add' | 'remove',
) {
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
  const userId = typeof body.value.userId === 'string' ? body.value.userId : '';
  if (!GROUP_ID_PATTERN.test(groupId)) {
    return NextResponse.json({ error: 'Group IDが不正です' }, { status: 400 });
  }
  if (!DISCORD_ID_PATTERN.test(userId)) {
    return NextResponse.json({ error: 'Discord User IDが不正です' }, { status: 400 });
  }
  const group = (await listStudioAccessGroups(prisma, guildId)).find(
    (candidate) => candidate.id === groupId,
  );
  if (!group) return NextResponse.json({ error: 'Groupが見つかりません' }, { status: 404 });
  if (operation === 'add') {
    const member = await getGuildMemberById(guildId, userId);
    if (!member) {
      return NextResponse.json({ error: 'このGuildのメンバーを確認できません' }, { status: 404 });
    }
  }

  const changed =
    operation === 'add'
      ? await addStudioAccessGroupMember(prisma, {
          guildId,
          groupId,
          userId,
          actorId: session.user.id,
        })
      : await removeStudioAccessGroupMember(prisma, { guildId, groupId, userId });
  if (changed) {
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: `studio_access_group.member_${operation === 'add' ? 'added' : 'removed'}`,
        targetType: 'studio_access_group',
        targetId: groupId,
        changes: { groupName: group.name, userId },
        severity: 'warning',
        metadata: { operationSource: 'studio', securitySensitive: true },
      },
    });
  }
  return NextResponse.json({ changed });
}

async function requireRoot(guildId: string, userId: string) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (resolved.access.isRoot) return resolved;
  return {
    ok: false as const,
    response: NextResponse.json(
      { error: 'Group Memberの変更にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
}

async function parseJsonBody(
  request: Request,
): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_MEMBER_BODY_BYTES);
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
            error instanceof RequestBodyTooLargeError
              ? 'Group Memberリクエストが大きすぎます'
              : 'JSONが不正です',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}
