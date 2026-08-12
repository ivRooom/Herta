import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, LibraryBig, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { AchievementTemplateGallery } from '@/components/achievement-template-gallery';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AchievementTemplatesPage({
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

  const currentSeries = Array.isArray(plugin.config.customAchievements)
    ? plugin.config.customAchievements.length
    : 0;

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/achievements`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Achievement Builderへ戻る
      </Link>

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LibraryBig className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Achievement Template Gallery</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            {guild.name} に用途別Achievement Packを追加します。Community、VC、Minecraft、Event、Season向けの実績をゼロから作らず導入できます。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted shadow-card">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Built-in Packs
          </span>
          <span className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted shadow-card">
            {currentSeries}/25 Series
          </span>
        </div>
      </div>

      {!plugin.enabled ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          Achievements Pluginは現在無効です。Templateは追加できますが、Pluginを有効化するまでDiscord上の自動解除は実行されません。
        </div>
      ) : null}

      <div className="mt-6">
        <AchievementTemplateGallery guildId={guildId} initialConfig={plugin.config} />
      </div>
    </div>
  );
}
