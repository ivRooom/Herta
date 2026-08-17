import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { createBotGuildRole, deleteBotGuildRole, BotGuildRoleLifecycleError } from '@/lib/bot-guild-role-lifecycle';
import { prisma } from '@/lib/db';
import { validateDiscordRoleLifecycleCreate } from '@/lib/discord-role-lifecycle';
import { resolveStudioAccess } from '@/lib/studio-access';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 16 * 1024;
const OPERATION_LIST_LIMIT = 30;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if (!root.ok) return root.response;
  const operations = await prisma.discordRoleLifecycleOperation.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take: OPERATION_LIST_LIMIT,
  });
  return NextResponse.json({ operations });
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

  const body = await parseBody(request);
  if ('response' in body) return body.response;
  const validation = validateDiscordRoleLifecycleCreate(body.value);
  if (!validation.valid || !validation.input) {
    return NextResponse.json({ error: 'Role作成設定が不正です', details: validation.errors }, { status: 400 });
  }
  const input = validation.input;
  const executeAt = input.createAt ?? new Date();
  const operation = await prisma.discordRoleLifecycleOperation.upsert({
    where: { guildId_idempotencyKey: { guildId, idempotencyKey: input.requestId } },
    create: {
      guildId,
      operationType: 'create',
      status: 'pending',
      executeAt,
      roleName: input.name,
      roleColor: input.color,
      hoist: input.hoist,
      mentionable: input.mentionable,
      expiresAt: input.expiresAt,
      createdBy: session.user.id,
      idempotencyKey: input.requestId,
    },
    update: {},
  });

  if (input.createAt) {
    await recordAudit(guildId, session.user.id, 'discord_role.creation_scheduled', operation.id, {
      roleName: input.name,
      executeAt: input.createAt.toISOString(),
      expiresAt: input.expiresAt?.toISOString() ?? null,
    });
    return NextResponse.json({ operation }, { status: 202 });
  }

  const claim = await prisma.discordRoleLifecycleOperation.updateMany({
    where: { id: operation.id, guildId, status: 'pending' },
    data: { status: 'running', startedAt: new Date(), lastError: null },
  });
  if (claim.count === 0) {
    const existing = await prisma.discordRoleLifecycleOperation.findUnique({ where: { id: operation.id } });
    return NextResponse.json({ operation: existing }, { status: 200 });
  }

  let createdRole: Awaited<ReturnType<typeof createBotGuildRole>>;
  try {
    createdRole = await createBotGuildRole(guildId, {
      name: input.name,
      color: input.color,
      hoist: input.hoist,
      mentionable: input.mentionable,
    });
  } catch (error) {
    const status = error instanceof BotGuildRoleLifecycleError && error.code === 'transport_unknown' ? 'attention' : 'failed';
    await prisma.discordRoleLifecycleOperation.update({
      where: { id: operation.id },
      data: { status, lastError: safeErrorCode(error) },
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Role作成に失敗しました',
        attention: status === 'attention',
      },
      { status: error instanceof BotGuildRoleLifecycleError ? error.status : 503 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.discordRoleLifecycleOperation.update({
        where: { id: operation.id },
        data: { status: 'completed', roleId: createdRole.id, completedAt: new Date(), lastError: null },
      });
      if (input.expiresAt) {
        await tx.discordRoleLifecycleOperation.create({
          data: {
            guildId,
            operationType: 'delete',
            status: 'pending',
            executeAt: input.expiresAt,
            roleId: createdRole.id,
            roleName: createdRole.name,
            createdBy: session.user.id,
            idempotencyKey: `expire:${input.requestId}`,
            sourceOperationId: operation.id,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          guildId,
          actorId: session.user.id,
          event: 'discord_role.created',
          targetType: 'discord_role',
          targetId: createdRole.id,
          changes: {
            roleName: createdRole.name,
            color: input.colorHex,
            hoist: input.hoist,
            mentionable: input.mentionable,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
          severity: 'warning',
          metadata: { operationSource: 'studio', securitySensitive: true, lifecycleOperationId: operation.id },
        },
      });
    });
  } catch (error) {
    await compensateCreatedRole(guildId, createdRole.id);
    await prisma.discordRoleLifecycleOperation.update({
      where: { id: operation.id },
      data: { status: 'failed', lastError: 'RolePersistenceFailed' },
    }).catch(() => undefined);
    return NextResponse.json({ error: 'Role作成後の永続化に失敗したため作成を取り消しました' }, { status: 503 });
  }

  const completed = await prisma.discordRoleLifecycleOperation.findUnique({ where: { id: operation.id } });
  return NextResponse.json({ role: createdRole, operation: completed }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  const { guildId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if (!root.ok) return root.response;
  const operationId = new URL(request.url).searchParams.get('operationId') ?? '';
  if (!operationId) return NextResponse.json({ error: 'operationIdが必要です' }, { status: 400 });
  const result = await prisma.discordRoleLifecycleOperation.updateMany({
    where: { id: operationId, guildId, status: 'pending' },
    data: { status: 'canceled', canceledAt: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: '待機中のOperationが見つかりません' }, { status: 409 });
  }
  await recordAudit(guildId, session.user.id, 'discord_role.lifecycle_canceled', operationId, {});
  return NextResponse.json({ canceled: true });
}

async function compensateCreatedRole(guildId: string, roleId: string): Promise<void> {
  try {
    await deleteBotGuildRole(guildId, roleId);
  } catch {
    // Operationをfailedとして残し、Role Managerの「要確認」対象として追跡できる。
  }
}

async function requireRoot(guildId: string, userId: string) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (resolved.access.isRoot) return resolved;
  return {
    ok: false as const,
    response: NextResponse.json({ error: 'Discord Role管理にはOWNER root Roleが必要です' }, { status: 403 }),
  };
}

async function parseBody(request: Request): Promise<{ value: unknown } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_BODY_BYTES);
    return { value: JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown };
  } catch (error) {
    return {
      response: NextResponse.json(
        { error: error instanceof RequestBodyTooLargeError ? 'リクエストが大きすぎます' : 'JSONが不正です' },
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
      targetType: 'discord_role_lifecycle_operation',
      targetId,
      changes,
      severity: 'warning',
      metadata: { operationSource: 'studio', securitySensitive: true },
    },
  });
}

function safeErrorCode(error: unknown): string {
  if (error instanceof BotGuildRoleLifecycleError) return error.code.slice(0, 160);
  return error instanceof Error && error.name.trim() ? error.name.slice(0, 160) : 'UnknownError';
}
