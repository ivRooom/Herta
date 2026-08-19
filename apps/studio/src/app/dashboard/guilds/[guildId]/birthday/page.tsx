import { BIRTHDAY_CARD_CONFIG_FIELD_KEYS } from '@herta/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ArrowLeft, Cake } from 'lucide-react';
import { auth } from '@/auth';
import { BirthdayAdmin } from '@/components/birthday-admin';
import { BirthdayCardEditor } from '@/components/birthday-card-editor';
import { listBirthdayRegistrations } from '@/lib/birthday-admin';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { resolveStudioAccess } from '@/lib/studio-access';
import {
  filterReadablePluginConfig,
  resolvePluginConfigStudioAccess,
} from '@/lib/studio-plugin-permissions';

export const dynamic = 'force-dynamic';

export default async function BirthdayAdminPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const [registrations, plugin, studioAccess] = await Promise.all([
    listBirthdayRegistrations(guildId),
    getGuildPlugin(guildId, 'birthday-role'),
    resolveStudioAccess(guildId, session.user.id),
  ]);

  let cardEditor: ReactNode = null;
  if (plugin && studioAccess.ok) {
    const configAccess = resolvePluginConfigStudioAccess(
      studioAccess.access,
      guildId,
      'birthday-role',
      BIRTHDAY_CARD_CONFIG_FIELD_KEYS,
    );
    const readableConfig = filterReadablePluginConfig(plugin.config, configAccess);
    const canReadAllCardFields = BIRTHDAY_CARD_CONFIG_FIELD_KEYS.every((key) =>
      configAccess.readableFieldKeys.includes(key),
    );
    cardEditor = canReadAllCardFields ? (
      <BirthdayCardEditor
        guildId={guildId}
        initialConfig={readableConfig}
        configAccess={configAccess}
      />
    ) : (
      <section className="rounded-2xl border border-amber-400/20 bg-surface p-5 text-sm text-muted">
        Birthday Cardの一部設定を閲覧するIAM権限がありません。許可された項目はBirthday RoleのPlugin設定から確認できます。
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/birthday-role`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Birthday Roleへ戻る
      </Link>
      <section className="rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Cake className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Birthday Role v2
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Birthday Management
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {guild.name} のメンバー誕生日、生年（任意）、祝い実績、Birthday Cardを管理します。生年は年齢表示を利用したいメンバーだけ登録できます。
            </p>
          </div>
        </div>
      </section>
      <BirthdayAdmin guildId={guildId} initialRegistrations={registrations} />
      {cardEditor}
    </div>
  );
}
