import Link from 'next/link';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, CirclePause, History, Settings2 } from 'lucide-react';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { getManageableGuilds } from '@/lib/guilds';
import { getPluginOperationsInventory, listRecentPluginOperations } from '@/lib/plugin-operations';
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
        <MessagePanel title="サーバー情報を取得できませんでした" detail="Discordとの接続状態を確認してから再読み込みしてください。" />
      </div>
    );
  }

  const guildIds = guildResult.guilds.map((guild) => guild.id);
  const dataResult = await Promise.all([
    getPluginOperationsInventory(guildIds),
    listRecentPluginOperations(guildIds),
  ])
    .then(([inventory, recentOperations]) => ({ ok: true as const, inventory, recentOperations }))
    .catch((error) => {
      console.error('Plugin Operationsの読み込みに失敗しました', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      return { ok: false as const };
    });

  if (!dataResult.ok) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <MessagePanel title="Plugin運用状態を取得できませんでした" detail="保存済みPlugin設定または監査ログの読み込みに失敗しました。設定変更は行われていません。" />
      </div>
    );
  }

  const { inventory, recentOperations } = dataResult;
  const guildNameById = new Map(guildResult.guilds.map((guild) => [guild.id, guild.name]));

  return (
    <div className="space-y-7">
      <PageHeader />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Plugin運用状態">
        <Metric label="Healthy" value={inventory.healthyInstances} detail="有効かつ現在のSchemaに適合" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} />
        <Metric label="Attention" value={inventory.attentionInstances} detail="有効だが設定Schemaに不整合" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />} />
        <Metric label="Paused" value={inventory.pausedInstances} detail="設定済みだが無効" icon={<CirclePause className="h-4 w-4" aria-hidden="true" />} />
        <Metric label="Not configured" value={inventory.notConfiguredInstances} detail={`${inventory.totalSlots.toLocaleString()}枠中の未設定Plugin`} icon={<Activity className="h-4 w-4" aria-hidden="true" />} />
      </section>

      <section aria-labelledby="plugin-inventory-heading">
        <h2 id="plugin-inventory-heading" className="text-xl font-semibold">設定済みPlugin</h2>
        <p className="mt-1 text-sm text-muted">設定本文やSecretは表示せず、状態・configVersion・更新日時だけを表示します。</p>
        {inventory.entries.length === 0 ? (
          <MessagePanel title="設定済みPluginはありません" detail="各サーバーのPlugin Managerから設定すると、ここに運用状態が表示されます。" />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-background/60 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">サーバー</th>
                  <th scope="col" className="px-4 py-3">Plugin</th>
                  <th scope="col" className="px-4 py-3">状態</th>
                  <th scope="col" className="px-4 py-3">configVersion</th>
                  <th scope="col" className="px-4 py-3">最終更新</th>
                  <th scope="col" className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inventory.entries.map((entry) => (
                  <tr key={`${entry.guildId}:${entry.pluginId}`}>
                    <td className="px-4 py-3">{guildNameById.get(entry.guildId) ?? entry.guildId}</td>
                    <td className="px-4 py-3"><span className="font-medium">{entry.pluginName}</span><span className="ml-2 text-xs text-muted">{entry.pluginId}</span></td>
                    <td className="px-4 py-3"><StatusBadge status={entry.status} /></td>
                    <td className="px-4 py-3">v{entry.configVersion}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatJst(entry.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/guilds/${entry.guildId}/plugins/${entry.pluginId}`} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> 設定
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="recent-plugin-operations-heading">
        <h2 id="recent-plugin-operations-heading" className="text-xl font-semibold">最近のPlugin操作</h2>
        <p className="mt-1 text-sm text-muted">管理可能なサーバーに限定して直近12件を表示します。</p>
        {recentOperations.length === 0 ? (
          <MessagePanel title="Plugin操作履歴はまだありません" detail="有効化・無効化・設定更新が行われると表示されます。" />
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {recentOperations.map((operation) => (
              <li key={operation.id} className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{operation.eventLabel}</p>
                    <p className="mt-1 text-sm text-muted">{operation.pluginName} · {guildNameById.get(operation.guildId) ?? operation.guildId}</p>
                    <p className="mt-2 text-xs text-muted">{formatJst(operation.createdAt)}{operation.sourceLabel ? ` · ${operation.sourceLabel}` : ''}</p>
                  </div>
                  <Link href={`/dashboard/guilds/${operation.guildId}/audit-logs?category=plugin`} aria-label="Plugin監査ログを開く" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-primary">
                    <History className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PageHeader() {
  return (
    <>
      <Link href="/dashboard/plugins" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> プラグイン管理へ戻る
      </Link>
      <section className="rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Plugin Operations</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Plugin Operations Center</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">管理可能なDiscordサーバーの公式Pluginを横断し、設定整合性と最近の管理操作を確認します。</p>
      </section>
    </>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
      <p className="mt-4 text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function StatusBadge({ status }: { status: 'attention' | 'healthy' | 'paused' }) {
  const label = status === 'attention' ? 'Attention' : status === 'healthy' ? 'Healthy' : 'Paused';
  return <span className="inline-flex rounded-full bg-border/60 px-2.5 py-1 text-[10px] font-semibold">{label}</span>;
}

function MessagePanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-6">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </div>
  );
}

function formatJst(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${JST_DATE_TIME.format(date)} JST`;
}
