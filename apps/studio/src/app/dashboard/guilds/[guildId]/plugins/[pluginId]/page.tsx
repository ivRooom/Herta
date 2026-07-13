import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
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
    </div>
  );
}
