import Link from 'next/link';
import { ArrowRight, Bot, Crown, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { AccessResourceNavigation } from '@/components/access-resource-navigation';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { loadStudioAccessInventory } from '@/lib/studio-access-inventory';
import { studioAccessPageResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

export default async function AccessRolesPage({
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
    studioAccessPageResource(guildId, 'roles'),
  );
  if (!authorization.ok) return <AccessDenied guildId={guildId} />;

  const inventory = await loadStudioAccessInventory(guildId);
  if (!inventory) return <AccessDenied guildId={guildId} />;
  const policyNameById = new Map(inventory.policies.map((policy) => [policy.id, policy.name]));
  const roles = [...inventory.roles].sort((left, right) => right.position - left.position);

  return (
    <div className="space-y-6">
      <Header guildId={guildId} guildName={inventory.guildName} />
      <AccessResourceNavigation
        guildId={guildId}
        active="roles"
        counts={{
          users: inventory.users.length,
          groups: inventory.groups.length,
          roles: inventory.roles.length,
          policies: inventory.policies.length,
        }}
      />

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              IAM / Roles
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Roles</h1>
            <p className="mt-1 text-sm text-muted">
              Discord RoleとAttach済みManaged Policyを一覧表示します。Role本体の作成・削除はRole
              Managerで行います。
            </p>
          </div>
          <Link
            href={`/dashboard/guilds/${guildId}/roles`}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition hover:border-primary/40"
          >
            Role Manager <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {roles.map((role) => {
            const policyNames = inventory.attachments
              .filter(
                (attachment) =>
                  attachment.principalType === 'role' && attachment.principalId === role.id,
              )
              .map((attachment) => policyNameById.get(attachment.policyId) ?? attachment.policyId);
            return (
              <article key={role.id} className="bg-background px-4 py-4">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color || '#64748b' }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{role.name}</h2>
                      {role.root ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">
                          <Crown className="h-3 w-3" aria-hidden="true" /> root
                        </span>
                      ) : null}
                      {role.managed ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                          <Bot className="h-3 w-3" aria-hidden="true" /> managed
                        </span>
                      ) : null}
                    </div>
                    <code className="mt-1 block break-all text-[11px] text-muted">{role.id}</code>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-border px-2.5 py-1">
                        Position {role.position}
                      </span>
                      <span className="rounded-full border border-border px-2.5 py-1">
                        Policies {policyNames.length}
                      </span>
                      <span className="rounded-full border border-border px-2.5 py-1">
                        {role.editable ? 'Bot管理可能' : 'Bot管理不可'}
                      </span>
                    </div>
                    {policyNames.length > 0 ? (
                      <p className="mt-2 text-xs text-muted">{policyNames.join(', ')}</p>
                    ) : (
                      <p className="mt-2 text-xs text-muted">Managed Policy未Attach</p>
                    )}
                  </div>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Header({ guildId, guildName }: { guildId: string; guildName: string }) {
  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/access`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← Access Controlへ戻る
      </Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {guildName} · Herta IAM
      </p>
    </div>
  );
}

function AccessDenied({ guildId }: { guildId: string }) {
  return (
    <div className="space-y-4">
      <Link href={`/dashboard/guilds/${guildId}/access`} className="text-sm text-muted">
        ← Access Controlへ戻る
      </Link>
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5" role="alert">
        Roles一覧を閲覧する権限がないか、権限データを安全に確認できませんでした。
      </section>
    </div>
  );
}
