import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/auth';
import { VcRecapConsentAdmin } from '@/components/vc-recap-consent-admin';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';
import { studioVoiceConsentResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

export default async function VcRecapConsentAdminPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();

  if (!accessToken || !session?.user) {
    return (
      <div>
        <BackLink guildId={guildId} />
        <div className="mt-6">
          <ReconnectNotice />
        </div>
      </div>
    );
  }

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) notFound();
  const canRead = hasEffectivePluginPermission(
    access.access,
    'studio.settings.read',
    studioVoiceConsentResource(guildId),
  );
  if (!canRead) {
    return (
      <div>
        <BackLink guildId={guildId} />
        <p className="mt-6 text-sm text-red-600">この操作を行う権限がありません。</p>
      </div>
    );
  }
  const canEdit = hasEffectivePluginPermission(
    access.access,
    'studio.settings.write',
    studioVoiceConsentResource(guildId),
  );

  return (
    <div>
      <BackLink guildId={guildId} />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">VC同意の管理</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        メンバーを検索し、VC発言の文字起こしへの同意状態を確認・変更できます。この同意はguildに
        依存しないグローバル設定のため、ここでの変更はHertaが参加している全Guildに反映されます。
      </p>
      <div className="mt-6">
        <VcRecapConsentAdmin guildId={guildId} canEdit={canEdit} />
      </div>
    </div>
  );
}

function BackLink({ guildId }: { guildId: string }) {
  return (
    <Link
      href={`/dashboard/guilds/${guildId}/vc-recap`}
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      VC Recapへ戻る
    </Link>
  );
}
