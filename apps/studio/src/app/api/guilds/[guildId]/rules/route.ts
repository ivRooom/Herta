import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { parseStoredRuleStudioView, validateRuleStudioDraft } from '@/lib/rule-studio';
import { authorizeStudioPermission, resolveStudioAccess } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';

export const dynamic = 'force-dynamic';

const MAX_RULE_BODY_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.roles.read',
    `guild:${guildId}:rule:*`,
  );
  if (!authorization.ok) return authorization.response;

  const records = await prisma.rule.findMany({
    where: { guildId },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });
  const supported = records.map(parseStoredRuleStudioView).filter((rule) => rule !== null);
  return NextResponse.json({
    rules: supported,
    unsupportedCount: records.length - supported.length,
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

  const body = await parseBody(request);
  if ('response' in body) return body.response;
  const validation = validateRuleStudioDraft(body.value);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Rule設定が不正です', details: validation.errors },
      { status: 400 },
    );
  }
  const targetCheck = await validateDeleteTarget(guildId, validation.definition.actions[0]);
  if (targetCheck) return targetCheck;

  try {
    const definition = validation.definition;
    const rule = await prisma.rule.create({
      data: {
        guildId,
        pluginId: null,
        name: definition.name,
        description: definition.description,
        enabled: definition.enabled,
        priority: definition.priority,
        schemaVersion: definition.schemaVersion,
        trigger: definition.trigger,
        conditions: definition.conditions,
        actions: definition.actions,
        cooldownMs: definition.cooldownMs,
        maxExecutions: definition.maxExecutions,
        createdBy: session.user.id,
      },
    });
    await recordAudit(guildId, session.user.id, 'rule.created', rule.id, {
      name: rule.name,
      enabled: rule.enabled,
      triggerType: definition.trigger.type,
      actionType: definition.actions[0]?.type,
    });
    return NextResponse.json({ rule: parseStoredRuleStudioView(rule) }, { status: 201 });
  } catch (error) {
    console.error('Failed to create Rule Studio rule', {
      guildId,
      actorId: session.user.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Ruleを作成できませんでした' }, { status: 500 });
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

  const body = await parseBody(request);
  if ('response' in body) return body.response;
  const rawRuleId = typeof body.value.ruleId === 'string' ? body.value.ruleId : '';
  const expectedUpdatedAt =
    typeof body.value.expectedUpdatedAt === 'string' ? body.value.expectedUpdatedAt : '';
  if (!UUID_PATTERN.test(rawRuleId))
    return NextResponse.json({ error: 'Rule IDが不正です' }, { status: 400 });
  const expectedDate = new Date(expectedUpdatedAt);
  if (!expectedUpdatedAt || Number.isNaN(expectedDate.getTime())) {
    return NextResponse.json({ error: 'Rule更新時刻が不正です' }, { status: 400 });
  }
  const ruleId = rawRuleId.toLowerCase();
  const validation = validateRuleStudioDraft(body.value);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Rule設定が不正です', details: validation.errors },
      { status: 400 },
    );
  }
  const targetCheck = await validateDeleteTarget(guildId, validation.definition.actions[0]);
  if (targetCheck) return targetCheck;

  const current = await prisma.rule.findFirst({ where: { id: ruleId, guildId } });
  if (!current) return NextResponse.json({ error: 'Ruleが見つかりません' }, { status: 404 });
  if (!parseStoredRuleStudioView(current)) {
    return NextResponse.json(
      { error: 'このRuleはRule Studio v1の編集対象外です' },
      { status: 409 },
    );
  }

  const definition = validation.definition;
  const updated = await prisma.rule.updateMany({
    where: { id: ruleId, guildId, updatedAt: expectedDate },
    data: {
      name: definition.name,
      description: definition.description,
      enabled: definition.enabled,
      priority: definition.priority,
      schemaVersion: definition.schemaVersion,
      trigger: definition.trigger,
      conditions: definition.conditions,
      actions: definition.actions,
      cooldownMs: definition.cooldownMs,
      maxExecutions: definition.maxExecutions,
    },
  });
  if (updated.count !== 1) {
    return NextResponse.json(
      { error: 'Ruleは別の操作で更新されています。再読み込みしてから編集してください' },
      { status: 409 },
    );
  }
  const rule = await prisma.rule.findFirst({ where: { id: ruleId, guildId } });
  if (!rule) return NextResponse.json({ error: 'Ruleが見つかりません' }, { status: 404 });
  await recordAudit(guildId, session.user.id, 'rule.updated', ruleId, {
    name: rule.name,
    enabled: rule.enabled,
    triggerType: definition.trigger.type,
    actionType: definition.actions[0]?.type,
    executionCountPreserved: rule.executionCount,
  });
  return NextResponse.json({ rule: parseStoredRuleStudioView(rule) });
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

  const rawRuleId = new URL(request.url).searchParams.get('ruleId') ?? '';
  if (!UUID_PATTERN.test(rawRuleId))
    return NextResponse.json({ error: 'Rule IDが不正です' }, { status: 400 });
  const ruleId = rawRuleId.toLowerCase();
  const current = await prisma.rule.findFirst({ where: { id: ruleId, guildId } });
  if (!current) return NextResponse.json({ error: 'Ruleが見つかりません' }, { status: 404 });
  const deleted = await prisma.rule.deleteMany({ where: { id: ruleId, guildId } });
  if (deleted.count !== 1)
    return NextResponse.json({ error: 'Ruleが見つかりません' }, { status: 404 });
  await recordAudit(guildId, session.user.id, 'rule.deleted', ruleId, {
    name: current.name,
    executionCount: current.executionCount,
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
      { error: 'Ruleの変更にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
}

async function validateDeleteTarget(
  guildId: string,
  action: { type: string; config: Record<string, unknown> } | undefined,
): Promise<Response | null> {
  if (action?.type !== 'discord.role.delete') return null;
  const roleId = typeof action.config.roleId === 'string' ? action.config.roleId : '';
  const options = await getGuildConfigurationOptions(guildId);
  if (!options)
    return NextResponse.json({ error: 'Discord Role状態を確認できませんでした' }, { status: 503 });
  const role = options.roles.find((candidate) => candidate.id === roleId);
  if (!role)
    return NextResponse.json({ error: '削除対象RoleはこのGuildに存在しません' }, { status: 400 });
  if (role.id === STUDIO_ROOT_DISCORD_ROLE_ID) {
    return NextResponse.json({ error: 'OWNER root RoleはRuleから削除できません' }, { status: 400 });
  }
  if (role.managed || !role.editable) {
    return NextResponse.json(
      { error: 'Botから編集できないRoleは削除対象にできません' },
      { status: 400 },
    );
  }
  return null;
}

async function parseBody(
  request: Request,
): Promise<{ value: Record<string, unknown> } | { response: Response }> {
  try {
    const bytes = await readRequestBodyBytes(request, MAX_RULE_BODY_BYTES);
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
            error instanceof RequestBodyTooLargeError ? 'Rule設定が大きすぎます' : 'JSONが不正です',
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
  try {
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId,
        event,
        targetType: 'rule',
        targetId,
        changes,
        severity: 'warning',
        metadata: { operationSource: 'studio', securitySensitive: true },
      },
    });
  } catch (error) {
    console.error('Failed to record Rule Studio audit log', {
      guildId,
      actorId,
      event,
      targetId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}
