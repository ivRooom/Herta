import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Sparkles, Trophy } from 'lucide-react';
import { auth } from '@/auth';
import { AchievementBuilderManager } from '@/components/achievement-builder-manager';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AchievementsBuilderPage({
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

  const [plugin, discordOptions] = await Promise.all([
    getGuildPlugin(guildId, 'achievements'),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!plugin) notFound();

  const customAchievements = Array.isArray(plugin.config.customAchievements)
    ? plugin.config.customAchievements
    : [];
  const stageCount = customAchievements.reduce((total, item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return total;
    const stages = (item as Record<string, unknown>).stages;
    return total + (Array.isArray(stages) ? stages.length : 0);
  }, 0);

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/achievements`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Achievements Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Achievement Builder</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            {guild.name} 専用の段階AchievementをGUIで設計します。条件、Badge
            Point、Secret、解除通知、Role報酬までここで管理できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted shadow-card">
            <Trophy className="h-3.5 w-3.5 text-primary" /> {customAchievements.length} Series
          </span>
          <span className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted shadow-card">
            {stageCount} Stages
          </span>
        </div>
      </div>

      {!plugin.enabled ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          Achievements
          Pluginは現在無効です。Builderは編集できますが、Discord上の自動解除・通知は実行されません。
        </div>
      ) : null}

      {!discordOptions ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          DiscordのChannel /
          Role候補を取得できませんでした。既存IDは保持されますが、Picker候補はBot接続が復旧するまで表示されません。
        </div>
      ) : null}

      <div className="mt-6">
        <AchievementBuilderManager
          guildId={guildId}
          initialConfig={plugin.config}
          discordOptions={discordOptions}
        />
      </div>
    </div>
  );
}
