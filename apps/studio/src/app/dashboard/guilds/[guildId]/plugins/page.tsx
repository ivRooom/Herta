import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Settings } from 'lucide-react';
import { auth } from '@/auth';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { listGuildPlugins } from '@/lib/guild-plugins';
import { PluginToggle } from '@/components/plugin-toggle';

export const dynamic = 'force-dynamic';

export default async function PluginsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!accessToken || !session?.user) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const plugins = await listGuildPlugins(guildId);
  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {guild.name} に戻る
      </Link>
      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight">Plugin Manager</h1>
        <p className="mt-2 text-sm text-muted">
          Guild ごとの Plugin を有効化し、設定を管理します。
        </p>
      </div>
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {plugins.map(({ manifest, enabled, config }) => (
          <li
            key={manifest.id}
            className="rounded-2xl border border-border bg-surface p-5 shadow-card"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Link
                  href={`/dashboard/guilds/${guildId}/plugins/${manifest.id}`}
                  className="font-medium hover:text-primary"
                >
                  {manifest.name}
                </Link>
                <p className="mt-1 text-sm leading-relaxed text-muted">{manifest.description}</p>
              </div>
              <PluginToggle
                guildId={guildId}
                pluginId={manifest.id}
                initialEnabled={enabled}
                initialConfig={config}
              />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted">
              <span>
                {manifest.category} · v{manifest.version}
              </span>
              <Link
                href={`/dashboard/guilds/${guildId}/plugins/${manifest.id}`}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Settings className="h-3.5 w-3.5" /> 設定
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
