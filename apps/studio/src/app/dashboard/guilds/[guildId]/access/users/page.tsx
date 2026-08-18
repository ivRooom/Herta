import Link from 'next/link';
import { Search, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { AccessResourceNavigation } from '@/components/access-resource-navigation';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { loadStudioAccessInventory } from '@/lib/studio-access-inventory';
import { studioAccessPageResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AccessUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) notFound();
  const [{ guildId }, queryParams] = await Promise.all([params, searchParams]);
  const authorization = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.roles.read',
    studioAccessPageResource(guildId, 'users'),
  );
  if (!authorization.ok) return <AccessDenied guildId={guildId} />;

  const inventory = await loadStudioAccessInventory(guildId);
  if (!inventory) return <AccessDenied guildId={guildId} />;

  const query = singleQuery(queryParams.q).toLocaleLowerCase('ja');
  const policyNameById = new Map(inventory.policies.map((policy) => [policy.id, policy.name]));
  const groupNameById = new Map(inventory.groups.map((group) => [group.id, group.name]));
  const filteredUsers = inventory.users.filter((user) => {
    if (!query) return true;
    return [user.id, user.username ?? '', user.nickname ?? ''].some((value) =>
      value.toLocaleLowerCase('ja').includes(query),
    );
  });

  return (
    <div className="space-y-6">
      <Header guildId={guildId} guildName={inventory.guildName} />
      <AccessResourceNavigation
        guildId={guildId}
        active="users"
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
              IAM / Users
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Users</h1>
            <p className="mt-1 text-sm text-muted">
              Direct PolicyまたはHerta Group membershipを持つDiscord Userを一覧表示します。
            </p>
          </div>
          <form className="relative w-full sm:max-w-sm" action="" method="get">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              name="q"
              defaultValue={singleQuery(queryParams.q)}
              placeholder="User名 / Discord ID"
              aria-label="Usersを検索"
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
        </div>

        <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {filteredUsers.map((user) => {
            const directPolicyIds = inventory.attachments
              .filter(
                (attachment) =>
                  attachment.principalType === 'user' && attachment.principalId === user.id,
              )
              .map((attachment) => attachment.policyId);
            const groupIds = inventory.groupMembers
              .filter((member) => member.userId === user.id)
              .map((member) => member.groupId);
            const groupPolicyIds = inventory.attachments
              .filter(
                (attachment) =>
                  attachment.principalType === 'group' && groupIds.includes(attachment.principalId),
              )
              .map((attachment) => attachment.policyId);
            const rolePolicyIds = inventory.attachments
              .filter(
                (attachment) =>
                  attachment.principalType === 'role' &&
                  user.roleIds.includes(attachment.principalId),
              )
              .map((attachment) => attachment.policyId);
            const effectivePolicyIds = [
              ...new Set([...directPolicyIds, ...groupPolicyIds, ...rolePolicyIds]),
            ];
            const displayName = user.nickname || user.username || user.id;
            return (
              <article key={user.id} className="bg-background px-4 py-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserRound className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-semibold">{displayName}</h2>
                    {user.nickname && user.username ? (
                      <p className="text-xs text-muted">@{user.username}</p>
                    ) : null}
                    <code className="mt-1 block break-all text-[11px] text-muted">{user.id}</code>
                    <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                      <Info
                        label="Direct policies"
                        value={policyNames(directPolicyIds, policyNameById)}
                      />
                      <Info label="Groups" value={groupNames(groupIds, groupNameById)} />
                      <Info
                        label="Effective managed policies"
                        value={policyNames(effectivePolicyIds, policyNameById)}
                      />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {filteredUsers.length === 0 ? (
            <div className="bg-background p-8 text-center">
              <p className="font-medium">一致するUserがありません</p>
              <p className="mt-1 text-sm text-muted">
                PolicyをUserへ直接Attachするか、Groupへ追加するとここに表示されます。
              </p>
            </div>
          ) : null}
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
        className="text-sm text-muted transition-colors hover:text-foreground"
      >
        ← Access Controlへ戻る
      </Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {guildName} · Herta IAM
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="mt-1 break-words text-foreground">{value}</p>
    </div>
  );
}

function policyNames(ids: readonly string[], names: ReadonlyMap<string, string>): string {
  const values = [...new Set(ids)].map((id) => names.get(id) ?? id);
  return values.length > 0 ? values.join(', ') : 'なし';
}

function groupNames(ids: readonly string[], names: ReadonlyMap<string, string>): string {
  const values = [...new Set(ids)].map((id) => names.get(id) ?? id);
  return values.length > 0 ? values.join(', ') : 'なし';
}

function singleQuery(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

function AccessDenied({ guildId }: { guildId: string }) {
  return (
    <div className="space-y-4">
      <Link href={`/dashboard/guilds/${guildId}/access`} className="text-sm text-muted">
        ← Access Controlへ戻る
      </Link>
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5" role="alert">
        Users一覧を閲覧する権限がないか、権限データを安全に確認できませんでした。
      </section>
    </div>
  );
}
