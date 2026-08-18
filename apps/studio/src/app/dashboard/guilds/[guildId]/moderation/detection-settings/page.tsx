import Link from 'next/link';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { PluginConfigForm } from '@/components/plugin-config-form';
import { RestrictedPluginConfigForm } from '@/components/restricted-plugin-config-form';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { resolveStudioAccess } from '@/lib/studio-access';
import {
  filterReadablePluginConfig,
  resolvePluginConfigStudioAccess,
} from '@/lib/studio-plugin-permissions';

export const dynamic = 'force-dynamic';

export default async function ModerationDetectionSettingsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const session = await auth();
  if (!session?.user) notFound();
  const { guildId } = await params;
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) notFound();

  const [plugin, discordOptions] = await Promise.all([
    getGuildPlugin(guildId, 'moderation'),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!plugin) notFound();
  const fieldKeys = topLevelConfigFieldKeys(plugin.manifest.configSchema);
  const configAccess = resolvePluginConfigStudioAccess(
    access.access,
    guildId,
    'moderation',
    fieldKeys,
  );
  const visibleConfig = filterReadablePluginConfig(plugin.config, configAccess);
  const allReadable = configAccess.readableFieldKeys.length === fieldKeys.length;

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/moderation?section=rules#moderation-config`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Moderation設定へ戻る
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Moderation / Advanced detection
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              自動検知の詳細パラメータ
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              NGワードだけでなく、メンション数、連投・重複投稿の件数と時間窓、本文最大長、Discord招待Allowlist、Alert閾値、Cooldown、Case保持などModeration
              Manifestが実際にサポートする値を細かく調整します。
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Hint
          title="大量メンション"
          value="0–100"
          description="0で無効。User・Role・everyone合計。"
        />
        <Hint
          title="短時間の連投"
          value="0–50 / 1–300秒"
          description="投稿数と監視時間を別々に調整。"
        />
        <Hint title="重複投稿" value="0–20 / 1–600秒" description="正規化後の同一本文を監視。" />
        <Hint title="本文最大長" value="100–4000" description="自動検知で解析する本文長の上限。" />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 text-sm leading-6 text-muted sm:p-5">
        通常のNGワード追加は従来の「NGワード・自動検知」を使い、この画面では閾値・時間窓・Alert・除外・保持期間などを調整してください。設定項目検索に
        `auto`、`Alert`、`Case` などを入力すると絞り込めます。
      </section>

      {allReadable ? (
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <PluginConfigForm
            guildId={guildId}
            pluginId="moderation"
            initialEnabled={plugin.enabled}
            initialConfig={visibleConfig}
            schema={plugin.manifest.configSchema}
            discordOptions={discordOptions}
            configAccess={configAccess}
          />
        </div>
      ) : (
        <RestrictedPluginConfigForm
          guildId={guildId}
          pluginId="moderation"
          initialEnabled={plugin.enabled}
          initialConfig={visibleConfig}
          schema={plugin.manifest.configSchema}
          configAccess={configAccess}
        />
      )}
    </div>
  );
}

function Hint({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold text-muted">{title}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
    </div>
  );
}

function topLevelConfigFieldKeys(schema: Record<string, unknown>): string[] {
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties);
}
