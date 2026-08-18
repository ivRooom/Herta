import Link from 'next/link';
import { UsersRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { AccessGroupManager } from '@/components/access-group-manager';
import { AccessResourceNavigation } from '@/components/access-resource-navigation';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { loadStudioAccessInventory } from '@/lib/studio-access-inventory';
import { studioAccessPageResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

export default async function AccessGroupsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) notFound();
  const { guildId } = await params;
  const authorization = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.roles.read',
    studioAccessPageResource(guildId, 'groups'),
  );
  if (!authorization.ok) return <AccessDenied guildId={guildId} />;

  const inventory = await loadStudioAccessInventory(guildId);
  if (!inventory) return <AccessDenied guildId={guildId} />;
  const policyNameById = new Map(inventory.policies.map((policy) => [policy.id, policy.name]));

  return (
    <div className="space-y-6">
      <Header guildId={guildId} guildName={inventory.guildName} />
      <AccessResourceNavigation
        guildId={guildId}
        active="groups"
        counts={{
          users: inventory.users.length,
          groups: inventory.groups.length,
          roles: inventory.roles.length,
          policies: inventory.storedPolicyCount,
        }}
      />

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">IAM / Groups</p>
        <h1 className="mt-1 text-2xl font-semibold">Groups</h1>
        <p className="mt-1 text-sm text-muted">
          UserをGroupへまとめ、同じManaged Policyを複数Userへ一括適用できます。
        </p>
        <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {inventory.groups.map((group) => {
            const memberCount = inventory.groupMembers.filter(
              (member) => member.groupId === group.id,
            ).length;
            const policyNames = inventory.attachments
              .filter(
                (attachment) =>
                  attachment.principalType === 'group' && attachment.principalId === group.id,
              )
              .map((attachment) => policyNameById.get(attachment.policyId) ?? attachment.policyId);
            return (
              <article key={group.id} className="bg-background px-4 py-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <UsersRound className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{group.name}</h2>
                    <p className="mt-1 text-xs text-muted">{group.description || '説明なし'}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-border px-2.5 py-1">
                        Users {memberCount}
                      </span>
                      <span className="rounded-full border border-border px-2.5 py-1">
                        Policies {policyNames.length}
                      </span>
                    </div>
                    {policyNames.length > 0 ? (
                      <p className="mt-2 text-xs text-muted">{policyNames.join(', ')}</p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
          {inventory.groups.length === 0 ? (
            <div className="bg-background p-8 text-center text-sm text-muted">
              Groupはまだありません。
            </div>
          ) : null}
        </div>
      </section>

      <AccessGroupManager
        guildId={guildId}
        groups={inventory.groups.map((group) => ({
          id: group.id,
          name: group.name,
          description: group.description,
        }))}
        members={inventory.groupMembers.map((member) => ({
          groupId: member.groupId,
          userId: member.userId,
        }))}
        canEdit={authorization.access.isRoot}
      />
    </div>
  );
}

function Header({ guildId, guildName }: { guildId: string; guildName: string }) {
  return (
    <div>
      <Link href={`/dashboard/guilds/${guildId}/access`} className="text-sm text-muted hover:text-foreground">
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
        Groups一覧を閲覧する権限がないか、権限データを安全に確認できませんでした。
      </section>
    </div>
  );
}
