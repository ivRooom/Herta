import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { auth } from '@/auth';
import { ModerationConfigForm } from '@/components/moderation-config-form';
import { PluginConfigForm } from '@/components/plugin-config-form';
import { ValorantConfigForm } from '@/components/valorant-config-form';
import { PluginSetupOverview } from '@/components/plugin-setup-overview';
import { RestrictedPluginConfigForm } from '@/components/restricted-plugin-config-form';
import { getGuildConfigurationOptionsCached } from '@/lib/bot-guild-options';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { schemaNeedsDiscordOptions } from '@/lib/plugin-config-studio';
import { resolveModerationConfigSection } from '@/lib/moderation-config-ui';
import { pluginConfigPermissionPaths } from '@/lib/plugin-config-paths';
import { resolveStudioAccess } from '@/lib/studio-access';
import {
  filterReadablePluginConfig,
  resolvePluginConfigStudioAccess,
} from '@/lib/studio-plugin-permissions';
import { withStudioPagePermission } from '@/components/studio-page-permission-boundary';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

async function PluginDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string; pluginId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ guildId, pluginId }, query] = await Promise.all([params, searchParams]);
  const session = await auth();
  if (!session?.user) notFound();
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) notFound();

  const plugin = await getGuildPlugin(guildId, pluginId);
  if (!plugin) notFound();
  const configPaths = pluginConfigPermissionPaths(plugin.manifest.configSchema);
  const configAccess = resolvePluginConfigStudioAccess(
    access.access,
    guildId,
    pluginId,
    configPaths,
  );
  const visibleConfig = filterReadablePluginConfig(
    plugin.config,
    configAccess,
    plugin.manifest.configSchema,
  );
  const allFieldsReadable = configAccess.allConfigPathsReadable;
  const allFieldsEditable = configAccess.allConfigPathsEditable;
  const canUseValorantGuidedEditor =
    pluginId === 'valorant' && configAccess.readableConfigPaths.includes('enabledAgents');
  const canManageValorantPlugin =
    allFieldsReadable && allFieldsEditable && configAccess.canToggleEnabled;
  const canUseModerationGuidedEditor =
    pluginId === 'moderation' &&
    allFieldsReadable &&
    allFieldsEditable &&
    configAccess.canToggleEnabled;

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Plugin 一覧へ戻る
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
          config={visibleConfig}
        />

        <Suspense fallback={<PluginConfigFormSkeleton />}>
          <PluginConfigSection
            guildId={guildId}
            pluginId={pluginId}
            enabled={plugin.enabled}
            configSchema={plugin.manifest.configSchema}
            visibleConfig={visibleConfig}
            configAccess={configAccess}
            initialSection={resolveModerationConfigSection(query.section)}
            canUseModerationGuidedEditor={canUseModerationGuidedEditor}
            canUseValorantGuidedEditor={canUseValorantGuidedEditor}
            canManageValorantPlugin={canManageValorantPlugin}
            allFieldsReadable={allFieldsReadable}
            allFieldsEditable={allFieldsEditable}
          />
        </Suspense>
      </div>

      {pluginId === 'moderation' ? (
        <>
          <ManagementLink
            href={`/dashboard/guilds/${guildId}/moderation/detection-settings`}
            title="自動検知の詳細パラメータ"
            description="メンション閾値、連投・重複投稿の件数と時間窓、本文最大長、招待Allowlist、Alert、保持期間などをSchemaベースで細かく設定します。"
          />
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

      {pluginId === 'daily-bonus' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/daily-bonus`}
          title="デイリーボーナス配信・記念日管理"
          description="配信履歴、受取状況、失敗時の再試行、記念日の登録・出典確認を管理します。"
        />
      ) : null}

      {pluginId === 'daily-content' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/daily-content`}
          title="Daily Content配信管理"
          description="定時コンテンツ、次回配信、配信履歴、失敗再実行を管理します。"
        />
      ) : null}

      {pluginId === 'activity-rules' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/activity-rules/diagnostics`}
          title="Activity Rules Diagnostics"
          description="Channel・Role・本文・Intent・Cooldownを入力し、Messages集計とXP付与の判定理由をシミュレーションします。"
        />
      ) : null}

      {pluginId === 'birthday-role' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/birthday`}
          title="Birthday管理"
          description="Discordメンバーの誕生日を月日だけで登録・更新・解除します。"
        />
      ) : null}

      {pluginId === 'valorant' ? (
        <ManagementLink
          href={`/dashboard/guilds/${guildId}/valorant/stats`}
          title="VALORANT抽選統計"
          description="抽選履歴を集計し、候補入りを分母とした選出率・マップ・プレイヤー傾向を確認します。"
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

/**
 * 設定フォーム部分。Guild options の取得はこの中だけで行い、Suspense で
 * 遅延させることで、ヘッダーや概要を options の応答を待たずに表示する。
 * options は候補 picker を使うフォームでだけ取得し、それ以外では Bot へ
 * 問い合わせ自体を行わない。
 */
async function PluginConfigSection({
  guildId,
  pluginId,
  enabled,
  configSchema,
  visibleConfig,
  configAccess,
  initialSection,
  canUseModerationGuidedEditor,
  canUseValorantGuidedEditor,
  canManageValorantPlugin,
  allFieldsReadable,
  allFieldsEditable,
}: {
  guildId: string;
  pluginId: string;
  enabled: boolean;
  configSchema: Record<string, unknown>;
  visibleConfig: Record<string, unknown>;
  configAccess: ReturnType<typeof resolvePluginConfigStudioAccess>;
  initialSection: ReturnType<typeof resolveModerationConfigSection>;
  canUseModerationGuidedEditor: boolean;
  canUseValorantGuidedEditor: boolean;
  canManageValorantPlugin: boolean;
  allFieldsReadable: boolean;
  allFieldsEditable: boolean;
}) {
  const optionsRequired =
    canUseModerationGuidedEditor ||
    (allFieldsReadable && allFieldsEditable && schemaNeedsDiscordOptions(configSchema));
  const discordOptions = optionsRequired ? await getGuildConfigurationOptionsCached(guildId) : null;

  if (canUseModerationGuidedEditor) {
    return (
      <ModerationConfigForm
        guildId={guildId}
        initialEnabled={enabled}
        initialConfig={visibleConfig}
        initialSection={initialSection}
        discordOptions={discordOptions}
      />
    );
  }
  if (canUseValorantGuidedEditor) {
    return (
      <ValorantConfigForm
        guildId={guildId}
        initialEnabled={enabled}
        initialConfig={visibleConfig}
        canManagePlugin={canManageValorantPlugin}
      />
    );
  }
  if (allFieldsReadable && allFieldsEditable) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <PluginConfigForm
          guildId={guildId}
          pluginId={pluginId}
          initialEnabled={enabled}
          initialConfig={visibleConfig}
          schema={configSchema}
          discordOptions={discordOptions}
          configAccess={configAccess}
          optionsRequired={optionsRequired}
        />
      </div>
    );
  }
  return (
    <RestrictedPluginConfigForm
      guildId={guildId}
      pluginId={pluginId}
      initialEnabled={enabled}
      initialConfig={visibleConfig}
      schema={configSchema}
      configAccess={configAccess}
    />
  );
}

function PluginConfigFormSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-surface p-6 shadow-card"
      role="status"
      aria-label="設定フォームを読み込み中"
    >
      <div className="animate-pulse space-y-4" aria-hidden="true">
        <div className="h-5 w-40 rounded bg-border/60" />
        <div className="h-10 w-full rounded bg-border/60" />
        <div className="h-10 w-full rounded bg-border/60" />
        <div className="h-10 w-2/3 rounded bg-border/60" />
      </div>
      <p className="mt-4 text-sm text-muted">設定フォームを読み込んでいます…</p>
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
      <ArrowRight className="h-5 w-5 text-muted" aria-hidden="true" />
    </Link>
  );
}

export default withStudioPagePermission(PluginDetailPage, 'plugins');
