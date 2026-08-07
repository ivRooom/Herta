import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import { ModerationEnforcementForm } from '@/components/moderation-enforcement-form';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

export default async function ModerationEnforcementPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const plugin = await getGuildPlugin(guildId, 'moderation');
  if (!plugin) notFound();

  return (
    <div className="min-w-0">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/moderation`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Moderation Pluginへ戻る
      </Link>

      <div className="mt-6">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">自動対応ポリシー</h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          {guild.name}{' '}
          の自動検知ごとに危険度・警告・削除・Timeout・ロール付与・ブラックリスト・Kick・BANを設定します。
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
          IP BANはDiscord Bot APIで接続元IPを取得できないため利用できません。ブラックリストはDiscord
          User IDを永久登録し、再参加時も自動BANします。
        </p>
      </div>

      <div className="mt-7">
        <ModerationEnforcementForm guildId={guildId} initialConfig={plugin.config} />
      </div>
    </div>
  );
}
