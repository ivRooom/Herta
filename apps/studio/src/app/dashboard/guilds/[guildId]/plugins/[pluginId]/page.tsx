import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { auth } from '@/auth';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { PluginConfigForm } from '@/components/plugin-config-form';

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
  const plugin = await getGuildPlugin(guildId, pluginId);
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
      <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-card">
        <PluginConfigForm
          guildId={guildId}
          pluginId={pluginId}
          initialEnabled={plugin.enabled}
          initialConfig={plugin.config}
          schema={plugin.manifest.configSchema}
        />
      </div>

      {pluginId === 'moderation' ? (
        <Link
          href={`/dashboard/guilds/${guildId}/moderation`}
          className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
        >
          <div>
            <h2 className="font-medium">モデレーションケース管理</h2>
            <p className="mt-1 text-sm text-muted">
              警告・タイムアウト・Kick・BANの履歴を検索・確認・更新します。
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted" />
        </Link>
      ) : null}

      {pluginId === 'quote' ? (
        <Link
          href={`/dashboard/guilds/${guildId}/plugins/quote/quotes`}
          className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
        >
          <div>
            <h2 className="font-medium">Quote管理</h2>
            <p className="mt-1 text-sm text-muted">名言の検索・登録・編集・削除を行います。</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted" />
        </Link>
      ) : null}

      {pluginId === 'auto-response' ? (
        <Link
          href={`/dashboard/guilds/${guildId}/auto-response`}
          className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
        >
          <div>
            <h2 className="font-medium">Auto Responseルール管理</h2>
            <p className="mt-1 text-sm text-muted">
              トリガー、応答、Cooldown、対象範囲を管理します。
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted" />
        </Link>
      ) : null}
    </div>
  );
}
