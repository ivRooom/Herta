import Link from 'next/link';
import { ArrowLeft, Blocks, FileKey2, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { AccessResourceNavigation } from '@/components/access-resource-navigation';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { loadStudioAccessInventory } from '@/lib/studio-access-inventory';
import { studioAccessPageResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

export default async function GuildAccessControlPage({
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
    studioAccessPageResource(guildId, 'overview'),
  );
  if (!authorization.ok) {
    return <AccessUnavailable guildId={guildId} status={authorization.response.status} />;
  }

  const inventory = await loadStudioAccessInventory(guildId);
  if (!inventory) return <AccessUnavailable guildId={guildId} status={503} />;

  const counts = {
    users: inventory.users.length,
    groups: inventory.groups.length,
    roles: inventory.roles.length,
    policies: inventory.policies.length,
  };

  return (
    <div className="space-y-7">
      <Link
        href={`/dashboard/guilds/${guildId}/roles`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Role Managerへ戻る
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              {inventory.guildName} · Herta IAM
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Access Control Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              AWS IAMと同じ考え方で、Users・Groups・Discord Roles・Managed
              Policiesを独立したResourceとして確認します。Policyは複数PrincipalへAttachでき、明示DenyがAllowより優先されます。
            </p>
          </div>
        </div>
      </section>

      <AccessResourceNavigation guildId={guildId} active="resources" counts={counts} />

      <section>
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">IAM</p>
          <h2 className="mt-1 text-xl font-semibold">Resources</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ResourceCard
            href={`/dashboard/guilds/${guildId}/access/users`}
            label="Users"
            value={counts.users}
            description="直接PolicyまたはGroup membershipを持つDiscord User"
            icon={<UserRound className="h-5 w-5" aria-hidden="true" />}
          />
          <ResourceCard
            href={`/dashboard/guilds/${guildId}/access/groups`}
            label="Groups"
            value={counts.groups}
            description="複数UserへPolicyをまとめて適用するHerta Group"
            icon={<UsersRound className="h-5 w-5" aria-hidden="true" />}
          />
          <ResourceCard
            href={`/dashboard/guilds/${guildId}/access/roles`}
            label="Roles"
            value={counts.roles}
            description="Discord RoleへAttachされたHerta権限を確認"
            icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          />
          <ResourceCard
            href={`/dashboard/guilds/${guildId}/access/policies`}
            label="Policies"
            value={counts.policies}
            description="ページ・設定項目・操作単位のManaged Policy"
            icon={<FileKey2 className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      </section>

      {inventory.legacyRolePolicyCount > 0 ? (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
          <div className="flex gap-3">
            <Blocks className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold">Legacy Role Policy互換モード</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                既存Role Policyが{inventory.legacyRolePolicyCount}
                件あります。既存権限を壊さないため認可時のみ読み取り継続し、新規権限はManaged
                Policyへ集約します。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {inventory.invalidPolicyCount > 0 ? (
        <section
          className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 sm:p-5"
          role="alert"
        >
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
            無効なManaged Policyを検出しました
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            {inventory.invalidPolicyCount}
            件のPolicy documentが現在のSchemaまたはGuild
            scopeを満たしていません。認可resolverも安全側に倒して拒否します。
          </p>
        </section>
      ) : null}

      {!authorization.access.isRoot ? (
        <section className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          閲覧モードです。Policy・Group・Attachmentの変更にはOWNER root Roleが必要です。
        </section>
      ) : null}
    </div>
  );
}

function ResourceCard({
  href,
  label,
  value,
  description,
  icon,
}: {
  href: string;
  label: string;
  value: number;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
      </div>
      <h3 className="mt-4 text-lg font-semibold group-hover:text-primary">{label}</h3>
      <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
    </Link>
  );
}

function AccessUnavailable({ guildId, status }: { guildId: string; status: number }) {
  const message =
    status === 403
      ? 'Access Control Centerを閲覧する権限がありません。許可されたPolicyが必要です。'
      : 'Discordまたは権限データを確認できませんでした。安全のためAccess Controlを拒否しています。';
  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← サーバー概要へ戻る
      </Link>
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h1 className="text-xl font-semibold">Access Control Centerを開けません</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
      </section>
    </div>
  );
}
