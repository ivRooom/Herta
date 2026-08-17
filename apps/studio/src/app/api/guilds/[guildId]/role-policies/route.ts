import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';
import { listStudioRolePolicies } from '@/lib/studio-role-policy-store';

export const dynamic = 'force-dynamic';

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
  if (!authorization.ok) return authorization.response;

  const options = await getGuildConfigurationOptions(guildId);
  if (!options) {
    return NextResponse.json({ error: 'Discordロール一覧を取得できませんでした' }, { status: 503 });
  }

  return NextResponse.json({
    rootRoleId: STUDIO_ROOT_DISCORD_ROLE_ID,
    canEdit: false,
    legacyReadOnly: true,
    roles: options.roles.map((role) => ({ id: role.id, name: role.name, color: role.color })),
    policies: await listStudioRolePolicies(guildId),
  });
}
