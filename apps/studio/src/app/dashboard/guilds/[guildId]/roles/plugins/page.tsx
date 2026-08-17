import Link from 'next/link';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import {
  PluginPermissionManager,
  type PluginPermissionDescriptor,
} from '@/components/plugin-permission-manager';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { listGuildPlugins } from '@/lib/guild-plugins';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';
import { listStudioRolePolicies } from '@/lib/studio-role-policy-store';

export const dynamic = 'force-dynamic';

export default async function PluginPermissionsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const session = await auth();
  if (!session?.user) notFound();
  const { guildId } = await params;
  const authorization = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.roles.read',
    `guild:${guildId}:role:*`,
  );
  if (!authorization.ok) notFound();

  const [options, policies, plugins] = await Promise.all([
    getGuildConfigurationOptions(guildId),
    listStudioRolePolicies(guildId),
    listGuildPlugins(guildId),
  ]);
  if (!options) notFound();

  const descriptors = plugins
    .map(({ manifest }) => toPermissionDescriptor(manifest.id, manifest.name, manifest.configSchema))
    .sort((left, right) => left.name.localeCompare(right.name, 'ja'));

  return (
    <div className="space-y-7">
      <Link
        href={`/dashboard/guilds/${guildId}/roles`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Role Managerへ戻る
      </Link>

      <section className="rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              {options.guildName}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Plugin Permission Matrix
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Discord Roleごとに、Pluginの有効・無効操作と各設定項目の編集可否を個別指定します。項目単位のDenyは全体Allowより優先されます。
            </p>
          </div>
        </div>
      </section>

      <PluginPermissionManager
        guildId={guildId}
        roles={options.roles.map((role) => ({ id: role.id, name: role.name }))}
        policies={policies}
        plugins={descriptors}
        rootRoleId={STUDIO_ROOT_DISCORD_ROLE_ID}
        canEdit={authorization.access.isRoot}
      />
    </div>
  );
}

function toPermissionDescriptor(
  id: string,
  name: string,
  schema: Record<string, unknown>,
): PluginPermissionDescriptor {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return {
    id,
    name,
    fields: Object.entries(properties).map(([key, rawSchema]) => {
      const fieldSchema = isRecord(rawSchema) ? rawSchema : {};
      return {
        key,
        label: typeof fieldSchema.title === 'string' && fieldSchema.title.trim() ? fieldSchema.title : key,
        description:
          typeof fieldSchema.description === 'string' && fieldSchema.description.trim()
            ? fieldSchema.description
            : undefined,
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
