import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteBotGuildRole, BotGuildRoleLifecycleError } from '@/lib/bot-guild-role-lifecycle';
import { prisma } from '@/lib/db';
import { containsDiscordRoleReference } from '@/lib/discord-role-lifecycle';
import { resolveStudioAccess } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';
import { deleteStudioRolePolicy } from '@/lib/studio-role-policy-store';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

const ROLE_ID_PATTERN = /^\d{17,20}$/u;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string; roleId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  const { guildId, roleId } = await params;
  const root = await requireRoot(guildId, session.user.id);
  if (!root.ok) return root.response;
  if (
    !ROLE_ID_PATTERN.test(roleId) ||
    roleId === guildId ||
    roleId === STUDIO_ROOT_DISCORD_ROLE_ID
  ) {
    return NextResponse.json(
      { error: '削除対象Roleが不正または保護されています' },
      { status: 400 },
    );
  }

  const references = await findConfigurationReferences(guildId, roleId);
  if (references.length > 0) {
    return NextResponse.json(
      {
        error: 'このRoleはHerta設定から参照されています。先に参照を解除してください。',
        references,
      },
      { status: 409 },
    );
  }

  let result: { deleted: boolean; roleName: string | null };
  try {
    result = await deleteBotGuildRole(guildId, roleId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Discord Roleの削除に失敗しました' },
      { status: error instanceof BotGuildRoleLifecycleError ? error.status : 503 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.discordRoleLifecycleOperation.updateMany({
      where: { guildId, roleId, status: 'pending', operationType: 'delete' },
      data: { status: 'canceled', canceledAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: 'discord_role.deleted',
        targetType: 'discord_role',
        targetId: roleId,
        changes: { roleName: result.roleName, alreadyMissing: !result.deleted },
        severity: 'warning',
        metadata: { operationSource: 'studio', securitySensitive: true },
      },
    });
  });
  await deleteStudioRolePolicy(guildId, roleId);
  return NextResponse.json({ deleted: true, alreadyMissing: !result.deleted });
}

async function findConfigurationReferences(guildId: string, roleId: string): Promise<string[]> {
  const [settings, plugins] = await Promise.all([
    prisma.guildSettings.findUnique({
      where: { guildId },
      select: { modRoleIds: true, adminRoleIds: true, settingsJson: true },
    }),
    prisma.guildPlugin.findMany({
      where: { guildId },
      select: { pluginId: true, config: true },
    }),
  ]);
  const references: string[] = [];
  if (settings?.modRoleIds.includes(roleId)) references.push('GuildSettings.modRoleIds');
  if (settings?.adminRoleIds.includes(roleId)) references.push('GuildSettings.adminRoleIds');
  if (containsDiscordRoleReference(settings?.settingsJson, roleId))
    references.push('GuildSettings.settingsJson');
  for (const plugin of plugins) {
    if (containsDiscordRoleReference(plugin.config, roleId))
      references.push(`Plugin:${plugin.pluginId}`);
  }
  return references.slice(0, 20);
}

async function requireRoot(guildId: string, userId: string) {
  const resolved = await resolveStudioAccess(guildId, userId);
  if (!resolved.ok) return resolved;
  if (resolved.access.isRoot) return resolved;
  return {
    ok: false as const,
    response: NextResponse.json(
      { error: 'Discord Role管理にはOWNER root Roleが必要です' },
      { status: 403 },
    ),
  };
}
