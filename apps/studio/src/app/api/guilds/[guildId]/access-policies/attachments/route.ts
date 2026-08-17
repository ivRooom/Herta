import {
  attachStudioAccessPolicy,
  detachStudioAccessPolicy,
  findManagedStudioAccessPolicy,
  isStudioAccessPrincipalType,
  listStudioAccessGroups,
  type StudioAccessPrincipalType,
} from '@herta/db';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

const MAX_ATTACHMENT_BODY_BYTES = 16 * 1024;
const POLICY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const GROUP_ID_PATTERN = POLICY_ID_PATTERN;

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  return mutateAttachment(request, params, 'attach');
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  return mutateAttachment(request, params, 'detach');
}

async function mutateAttachment(
  request: Request,
  params: Promise<{ guildId: string }>,
  operation: 'attach' | 'detach',
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
  const policyId = typeof body.value.policyId === 'string' ? body.value.policyId : '';
  const principalType =
    typeof body.value.principalType === 'string' ? body.value.principalType : '';
  const principalId = typeof body.value.principalId === 'string' ? body.value.principalId : '';
  if (!POLICY_ID_PATTERN.test(policyId)) {
    return NextResponse.json({ error: 'Policy IDが不正です' }, { status: 400 });
  }
  if (!isStudioAccessPrincipalType(principalType)) {
    return NextResponse.json({ error: 'Principal種別が不正です' }, { status: 400 });
  }
  const policy = await findManagedStudioAccessPolicy(prisma, guildId, policyId);
  if (!policy) return NextResponse.json({ error: 'Policyが見つかりません' }, { status: 404 });

  const principalError = await validatePrincipal(guildId, principalType, principalId);
  if (principalError)
    return NextResponse.json({ error: principalError.message }, { status: principalError.status });

  const changed =
    operation === 'attach'
      ? await attachStudioAccessPolicy(prisma, {
          guildId,
          policyId,
          principalType,
          principalId,
          actorId: session.user.id,
        })
      : await detachStudioAccessPolicy(prisma, {
          guildId,
          policyId,
          principalType,
          principalId,
        });

  if (changed) {
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: `studio_access_policy.${operation === 'attach' ? 'attached' : 'detached'}`,
        targetType: 'studio_access_policy',
        targetId: policyId,
        changes: { policyName: policy.name, principalType, principalId },
        severity: 'warning',
        metadata: { operationSource: 'studio', securitySensitive: true },
      },
    });
  }
  return NextResponse.json({ changed });
}

async function validatePrincipal(
  guildId: string,
  principalType: StudioAccessPrincipalType,
  principalId: string,
): Promise<{ message: string; status: number } | null> {
  if (principalType === 'role') {
    if (!DISCORD_ID_PATTERN.test(principalId) || principalId === STUDIO_ROOT_DISCORD_ROLE_ID) {
      return { message: 'Discord Role IDが不正です', status: 400 };
    }
    const options = await getGuildConfigurationOptions(guildId);
    if (!options) return { message: 'Discord Role一覧を取得できませんでした', status: 503 };
    if (!options.roles.some((role) => role.id === principalId)) {
      return { message: 'このGuildにDiscord Roleが存在しません', status: 404 };
    }
    return null;
  }
  if (principalType === 'user') {
    if (!DISCORD_ID_PATTERN.test(principalId))
      return { message: 'Discord User IDが不正です', status: 400 };
    const member = await getGuildMemberById(guildId, principalId);
    if (!member) return { message: 'このGuildのメンバーを確認できません', status: 404 };
    return null;
  }
  if (!GROUP_ID_PATTERN.test(principalId)) return { message: 'Group IDが不正です', status: 400 };
  const groups = await listStudioAccessGroups(prisma, guildId);
  if (!groups.some((group) => group.id === principalId)) {
    return { message: 'このGuildにGroupが存在しません', status: 404 };
  }
  return null;
}

async function requireRoot(guildId: string, userId: string) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (resolved.access.isRoot) return resolved;
  return {
    ok: false as const,
    response: NextResponse.json(
      { error: 'Policy Attachmentの変更にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
}

async function parseJsonBody(
  request: Request,
): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_ATTACHMENT_BODY_BYTES);
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
              ? 'Attachmentリクエストが大きすぎます'
              : 'JSONが不正です',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}
