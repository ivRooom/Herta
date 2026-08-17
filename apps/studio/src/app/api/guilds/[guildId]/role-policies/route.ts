import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { prisma } from '@/lib/db';
import { authorizeStudioPermission, resolveStudioAccess } from '@/lib/studio-access';
import {
  STUDIO_ROOT_DISCORD_ROLE_ID,
  validateStudioAccessPolicy,
} from '@/lib/studio-access-policy';
import {
  deleteStudioRolePolicy,
  listStudioRolePolicies,
  saveStudioRolePolicy,
} from '@/lib/studio-role-policy-store';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const MAX_POLICY_BODY_BYTES = 64 * 1024;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.roles.read',
    `guild:${guildId}:role:*`,
  );
  if ('response' in authorization) return authorization.response;

  const options = await getGuildConfigurationOptions(guildId);
  if (!options) {
    return NextResponse.json({ error: 'Discordロール一覧を取得できませんでした' }, { status: 503 });
  }

  return NextResponse.json({
    rootRoleId: STUDIO_ROOT_DISCORD_ROLE_ID,
    canEdit: authorization.access.isRoot,
    roles: options.roles.map((role) => ({ id: role.id, name: role.name, color: role.color })),
    policies: await listStudioRolePolicies(guildId),
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  const { guildId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if ('response' in root) return root.response;

  const body = await parseJsonBody(request);
  if ('response' in body) return body.response;
  const discordRoleId = typeof body.value.discordRoleId === 'string' ? body.value.discordRoleId : '';
  if (!/^\d{17,20}$/u.test(discordRoleId)) {
    return NextResponse.json({ error: 'Discord Role IDが不正です' }, { status: 400 });
  }
  if (discordRoleId === STUDIO_ROOT_DISCORD_ROLE_ID) {
    return NextResponse.json({ error: 'root RoleのPolicyは変更できません' }, { status: 400 });
  }

  const options = await getGuildConfigurationOptions(guildId);
  const role = options?.roles.find((candidate) => candidate.id === discordRoleId);
  if (!role) return NextResponse.json({ error: 'Discord Roleが見つかりません' }, { status: 404 });

  const validation = validateStudioAccessPolicy(body.value.policy, guildId);
  if (!validation.valid || !validation.policy) {
    return NextResponse.json({ error: 'Policyが不正です', details: validation.errors }, { status: 400 });
  }

  const previous = (await listStudioRolePolicies(guildId)).find(
    (policy) => policy.discordRoleId === discordRoleId,
  );
  const policy = await saveStudioRolePolicy(guildId, session.user.id, {
    discordRoleId,
    roleName: role.name,
    policy: validation.policy,
  });
  await recordAudit(guildId, session.user.id, 'studio_role_policy.updated', discordRoleId, {
    roleName: role.name,
    previousPolicy: previous?.policy ?? null,
    nextPolicy: policy.policy,
  });
  return NextResponse.json({ policy });
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
  if ('response' in root) return root.response;

  const roleId = new URL(request.url).searchParams.get('roleId') ?? '';
  if (!/^\d{17,20}$/u.test(roleId) || roleId === STUDIO_ROOT_DISCORD_ROLE_ID) {
    return NextResponse.json({ error: '削除対象Roleが不正です' }, { status: 400 });
  }
  const previous = (await listStudioRolePolicies(guildId)).find(
    (policy) => policy.discordRoleId === roleId,
  );
  await deleteStudioRolePolicy(guildId, roleId);
  await recordAudit(guildId, session.user.id, 'studio_role_policy.deleted', roleId, {
    previousPolicy: previous?.policy ?? null,
  });
  return NextResponse.json({ deleted: true });
}

async function requireRoot(guildId: string, userId: string) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if ('response' in resolved) return resolved;
  if (resolved.access.isRoot) return resolved;
  return {
    response: NextResponse.json(
      { error: 'Role Policyの変更にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
}

async function parseJsonBody(
  request: Request,
): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_POLICY_BODY_BYTES);
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { response: NextResponse.json({ error: 'JSONオブジェクトが必要です' }, { status: 400 }) };
    }
    return { value: value as Record<string, unknown> };
  } catch (error) {
    return {
      response: NextResponse.json(
        { error: error instanceof RequestBodyTooLargeError ? 'Policyが大きすぎます' : 'JSONが不正です' },
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
      targetType: 'discord_role',
      targetId,
      changes,
      severity: 'warning',
      metadata: { operationSource: 'studio', securitySensitive: true },
    },
  });
}
