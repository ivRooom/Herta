import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { auth } from '@/auth';
import { AchievementOperationsDashboard } from '@/components/achievement-operations-dashboard';
import {
  getAchievementCatalog,
  getAchievementOperationsSnapshot,
} from '@/lib/achievement-operations';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AchievementOperationsPage({
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

  const plugin = await getGuildPlugin(guildId, 'achievements');
  if (!plugin) notFound();

  const [snapshot, catalog] = await Promise.all([
    getAchievementOperationsSnapshot(guildId, plugin.config),
    Promise.resolve(getAchievementCatalog(plugin.config)),
  ]);

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/achievements`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Achievement Builderへ戻る
      </Link>

      <div className="mt-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Achievement Operations</h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          {guild.name}{' '}
          の解除状況、Leaderboard、最近の解除履歴を確認し、メンバー単位でAchievementの手動付与・取消を管理します。
        </p>
      </div>

      <div className="mt-6">
        <AchievementOperationsDashboard
          guildId={guildId}
          initialSnapshot={snapshot}
          initialCatalog={catalog}
          pluginEnabled={plugin.enabled}
        />
      </div>
    </div>
  );
}
