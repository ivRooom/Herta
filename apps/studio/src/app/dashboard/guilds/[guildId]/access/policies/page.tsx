import Link from 'next/link';
import { FileKey2 } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { AccessResourceNavigation } from '@/components/access-resource-navigation';
import { GranularPolicyEditor } from '@/components/granular-policy-editor';
import { ManagedPolicyManager } from '@/components/managed-policy-manager';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { loadStudioAccessInventory } from '@/lib/studio-access-inventory';
import {
  buildStudioGranularPermissionOptions,
  studioAccessPageResource,
} from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

export default async function AccessPoliciesPage({
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
    studioAccessPageResource(guildId, 'policies'),
  );
  if (!authorization.ok) return <AccessDenied guildId={guildId} />;

  const inventory = await loadStudioAccessInventory(guildId);
  if (!inventory) return <AccessDenied guildId={guildId} />;
  const granularOptions = buildStudioGranularPermissionOptions(guildId, inventory.plugins);

  return (
    <div className="space-y-6">
      <Header guildId={guildId} guildName={inventory.guildName} />
      <AccessResourceNavigation
        guildId={guildId}
        active="policies"
        counts={{
          users: inventory.users.length,
          groups: inventory.groups.length,
          roles: inventory.roles.length,
          policies: inventory.policies.length,
        }}
      />

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          IAM / Policies
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Policies</h1>
        <p className="mt-1 text-sm leading-6 text-muted">
          Managed Policyを一覧し、User・Group・Discord RoleへAttachします。Policy
          documentはページ・設定項目・操作のResourceまで細かく指定できます。
        </p>
        <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {inventory.policies.map((policy) => {
            const attachmentCount = inventory.attachments.filter(
              (attachment) => attachment.policyId === policy.id,
            ).length;
            return (
              <article key={policy.id} className="flex items-start gap-3 bg-background px-4 py-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileKey2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{policy.name}</h2>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                      rev.{policy.revision}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{policy.description || '説明なし'}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-border px-2.5 py-1">
                      Statements {policy.policy.Statement.length}
                    </span>
                    <span className="rounded-full border border-border px-2.5 py-1">
                      Attachments {attachmentCount}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
          {inventory.policies.length === 0 ? (
            <div className="bg-background p-8 text-center text-sm text-muted">
              Managed Policyはまだありません。下のPolicy Managerから作成できます。
            </div>
          ) : null}
        </div>
        {inventory.invalidPolicyCount > 0 ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            無効なPolicy documentが{inventory.invalidPolicyCount}
            件あり、一覧・認可から安全側に除外されています。
          </p>
        ) : null}
      </section>

      <GranularPolicyEditor
        guildId={guildId}
        policies={inventory.policies}
        options={granularOptions}
        canEdit={authorization.access.isRoot}
      />

      <ManagedPolicyManager
        guildId={guildId}
        policies={inventory.policies}
        attachments={inventory.attachments.map((attachment) => ({
          policyId: attachment.policyId,
          principalType: attachment.principalType,
          principalId: attachment.principalId,
        }))}
        roles={inventory.roleOptions}
        groups={inventory.groups.map((group) => ({ id: group.id, name: group.name }))}
        canEdit={authorization.access.isRoot}
      />
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
        Policies一覧を閲覧する権限がないか、権限データを安全に確認できませんでした。
      </section>
    </div>
  );
}
