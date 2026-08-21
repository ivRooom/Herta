import { getBirthdayCardBackgroundMetadata, listBirthdayCardAssetMetadata } from '@herta/db';
import { BIRTHDAY_CARD_CONFIG_FIELD_KEYS } from '@herta/shared';
import { ArrowLeft, Cake } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { BirthdayAdmin } from '@/components/birthday-admin';
import { BirthdayCardEditor } from '@/components/birthday-card-editor';
import { BirthdayRegistrationShare } from '@/components/birthday-registration-share';
import { listBirthdayRegistrations } from '@/lib/birthday-admin';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { prisma } from '@/lib/db';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { resolveStudioAccess } from '@/lib/studio-access';
import {
  filterReadablePluginConfig,
  hasEffectivePluginPermission,
  resolvePluginConfigStudioAccess,
} from '@/lib/studio-plugin-permissions';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

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

  const [plugin, studioAccess, discordOptions] = await Promise.all([
    getGuildPlugin(guildId, 'birthday-role'),
    resolveStudioAccess(guildId, session.user.id),
    getGuildConfigurationOptions(guildId),
  ]);

  const canReadRegistrations =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.read',
      studioBirthdayResource(guildId, 'registrations'),
    );
  const canWriteRegistrations =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'registrations'),
    );
  const canReadCelebrations =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.read',
      studioBirthdayResource(guildId, 'celebrations'),
    );
  const canReadCardBackground =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.read',
      studioBirthdayResource(guildId, 'card-background'),
    );
  const canWriteCardBackground =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'card-background'),
    );
  const canReadAssets =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.read',
      studioBirthdayResource(guildId, 'card-assets'),
    );
  const canWriteAssets =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'card-assets'),
    );
  const canManagePresets =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'card-presets'),
    );
  const canTestSendCard =
    studioAccess.ok &&
    hasEffectivePluginPermission(
      studioAccess.access,
      'studio.operation.execute',
      studioBirthdayResource(guildId, 'card-test-send'),
    );

  const [registrations, backgroundMetadata, assetMetadata] = await Promise.all([
    canReadRegistrations ? listBirthdayRegistrations(guildId) : Promise.resolve([]),
    canReadCardBackground
      ? getBirthdayCardBackgroundMetadata(prisma, guildId)
      : Promise.resolve(null),
    canReadAssets ? listBirthdayCardAssetMetadata(prisma, guildId) : Promise.resolve([]),
  ]);
  const visibleRegistrations = canReadCelebrations
    ? registrations
    : registrations.map(
        ({
          latestAge: _age,
          latestServerBirthdayNumber: _number,
          celebrationCount: _count,
          ...registration
        }) => registration,
      );

  const messageTargets = (discordOptions?.messageTargets ?? discordOptions?.channels ?? []).filter(
    (channel) => channel.viewable && channel.kind !== 'forum',
  );

  let cardEditor: ReactNode = null;
  if (plugin && studioAccess.ok) {
    const configAccess = resolvePluginConfigStudioAccess(
      studioAccess.access,
      guildId,
      'birthday-role',
      BIRTHDAY_CARD_CONFIG_FIELD_KEYS,
    );
    const readableConfig = filterReadablePluginConfig(plugin.config, configAccess);
    cardEditor =
      configAccess.readableFieldKeys.length > 0 ? (
        <BirthdayCardEditor
          guildId={guildId}
          initialConfig={readableConfig}
          configAccess={configAccess}
          initialBackground={
            backgroundMetadata
              ? {
                  contentType: backgroundMetadata.contentType,
                  fileName: backgroundMetadata.fileName,
                  sizeBytes: backgroundMetadata.sizeBytes,
                  width: backgroundMetadata.width,
                  height: backgroundMetadata.height,
                  sha256: backgroundMetadata.sha256,
                  updatedAt: backgroundMetadata.updatedAt.toISOString(),
                }
              : null
          }
          initialAssets={assetMetadata.map((asset) => ({
            id: asset.id,
            name: asset.name,
            contentType: asset.contentType,
            sizeBytes: asset.sizeBytes,
            width: asset.width,
            height: asset.height,
            sha256: asset.sha256,
            isPreset: asset.isPreset,
            createdAt: asset.createdAt.toISOString(),
            updatedAt: asset.updatedAt.toISOString(),
          }))}
          canReadBackground={canReadCardBackground}
          canWriteBackground={canWriteCardBackground}
          canReadAssets={canReadAssets}
          canWriteAssets={canWriteAssets}
          canManagePresets={canManagePresets}
          canTestSend={canTestSendCard}
          channelOptions={messageTargets}
        />
      ) : (
        <PermissionNotice>
          Birthday Card設定を閲覧するIAM権限がありません。Policyで必要な設定項目だけを許可できます。
        </PermissionNotice>
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
              {guild.name} のメンバー誕生日、生年（任意）、祝い実績、Birthday
              Cardを管理します。生年は年齢表示を利用したいメンバーだけ登録できます。
            </p>
          </div>
        </div>
      </section>

      {canReadRegistrations ? <BirthdayRegistrationShare guildId={guildId} /> : null}

      {canReadRegistrations ? (
        <BirthdayAdmin
          guildId={guildId}
          initialRegistrations={visibleRegistrations}
          canEdit={canWriteRegistrations}
          showCelebrationStats={canReadCelebrations}
        />
      ) : (
        <PermissionNotice>
          メンバーの誕生日・生年を閲覧するIAM権限がありません。Birthday
          Cardの設定権限とは独立して制御されます。
        </PermissionNotice>
      )}

      {cardEditor}
    </div>
  );
}

function PermissionNotice({ children }: { children: ReactNode }) {
  return (
    <section
      className="rounded-2xl border border-amber-400/20 bg-surface p-5 text-sm text-muted"
      role="status"
    >
      {children}
    </section>
  );
}
