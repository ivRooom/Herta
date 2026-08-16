import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CirclePause,
  History,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { getManageableGuilds } from '@/lib/guilds';
import { getPluginOperationsInventory, listRecentPluginOperations } from '@/lib/plugin-operations';
import type { PluginOperationItem, PluginOperationStatus } from '@/lib/plugin-operations-core';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

const JST_DATE_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export default async function PluginOperationsPage() {
  const accessToken = await getDiscordAccessToken();

  if (!accessToken) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ReconnectNotice />
      </div>
    );
  }

  const guildResult = await getManageableGuilds(accessToken)
    .then((guilds) => ({ ok: true as const, guilds }))
    .catch(() => ({ ok: false as const, guilds: [] }));

  if (!guildResult.ok) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ErrorPanel
          title="サーバー情報を取得できませんでした"
          detail="Discordとの接続状態を確認してから再読み込みしてください。Plugin設定の変更処理は行われていません。"
        />
      </div>
    );
  }

  const guildIds = guildResult.guilds.map((guild) => guild.id);
  const dataResult = await Promise.all([
    getPluginOperationsInventory(guildIds),
    listRecentPluginOperations(guildIds),
  ])
    .then(([inventory, recentOperations]) => ({
      ok: true as const,
      inventory,
      recentOperations,
    }))
    .catch((error) => {
      console.error('Plugin Operationsの読み込みに失敗しました', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return { ok: false as const };
    });

  if (!dataResult.ok) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ErrorPanel
          title="Plugin運用状態を取得できませんでした"
          detail="保存済みPlugin設定や監査ログの読み込みに失敗しました。設定変更は行われていません。"
        />
      </div>
    );
  }

  const { inventory, recentOperations } = dataResult;
  const guildNameById = new Map(guildResult.guilds.map((guild) => [guild.id, guild.name]));
  const attentionEntries = inventory.entries.filter((entry) => entry.status === 'attention');

  return (
    <div className="space-y-7">
      <PageHeader />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Plugin運用状態">
        <MetricCard
          icon={CheckCircle2}
          label="Healthy"
          value={inventory.healthyInstances}
          detail="有効かつ現在のSchemaに適合"
          tone="healthy"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Attention"
          value={inventory.attentionInstances}
          detail="有効だが設定Schemaに不整合"
          tone={inventory.attentionInstances > 0 ? 'attention' : 'default'}
        />
        <MetricCard
          icon={CirclePause}
          label="Paused"
          value={inventory.pausedInstances}
          detail="設定済みだが意図的に無効"
        />
        <MetricCard
          icon={Activity}
          label="Not configured"
          value={inventory.notConfiguredInstances}
          detail={`${inventory.totalSlots.toLocaleString()}枠中の未設定Plugin`}
        />
      </section>

      <section
        className={`rounded-2xl border p-5 shadow-card sm:p-6 ${
          attentionEntries.length > 0
            ? 'border-amber-400/30 bg-amber-400/5'
            : 'border-emerald-400/20 bg-emerald-400/5'
        }`}
        aria-labelledby="attention-heading"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                attentionEntries.length > 0
                  ? 'bg-amber-400/10 text-amber-300'
                  : 'bg-emerald-400/10 text-emerald-400'
              }`}
            >
              {attentionEntries.length > 0 ? (
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                Attention Queue
              </p>
              <h2 id="attention-heading" className="mt-1 text-lg font-semibold">
                {attentionEntries.length > 0
                  ? `${attentionEntries.length}件の設定を確認してください`
                  : '現在、要対応のPluginはありません'}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
                有効なPluginだけを現在のManifest JSON
                Schemaで再検証します。無効化中のPluginは障害扱いせずPausedとして分離しています。
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/plugins"
            className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            Plugin管理へ戻る <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {attentionEntries.length > 0 ? (
          <ul className="mt-5 grid gap-3 lg:grid-cols-2">
            {attentionEntries.map((entry) => (
              <AttentionCard
                key={`${entry.guildId}:${entry.pluginId}`}
                entry={entry}
                guildName={guildNameById.get(entry.guildId) ?? entry.guildId}
              />
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="inventory-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Configuration Inventory
            </p>
            <h2 id="inventory-heading" className="mt-2 text-xl font-semibold">
              設定済みPlugin
            </h2>
            <p className="mt-1 text-sm text-muted">
              設定本文は表示せず、状態・configVersion・更新日時だけを確認できます。
            </p>
          </div>
          <span className="text-xs text-muted">
            {inventory.configuredInstances.toLocaleString()} configured /{' '}
            {inventory.enabledInstances.toLocaleString()} enabled
          </span>
        </div>

        {inventory.entries.length > 0 ? (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-background/60 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    サーバー
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Plugin
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    状態
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    configVersion
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    最終更新
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inventory.entries.map((entry) => (
                  <tr key={`${entry.guildId}:${entry.pluginId}`} className="align-middle">
                    <td className="px-4 py-3">
                      <p className="max-w-48 truncate font-medium">
                        {guildNameById.get(entry.guildId) ?? entry.guildId}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{entry.pluginName}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{entry.pluginId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">v{entry.configVersion}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted">
                      {formatJst(entry.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/guilds/${entry.guildId}/plugins/${entry.pluginId}`}
                        className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> 設定
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel
            title="設定済みPluginはありません"
            detail="各サーバーのPlugin Managerから必要な公式Pluginを設定すると、ここに運用状態が表示されます。"
          />
        )}
      </section>

      <section aria-labelledby="recent-operations-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Recent Operations
            </p>
            <h2 id="recent-operations-heading" className="mt-2 text-xl font-semibold">
              最近のPlugin操作
            </h2>
            <p className="mt-1 text-sm text-muted">
              管理可能なサーバーに限定し、直近12件のPlugin監査イベントを表示します。
            </p>
          </div>
        </div>

        {recentOperations.length > 0 ? (
          <ul className="mt-5 grid gap-3 lg:grid-cols-2">
            {recentOperations.map((operation) => {
              const guildName = guildNameById.get(operation.guildId) ?? operation.guildId;
              return (
                <li
                  key={operation.id}
                  className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{operation.eventLabel}</p>
                      <p className="mt-1 text-sm text-muted">
                        {operation.pluginName} · {guildName}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        {formatJst(operation.createdAt)}
                        {operation.sourceLabel ? ` · ${operation.sourceLabel}` : ''}
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/guilds/${operation.guildId}/audit-logs?category=plugin`}
                      aria-label={`${guildName}のPlugin監査ログを開く`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <History className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyPanel
            title="Plugin操作履歴はまだありません"
            detail="Pluginの有効化・無効化・設定更新が行われると、ここに直近の操作が表示されます。"
          />
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">v1の判定範囲</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              この画面はDBに保存済みの設定と現在の公式Plugin
              Schemaを照合します。設定本文やSecretは表示しません。Redis通知後にBot/Workerへ実際に反映されたことを示すRuntime
              ACKはまだ永続化していないため、次フェーズで追加します。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function PageHeader() {
  return (
    <>
      <Link
        href="/dashboard/plugins"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> プラグイン管理へ戻る
      </Link>
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Plugin Operations
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            Plugin Operations Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            管理可能なDiscordサーバーの公式Pluginを横断し、設定の整合性・一時停止状態・最近の管理操作を安全に確認します。
          </p>
        </div>
      </section>
    </>
  );
}

function AttentionCard({ entry, guildName }: { entry: PluginOperationItem; guildName: string }) {
  return (
    <li className="rounded-xl border border-amber-400/20 bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{entry.pluginName}</p>
          <p className="mt-1 truncate text-xs text-muted">{guildName}</p>
        </div>
        <StatusBadge status="attention" />
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">
        有効な設定が現在のPlugin
        Schemaに適合していません。保存し直す前に設定内容を確認してください。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span>configVersion v{entry.configVersion}</span>
        <span>更新 {formatJst(entry.updatedAt)}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href={`/dashboard/guilds/${entry.guildId}/plugins/${entry.pluginId}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" /> 設定を確認
        </Link>
        <Link
          href={`/dashboard/guilds/${entry.guildId}/audit-logs?category=plugin`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-foreground"
        >
          <History className="h-4 w-4" aria-hidden="true" /> 監査ログ
        </Link>
      </div>
    </li>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail: string;
  tone?: 'default' | 'healthy' | 'attention';
}) {
  const iconClass =
    tone === 'attention'
      ? 'bg-amber-400/10 text-amber-300'
      : tone === 'healthy'
        ? 'bg-emerald-400/10 text-emerald-400'
        : 'bg-primary/10 text-primary';
  const valueClass =
    tone === 'attention' ? 'text-amber-300' : tone === 'healthy' ? 'text-emerald-400' : '';

  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconClass}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-4 text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value.toLocaleString()}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function StatusBadge({ status }: { status: PluginOperationStatus }) {
  const styles: Record<PluginOperationStatus, string> = {
    healthy: 'bg-emerald-400/10 text-emerald-400',
    attention: 'bg-amber-400/10 text-amber-300',
    paused: 'bg-border/60 text-muted',
  };
  const labels: Record<PluginOperationStatus, string> = {
    healthy: 'Healthy',
    attention: 'Attention',
    paused: 'Paused',
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5 sm:p-6">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{detail}</p>
    </section>
  );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
      <Activity className="mx-auto h-7 w-7 text-muted" aria-hidden="true" />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </div>
  );
}

function formatJst(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${JST_DATE_TIME.format(date)} JST`;
}