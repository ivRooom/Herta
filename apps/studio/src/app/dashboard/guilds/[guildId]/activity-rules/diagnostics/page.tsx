import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Activity, ArrowLeft } from 'lucide-react';
import { auth } from '@/auth';
import { ActivityRulesDiagnostics } from '@/components/activity-rules-diagnostics';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ActivityRulesDiagnosticsPage({
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

  const [activityRules, xpLevel, discordOptions] = await Promise.all([
    getGuildPlugin(guildId, 'activity-rules'),
    getGuildPlugin(guildId, 'xp-level'),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!activityRules || !xpLevel) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/activity-rules`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Activity Rulesへ戻る
      </Link>

      <section className="rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Activity className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Activity Rules Diagnostics
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              発言・XP判定シミュレーター
            </h1>
            <p className="mt-2 text-sm text-muted">
              {guild.name} の保存済み設定を使い、Messages集計とXP付与の静的ルールを安全に確認します。
            </p>
          </div>
        </div>
      </section>

      <ActivityRulesDiagnostics
        activityRulesEnabled={activityRules.enabled}
        activityRulesConfig={activityRules.config}
        xpEnabled={xpLevel.enabled}
        xpConfig={xpLevel.config}
        channels={discordOptions?.channels ?? []}
        roles={discordOptions?.roles ?? []}
      />
    </div>
  );
}
