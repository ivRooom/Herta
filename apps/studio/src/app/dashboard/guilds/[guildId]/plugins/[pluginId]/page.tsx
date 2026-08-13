import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { auth } from '@/auth';
import { ModerationConfigForm } from '@/components/moderation-config-form';
import { PluginConfigForm } from '@/components/plugin-config-form';
import { PluginSetupOverview } from '@/components/plugin-setup-overview';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ guildId: string; pluginId: string }>;
}) {
  const { guildId, pluginId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!accessToken || !session?.user) notFound();
  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const [plugin, discordOptions] = await Promise.all([
    getGuildPlugin(guildId, pluginId),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!plugin) notFound();

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Plugin 一覧へ戻る
      </Link>
      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight">{plugin.manifest.name}</h1>
        <p className="mt-2 text-sm text-muted">{plugin.manifest.description}</p>
        <p className="mt-1 text-xs text-muted">
          v{plugin.manifest.version} · {plugin.manifest.category}
        </p>
      </div>

      <div className="mt-8">
        <PluginSetupOverview
          manifest={plugin.manifest}
          enabled={plugin.enabled}
          config={plugin.config}
        />

        {pluginId === 'moderation' ? (
          <ModerationConfigForm
            guildId={guildId}
            initialEnabled={plugin.enabled}
            initialConfig={plugin.config}
            discordOptions={discordOptions}
          />
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
            <PluginConfigForm
              guildId={guildId}
              pluginId={pluginId}
              initialEnabled={plugin.enabled}
              initialConfig={plugin.config}
              schema={plugin.manifest.configSchema}
              discordOptions={discordOptions}
            />
          </div>
        )}
      </div>

      {pluginId === 'moderation' ? (
        <>
          <ManagementLink
            href={`/dashboard/guilds/${guildId}/moderation/enforcement`}
            title="自動対応ポリシー"
            description="検知ルールごとの危険度、警告、削除、Timeout、Role、ブラックリスト、Kick、BAN、緊急Alertを設定します。"
          />
          <ManagementLink
            href={`/dashboard/guilds/${guildId}/moderation/blacklist`}
            title="ブラックリスト管理"
            description="永久排除対象を確認し、ブラックリストの解除・再有効化を行います。"
          />
          <ManagementLink
            href={`/dashboard/guilds/${guildId}/moderation`}
            title="モデレーションケース管理"
            description="検知フラグ・警告・削除・タイムアウト・Role・ブラックリスト・Kick・BANの履歴を検索・確認・更新します。"
          />
          <ManagementLink
            href={`/dashboard/guilds/${guildId}/moderation/detections`}
            title="自動検知レビュー"
            description="本文を保存しない検知履歴を確認し、正検知・誤検知・無視へ分類します。"
          />
        </>
      ) : null}

      {pluginId === 'achievements' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/achievements`}
          title="Achievement Builder"
          description="Guild独自のSeries / Stage、解除条件、Badge Point、Secret、Role報酬、通知先をGUIで設計します。"
        />
      ) : null}

      {pluginId === 'quote' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/plugins/quote/quotes`}
          title="Quote管理"
          description="名言の検索・登録・編集・削除を行います。"
        />
      ) : null}

      {pluginId === 'auto-response' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/auto-response`}
          title="Auto Responseルール管理"
          description="トリガー、応答、Cooldown、対象範囲を管理します。"
        />
      ) : null}

      {pluginId === 'daily-content' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/daily-content`}
          title="Daily Content配信管理"
          description="定時コンテンツ、次回配信、配信履歴、失敗再実行を管理します。"
        />
      ) : null}

      {pluginId === 'lfg' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/lfg`}
          title="LFG募集管理"
          description="募集作成、参加状況、期限、Discordメッセージ、強制終了を管理します。"
        />
      ) : null}

      {pluginId === 'team-split' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/team-split`}
          title="Team Split管理"
          description="参加者、score、random・balanced分割、再抽選、Discordメッセージを管理します。"
        />
      ) : null}
    </div>
  );
}

function ManagementLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
    >
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <ArrowRight className="h-5 w-5 text-muted" />
    </Link>
  );
}
