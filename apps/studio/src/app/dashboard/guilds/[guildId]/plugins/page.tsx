import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Gamepad2,
  MessageCircleReply,
  Puzzle,
  Quote,
  Settings,
  ShieldCheck,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { auth } from '@/auth';
import { PluginToggle } from '@/components/plugin-toggle';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { listGuildPlugins } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PLUGIN_ICONS: Record<string, LucideIcon> = {
  moderation: ShieldCheck,
  'auto-response': MessageCircleReply,
  'daily-content': CalendarDays,
  lfg: UsersRound,
  quote: Quote,
  'team-split': Gamepad2,
};

export default async function PluginsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!accessToken || !session?.user) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const plugins = await listGuildPlugins(guildId);
  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;

  return (
    <div className="space-y-7">
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {guild.name} に戻る
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Guild Feature Center
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
              Plugin Manager
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {guild.name} に必要な機能だけを有効化し、各Pluginの設定・運用画面へ移動できます。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-72">
            <SummaryMetric label="Installed" value={`${plugins.length}`} />
            <SummaryMetric label="Enabled" value={`${enabledCount}`} accent />
          </div>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Official Plugins
            </p>
            <h2 className="mt-2 text-xl font-semibold">利用できる機能</h2>
          </div>
          <Link
            href="/dashboard/custom-plugins"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <Puzzle className="h-4 w-4" /> Custom Plugin Hub
          </Link>
        </div>

        <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plugins.map(({ manifest, enabled, config }) => {
            const Icon = PLUGIN_ICONS[manifest.id] ?? Puzzle;
            return (
              <li
                key={manifest.id}
                className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
              >
                <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full bg-primary/0 blur-2xl transition-colors group-hover:bg-primary/10" />
                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/guilds/${guildId}/plugins/${manifest.id}`}
                        className="font-semibold hover:text-primary"
                      >
                        {manifest.name}
                      </Link>
                      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                        {manifest.category} · v{manifest.version}
                      </p>
                    </div>
                  </div>
                  <PluginToggle
                    guildId={guildId}
                    pluginId={manifest.id}
                    initialEnabled={enabled}
                    initialConfig={config}
                  />
                </div>

                <p className="mt-4 min-h-12 text-sm leading-6 text-muted">{manifest.description}</p>

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-background text-muted'
                    }`}
                  >
                    {enabled ? 'Active' : 'Disabled'}
                  </span>
                  <Link
                    href={`/dashboard/guilds/${guildId}/plugins/${manifest.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
                  >
                    <Settings className="h-3.5 w-3.5" /> 設定
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Puzzle className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">Hertaを自分たちのPluginで拡張</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                署名付きPackage、権限宣言、Guild単位インストール、ロールバックを備えたCustom
                Plugin基盤を次Phaseで実装します。
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/custom-plugins"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-background px-4 py-2.5 text-sm font-semibold text-primary"
          >
            ロードマップを見る <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/70 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-primary' : ''}`}>{value}</p>
    </div>
  );
}
