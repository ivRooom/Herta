import { createHash } from 'node:crypto';
import {
  countPendingDiscordRoleCreates,
  DiscordRoleOperationIdempotencyConflictError,
  enqueueDiscordRoleCreateOperation,
  enqueueDiscordRoleDeleteOperation,
  findHertaDiscordRoleReferences,
} from '@herta/db';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readJsonBodyWithLimit } from '@/lib/bounded-request-body';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import {
  isDiscordRoleId,
  isRoleOperationId,
  parseDiscordRoleCreateRequest,
  roleDeleteBlockReason,
  serializeDiscordRoleCreateIdempotencyPayload,
} from '@/lib/discord-role-lifecycle';
import { prisma } from '@/lib/db';
import { resolveStudioAccess } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_ROLE_BODY_BYTES = 8 * 1024;
const MAX_PENDING_CREATE_OPERATIONS_PER_GUILD = 100;

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  const { guildId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if (!root.ok) return root.response;

  const operationId = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!isRoleOperationId(operationId)) {
    return NextResponse.json(
      { error: 'Role作成には有効なIdempotency-Keyが必要です' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await readJsonBodyWithLimit(request, MAX_ROLE_BODY_BYTES);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? 'Role作成リクエストが大きすぎます'
            : 'JSONが不正です',
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const now = new Date();
  const input = parseDiscordRoleCreateRequest(body, now);
  if (!input) {
    return NextResponse.json(
      { error: 'Role名・色・予約日時・有効期限の指定が不正です' },
      { status: 400 },
    );
  }

  const idempotencyPayload = serializeDiscordRoleCreateIdempotencyPayload(body, input);
  if (!idempotencyPayload) {
    return NextResponse.json({ error: 'Role作成リクエストが不正です' }, { status: 400 });
  }
  const idempotencyFingerprint = createHash('sha256').update(idempotencyPayload).digest('hex');

  const options = await getGuildConfigurationOptions(guildId);
  if (!options) {
    return NextResponse.json(
      { error: 'Discord Guildの状態を確認できませんでした' },
      { status: 503 },
    );
  }
  if (!options.bot.manageRoles) {
    return NextResponse.json(
      { error: 'Herta Botに「ロールの管理」権限がありません' },
      { status: 409 },
    );
  }

  const pendingCreates = await countPendingDiscordRoleCreates(prisma, guildId);
  if (pendingCreates >= MAX_PENDING_CREATE_OPERATIONS_PER_GUILD) {
    return NextResponse.json(
      { error: '未完了のRole作成予約が上限に達しています' },
      { status: 429 },
    );
  }

  let operation;
  try {
    operation = await enqueueDiscordRoleCreateOperation(prisma, {
      guildId,
      roleName: input.name,
      roleColor: input.color,
      scheduledFor: input.scheduledFor,
      expiresAfterSeconds: input.expiresAfterSeconds,
      createdBy: session.user.id,
      source: 'studio',
      operationId,
      idempotencyFingerprint,
    });
  } catch (error) {
    if (error instanceof DiscordRoleOperationIdempotencyConflictError) {
      return NextResponse.json(
        { error: 'Idempotency-Keyが別のRole作成要求ですでに使用されています' },
        { status: 409 },
      );
    }
    throw error;
  }

  await recordAudit(guildId, session.user.id, 'discord_role.create_requested', operation.id, {
    roleName: operation.roleName,
    roleColor: operation.roleColor,
    scheduledFor: operation.scheduledFor.toISOString(),
    expiresAfterSeconds: operation.expiresAfterSeconds,
  });

  return NextResponse.json({ operation: serializeOperation(operation) }, { status: 202 });
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

  const roleId = new URL(request.url).searchParams.get('roleId') ?? '';
  if (!isDiscordRoleId(roleId) || roleId === guildId || roleId === STUDIO_ROOT_DISCORD_ROLE_ID) {
    return NextResponse.json({ error: '削除対象Roleが不正です' }, { status: 400 });
  }

  const options = await getGuildConfigurationOptions(guildId);
  if (!options) {
    return NextResponse.json(
      { error: 'Discord Guildの状態を確認できませんでした' },
      { status: 503 },
    );
  }
  if (!options.bot.manageRoles) {
    return NextResponse.json(
      { error: 'Herta Botに「ロールの管理」権限がありません' },
      { status: 409 },
    );
  }

  const role = options.roles.find((candidate) => candidate.id === roleId);
  if (!role) return NextResponse.json({ error: 'Discord Roleが見つかりません' }, { status: 404 });

  const blockReason = roleDeleteBlockReason(role, STUDIO_ROOT_DISCORD_ROLE_ID);
  if (blockReason) {
    const error =
      blockReason === 'managed'
        ? 'Discord Managed Roleは削除できません'
        : blockReason === 'hierarchy'
          ? 'Botより上位または同順位のRoleは削除できません'
          : 'OWNER root Roleは削除できません';
    return NextResponse.json({ error }, { status: 409 });
  }

  const references = await findHertaDiscordRoleReferences(prisma, guildId, role.id);
  if (references.length > 0) {
    return NextResponse.json(
      {
        error: 'このRoleはHerta設定から参照されています。先に参照を解除してください。',
        references,
      },
      { status: 409 },
    );
  }

  const operation = await enqueueDiscordRoleDeleteOperation(prisma, {
    guildId,
    discordRoleId: role.id,
    roleName: role.name,
    scheduledFor: new Date(),
    createdBy: session.user.id,
    source: 'studio',
  });

  await recordAudit(guildId, session.user.id, 'discord_role.delete_requested', role.id, {
    roleName: role.name,
    roleOperationId: operation.id,
  });

  return NextResponse.json({ operation: serializeOperation(operation) }, { status: 202 });
}

async function requireRoot(guildId: string, userId: string) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (resolved.access.isRoot) return resolved;
  return {
    ok: false as const,
    response: NextResponse.json(
      { error: 'Discord Roleの作成・削除にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
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

function serializeOperation(operation: {
  id: string;
  operation: string;
  status: string;
  discordRoleId: string | null;
  roleName: string | null;
  roleColor: number | null;
  scheduledFor: Date;
  expiresAfterSeconds: number | null;
  nextAttemptAt: Date | null;
  attemptCount: number;
  lastErrorName: string | null;
  createdAt: Date;
}) {
  return {
    ...operation,
    scheduledFor: operation.scheduledFor.toISOString(),
    nextAttemptAt: operation.nextAttemptAt?.toISOString() ?? null,
    createdAt: operation.createdAt.toISOString(),
  };
}
