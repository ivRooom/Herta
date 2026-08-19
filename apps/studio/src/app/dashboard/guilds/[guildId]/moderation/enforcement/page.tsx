import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, LockKeyhole, ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import { ModerationEnforcementForm } from '@/components/moderation-enforcement-form';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';
import { resolveStudioAccess } from '@/lib/studio-access';
import {
  filterReadablePluginConfig,
  resolvePluginConfigStudioAccess,
} from '@/lib/studio-plugin-permissions';

export const dynamic = 'force-dynamic';

export default async function ModerationEnforcementPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const [guild, studioAccess] = await Promise.all([
    getManageableGuild(accessToken, guildId),
    resolveStudioAccess(guildId, session.user.id),
  ]);
  if (!guild || !studioAccess.ok) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const [plugin, discordOptions] = await Promise.all([
    getGuildPlugin(guildId, 'moderation'),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!plugin) notFound();
  const fieldKeys = topLevelConfigFieldKeys(plugin.manifest.configSchema);
  const configAccess = resolvePluginConfigStudioAccess(
    studioAccess.access,
    guildId,
    'moderation',
    fieldKeys,
  );
  const visibleConfig = filterReadablePluginConfig(plugin.config, configAccess);
  const canUseFullEditor =
    configAccess.readableFieldKeys.length === fieldKeys.length &&
    configAccess.editableFieldKeys.length === fieldKeys.length;

  return (
    <div className="min-w-0">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/moderation`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Moderation Pluginへ戻る
      </Link>

      <div className="mt-6">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">自動対応ポリシー</h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          {guild.name}{' '}
          の自動検知ごとに危険度・警告・削除・Timeout・ロール付与・ブラックリスト・Kick・BANを設定します。
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
          IP BANはDiscord Bot APIで接続元IPを取得できないため利用できません。ブラックリストはDiscord
          User IDを永久登録し、再参加時も自動BANします。
        </p>
      </div>

      <div className="mt-7">
        {canUseFullEditor ? (
          <ModerationEnforcementForm
            guildId={guildId}
            initialConfig={visibleConfig}
            discordOptions={discordOptions}
          />
        ) : (
          <section className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">この専用Editorはフル設定権限が必要です</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                  自動対応Editorは複数の検知ルール・Alert設定を一体で編集するため、IAMで一部設定が非公開または編集不可の場合は値をClientへ渡しません。許可された項目だけを変更する場合は詳細パラメータEditorを使用してください。
                </p>
                <Link
                  href={`/dashboard/guilds/${guildId}/moderation/detection-settings`}
                  className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                >
                  許可された設定項目を開く
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function topLevelConfigFieldKeys(schema: Record<string, unknown>): string[] {
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return [];
  return Object.keys(properties);
}
