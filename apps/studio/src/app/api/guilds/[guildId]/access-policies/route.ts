import {
  createManagedStudioAccessPolicy,
  deleteManagedStudioAccessPolicy,
  findManagedStudioAccessPolicy,
  listManagedStudioAccessPolicies,
  listStudioAccessPolicyAttachments,
  updateManagedStudioAccessPolicy,
} from '@herta/db';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isPrismaRawUniqueViolation } from '@/lib/prisma-raw-error';
import { authorizeStudioPermission, resolveStudioAccess } from '@/lib/studio-access';
import { validateStudioAccessPolicy } from '@/lib/studio-access-policy';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const MAX_POLICY_BODY_BYTES = 64 * 1024;
const POLICY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.roles.read',
    `guild:${guildId}:policy:*`,
  );
  if (!authorization.ok) return authorization.response;

  const [policies, attachments] = await Promise.all([
    listManagedStudioAccessPolicies(prisma, guildId),
    listStudioAccessPolicyAttachments(prisma, guildId),
  ]);
  return NextResponse.json({
    policies,
    attachments,
    canEdit: authorization.access.isRoot,
  });
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
  const metadata = parsePolicyMetadata(body.value);
  if ('error' in metadata) return NextResponse.json({ error: metadata.error }, { status: 400 });
  const validation = validateStudioAccessPolicy(body.value.policy, guildId);
  if (!validation.valid || !validation.policy) {
    return NextResponse.json(
      { error: 'Policyが不正です', details: validation.errors },
      { status: 400 },
    );
  }

  const duplicate = (await listManagedStudioAccessPolicies(prisma, guildId)).some(
    (policy) => policy.name.toLocaleLowerCase() === metadata.name.toLocaleLowerCase(),
  );
  if (duplicate) return NextResponse.json({ error: '同名のPolicyが存在します' }, { status: 409 });

  try {
    const policy = await createManagedStudioAccessPolicy(prisma, {
      guildId,
      name: metadata.name,
      description: metadata.description,
      document: validation.policy,
      actorId: session.user.id,
    });
    await recordAudit(guildId, session.user.id, 'studio_access_policy.created', policy.id, {
      name: policy.name,
      revision: policy.revision,
    });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    const duplicateName = isPrismaRawUniqueViolation(error);
    console.error('Failed to create managed Studio access policy', {
      guildId,
      actorId: session.user.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      duplicateName,
    });
    return NextResponse.json(
      { error: duplicateName ? '同名のPolicyが存在します' : 'Policyを作成できませんでした' },
      { status: duplicateName ? 409 : 500 },
    );
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
  const rawPolicyId = typeof body.value.policyId === 'string' ? body.value.policyId : '';
  if (!POLICY_ID_PATTERN.test(rawPolicyId)) {
    return NextResponse.json({ error: 'Policy IDが不正です' }, { status: 400 });
  }
  const policyId = rawPolicyId.toLowerCase();
  const current = await findManagedStudioAccessPolicy(prisma, guildId, policyId);
  if (!current) return NextResponse.json({ error: 'Policyが見つかりません' }, { status: 404 });

  const metadata = parsePolicyMetadata(body.value);
  if ('error' in metadata) return NextResponse.json({ error: metadata.error }, { status: 400 });
  const validation = validateStudioAccessPolicy(body.value.policy, guildId);
  if (!validation.valid || !validation.policy) {
    return NextResponse.json(
      { error: 'Policyが不正です', details: validation.errors },
      { status: 400 },
    );
  }
  const duplicate = (await listManagedStudioAccessPolicies(prisma, guildId)).some(
    (policy) =>
      policy.id !== policyId &&
      policy.name.toLocaleLowerCase() === metadata.name.toLocaleLowerCase(),
  );
  if (duplicate) return NextResponse.json({ error: '同名のPolicyが存在します' }, { status: 409 });

  try {
    const policy = await updateManagedStudioAccessPolicy(prisma, {
      guildId,
      policyId,
      name: metadata.name,
      description: metadata.description,
      document: validation.policy,
      actorId: session.user.id,
    });
    if (!policy) return NextResponse.json({ error: 'Policyが見つかりません' }, { status: 404 });
    await recordAudit(guildId, session.user.id, 'studio_access_policy.updated', policy.id, {
      name: policy.name,
      previousRevision: current.revision,
      revision: policy.revision,
    });
    return NextResponse.json({ policy });
  } catch (error) {
    const duplicateName = isPrismaRawUniqueViolation(error);
    console.error('Failed to update managed Studio access policy', {
      guildId,
      policyId,
      actorId: session.user.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      duplicateName,
    });
    return NextResponse.json(
      { error: duplicateName ? '同名のPolicyが存在します' : 'Policyを更新できませんでした' },
      { status: duplicateName ? 409 : 500 },
    );
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

  const rawPolicyId = new URL(request.url).searchParams.get('policyId') ?? '';
  if (!POLICY_ID_PATTERN.test(rawPolicyId)) {
    return NextResponse.json({ error: 'Policy IDが不正です' }, { status: 400 });
  }
  const policyId = rawPolicyId.toLowerCase();
  const current = await findManagedStudioAccessPolicy(prisma, guildId, policyId);
  if (!current) return NextResponse.json({ error: 'Policyが見つかりません' }, { status: 404 });
  const deleted = await deleteManagedStudioAccessPolicy(prisma, guildId, policyId);
  if (!deleted) return NextResponse.json({ error: 'Policyが見つかりません' }, { status: 404 });
  await recordAudit(guildId, session.user.id, 'studio_access_policy.deleted', policyId, {
    name: current.name,
    revision: current.revision,
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
      { error: 'Policyの変更にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
}

function parsePolicyMetadata(value: Record<string, unknown>) {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (name.length < 1 || name.length > 100)
    return { error: 'Policy名は1〜100文字で指定してください' };
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (description.length > 500) return { error: '説明は500文字以内で指定してください' };
  return { name, description: description || null };
}

async function parseJsonBody(
  request: Request,
): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_POLICY_BODY_BYTES);
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
            error instanceof RequestBodyTooLargeError ? 'Policyが大きすぎます' : 'JSONが不正です',
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
      targetType: 'studio_access_policy',
      targetId,
      changes,
      severity: 'warning',
      metadata: { operationSource: 'studio', securitySensitive: true },
    },
  });
}
