import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  ExternalLink,
  Gift,
  History,
  MessageSquareText,
  Plug,
  ShieldCheck,
  Trophy,
  Vote,
} from 'lucide-react';
import { auth } from '@/auth';
import { GuildAvatar } from '@/components/guild-avatar';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { getCommunityDashboardSnapshot } from '@/lib/community-dashboard';
import { getDiscordGuildInstallUrl } from '@/lib/discord-install';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function GuildDetailPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();

  if (!accessToken) {
    return (
      <div>
        <BackLink />
        <div className="mt-6">
          <ReconnectNotice />
        </div>
      </div>
    );
  }

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild || !session?.user) notFound();

  await persistSelectedGuild(guild, session.user.id);
  const [snapshot, installUrl] = await Promise.all([
    getCommunityDashboardSnapshot(guild.id),
    Promise.resolve(getDiscordGuildInstallUrl(guild.id)),
  ]);
  const attentionCount = snapshot.openSuggestions + snapshot.failedReminders + snapshot.failedCommands7d;

  return (
    <div className="space-y-6">
      <BackLink />

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-4">
            <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={64} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Community Dashboard
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{guild.name}</h1>
              <p className="mt-1 text-sm text-muted">サーバー ID: {guild.id}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/dashboard/guilds/${guildId}/plugins`}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <Plug className="h-4 w-4" /> Pluginを設定
            </Link>
            <Link
              href={`/dashboard/guilds/${guildId}/audit-logs`}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/70 px-4 py-2.5 text-sm font-semibold"
            >
              <History className="h-4 w-4" /> 監査ログ
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Plug}
          label="有効Plugin"
          value={`${snapshot.enabledPlugins} / ${snapshot.totalPlugins}`}
          detail="公式Pluginの有効化状況"
        />
        <MetricCard
          icon={Trophy}
          label="XP参加者"
          value={snapshot.xpProfiles.toLocaleString()}
          detail="XPプロフィールを持つメンバー"
        />
        <MetricCard
          icon={Activity}
          label="7日間のコマンド"
          value={snapshot.commands7d.toLocaleString()}
          detail={`成功率 ${snapshot.commandSuccessRate7d}%`}
        />
        <MetricCard
          icon={attentionCount > 0 ? AlertTriangle : CheckCircle2}
          label="要確認"
          value={attentionCount.toLocaleString()}
          detail={attentionCount > 0 ? '未処理・失敗項目があります' : '大きな要対応項目はありません'}
          attention={attentionCount > 0}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                Community Now
              </p>
              <h2 className="mt-2 text-lg font-semibold">現在のコミュニティ状況</h2>
            </div>
            <span className="text-xs text-muted">既存DBからリアルタイム集計</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SmallMetric icon={Vote} label="開催中Poll" value={snapshot.openPolls} />
            <SmallMetric icon={Gift} label="開催中Giveaway" value={snapshot.openGiveaways} />
            <SmallMetric
              icon={MessageSquareText}
              label="未処理Suggestion"
              value={snapshot.openSuggestions}
              attention={snapshot.openSuggestions > 0}
            />
            <SmallMetric icon={Bell} label="待機中Reminder" value={snapshot.pendingReminders} />
            <SmallMetric icon={Activity} label="AFK中" value={snapshot.afkUsers} />
            <SmallMetric
              icon={AlertTriangle}
              label="失敗Reminder"
              value={snapshot.failedReminders}
              attention={snapshot.failedReminders > 0}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Next Action</p>
          <h2 className="mt-2 text-lg font-semibold">運用チェック</h2>
          <div className="mt-5 space-y-3">
            <CheckRow
              label="Plugin設定"
              detail={`${snapshot.enabledPlugins}個を有効化中`}
              ok={snapshot.enabledPlugins > 0}
            />
            <CheckRow
              label="コマンド成功率"
              detail={`直近7日 ${snapshot.commandSuccessRate7d}%`}
              ok={snapshot.commandSuccessRate7d >= 95}
            />
            <CheckRow
              label="Reminder配信"
              detail={snapshot.failedReminders > 0 ? `${snapshot.failedReminders}件の失敗` : '失敗なし'}
              ok={snapshot.failedReminders === 0}
            />
            <CheckRow
              label="Suggestion対応"
              detail={snapshot.openSuggestions > 0 ? `${snapshot.openSuggestions}件が未処理` : '未処理なし'}
              ok={snapshot.openSuggestions === 0}
            />
          </div>
          <Link
            href={`/dashboard/guilds/${guildId}/plugins`}
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            Plugin Managerを開く <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-medium">あなたの権限</h2>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            <PermissionRow label="オーナー" active={guild.owner} />
            <PermissionRow label="管理者 (Administrator)" active={guild.hasAdministrator} />
            <PermissionRow label="サーバー管理 (Manage Guild)" active={guild.hasManageGuild} />
          </ul>
        </div>

        <div className="rounded-2xl border border-[#5865F2]/30 bg-[#5865F2]/10 p-6">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865F2] text-white">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-medium">Herta Botの導入・権限更新</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Guild単位のCommand同期とPlugin Runtimeに必要なDiscord権限を更新できます。
              </p>
              {installUrl ? (
                <a
                  href={installUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Botを追加 / 権限を更新 <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <p className="mt-4 text-sm text-muted">Discord Application ID が未設定です</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/guilds"
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> サーバー一覧へ戻る
    </Link>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  attention = false,
}: {
  icon: typeof Plug;
  label: string;
  value: string;
  detail: string;
  attention?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl ${attention ? 'bg-amber-400/10 text-amber-300' : 'bg-primary/10 text-primary'}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-4 text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function SmallMetric({
  icon: Icon,
  label,
  value,
  attention = false,
}: {
  icon: typeof Vote;
  label: string;
  value: number;
  attention?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <Icon className={`h-4 w-4 ${attention ? 'text-amber-300' : 'text-primary'}`} />
        <span className={`text-xl font-semibold ${attention ? 'text-amber-200' : ''}`}>
          {value.toLocaleString()}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">{label}</p>
    </div>
  );
}

function CheckRow({ label, detail, ok }: { label: string; detail: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background/60 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{detail}</p>
      </div>
      <span className={`text-xs font-semibold ${ok ? 'text-emerald-400' : 'text-amber-300'}`}>
        {ok ? 'OK' : '確認'}
      </span>
    </div>
  );
}

function PermissionRow({ label, active }: { label: string; active: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span
        className={
          active
            ? 'rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
            : 'rounded-md bg-border/50 px-2 py-0.5 text-xs font-medium text-muted'
        }
      >
        {active ? 'あり' : 'なし'}
      </span>
    </li>
  );
}
