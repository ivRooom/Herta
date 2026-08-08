import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  KeyRound,
  Settings2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

export type PluginHubGuildOption = {
  id: string;
  name: string;
};

export type PluginHubGuildPluginState = {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  hasConfigSchema: boolean;
  requiredPermissionCount: number;
  dependencies: Array<{
    pluginId: string;
    optional: boolean;
    installed: boolean;
    enabled: boolean;
  }>;
};

export function PluginHubGuildPreflight({
  guilds,
  selectedGuildId,
  selectedGuildName,
  plugins,
  unavailableReason,
}: {
  guilds: PluginHubGuildOption[];
  selectedGuildId?: string;
  selectedGuildName?: string;
  plugins: PluginHubGuildPluginState[];
  unavailableReason?: string;
}) {
  const selected = Boolean(selectedGuildId && selectedGuildName);
  const installedCount = plugins.filter((plugin) => plugin.installed).length;
  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;
  const blockedCount = plugins.filter((plugin) => hasMissingRequiredDependency(plugin)).length;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Guild Install Preflight
          </div>
          <h2 className="mt-2 text-xl font-semibold">導入前にGuild状態を確認</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            対象Guildを選ぶと、公式Pluginの導入済み・有効状態、必須依存Plugin、要求Capability、Config有無をCatalog上で確認できます。
          </p>
        </div>

        {selected ? (
          <div className="grid grid-cols-3 gap-2 sm:min-w-[18rem]">
            <Summary label="Installed" value={installedCount} />
            <Summary label="Enabled" value={enabledCount} accent />
            <Summary label="Blocked" value={blockedCount} warning={blockedCount > 0} />
          </div>
        ) : null}
      </div>

      {unavailableReason ? (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-700 dark:text-amber-300">
          {unavailableReason}
        </div>
      ) : guilds.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-background p-5 text-sm text-muted">
          管理可能なGuildがありません。Discord側で「管理者」または「サーバー管理」権限を持つGuildが対象です。
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Target Guild</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Preflight対象Guild">
            {guilds.map((guild) => (
              <Link
                key={guild.id}
                href={`/dashboard/custom-plugins?guild=${encodeURIComponent(guild.id)}`}
                aria-current={guild.id === selectedGuildId ? 'page' : undefined}
                className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  guild.id === selectedGuildId
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted hover:text-foreground'
                }`}
              >
                {guild.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {selected ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted">Preflight target</p>
              <p className="mt-1 font-semibold">{selectedGuildName}</p>
            </div>
            <Link
              href={`/dashboard/guilds/${selectedGuildId}/plugins`}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Plugin Managerを開く <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {plugins.map((plugin) => (
              <PluginPreflightRow key={plugin.id} guildId={selectedGuildId!} plugin={plugin} />
            ))}
          </ul>
        </div>
      ) : guilds.length > 0 && !unavailableReason ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
          <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Guildを選択してください</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              選択したGuild以外のPlugin状態は読み込まないため、不要なDBアクセスを増やしません。
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PluginPreflightRow({
  guildId,
  plugin,
}: {
  guildId: string;
  plugin: PluginHubGuildPluginState;
}) {
  const requiredDependencies = plugin.dependencies.filter((dependency) => !dependency.optional);
  const missingDependencies = requiredDependencies.filter((dependency) => !dependency.enabled);
  const ready = missingDependencies.length === 0;

  return (
    <li className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{plugin.name}</p>
            <StatusBadge installed={plugin.installed} enabled={plugin.enabled} />
          </div>
          <p className="mt-1 break-all text-[11px] text-muted">{plugin.id}</p>
        </div>
        {ready ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-label="依存関係Ready" />
        ) : (
          <TriangleAlert className="h-5 w-5 shrink-0 text-amber-500" aria-label="必須依存Plugin不足" />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <CheckItem
          icon={KeyRound}
          label="Capabilities"
          value={`${plugin.requiredPermissionCount}件`}
          ok
        />
        <CheckItem
          icon={Settings2}
          label="Config"
          value={plugin.hasConfigSchema ? 'Schemaあり' : '設定なし'}
          ok
        />
        <CheckItem
          icon={ShieldCheck}
          label="Dependencies"
          value={ready ? 'Ready' : `${missingDependencies.length}件不足`}
          ok={ready}
        />
      </div>

      {plugin.dependencies.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {plugin.dependencies.map((dependency) => (
            <span
              key={dependency.pluginId}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${
                dependency.optional || dependency.enabled
                  ? 'border-border text-muted'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
              }`}
            >
              {dependency.pluginId} · {dependency.optional ? 'optional' : dependency.enabled ? 'ready' : 'required'}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-[11px] leading-5 text-muted">
          {ready
            ? plugin.enabled
              ? 'Runtimeで有効です。設定内容を確認できます。'
              : plugin.installed
                ? '導入済みですが無効です。Plugin Managerから有効化できます。'
                : '必須依存関係は満たされています。Plugin Managerから導入できます。'
            : '必須依存Pluginを先に有効化してください。'}
        </p>
        <Link
          href={`/dashboard/guilds/${guildId}/plugins/${plugin.id}`}
          className="shrink-0 text-xs font-semibold text-primary hover:underline"
        >
          {plugin.installed ? '設定' : '導入'}
        </Link>
      </div>
    </li>
  );
}

function StatusBadge({ installed, enabled }: { installed: boolean; enabled: boolean }) {
  const label = enabled ? 'Enabled' : installed ? 'Installed' : 'Not installed';
  const className = enabled
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : installed
      ? 'border-primary/30 bg-primary/10 text-primary'
      : 'border-border bg-surface text-muted';
  return <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${className}`}>{label}</span>;
}

function CheckItem({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-muted">
        <Icon className={`h-3 w-3 ${ok ? 'text-primary' : 'text-amber-500'}`} aria-hidden="true" />
        {label}
      </div>
      <p className={`mt-1 font-semibold ${ok ? '' : 'text-amber-700 dark:text-amber-300'}`}>{value}</p>
    </div>
  );
}

function Summary({
  label,
  value,
  accent = false,
  warning = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-3 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warning ? 'text-amber-500' : accent ? 'text-primary' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function hasMissingRequiredDependency(plugin: PluginHubGuildPluginState): boolean {
  return plugin.dependencies.some((dependency) => !dependency.optional && !dependency.enabled);
}
