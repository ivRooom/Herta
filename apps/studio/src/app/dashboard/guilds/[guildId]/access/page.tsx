import {
  listManagedStudioAccessPolicies,
  listStudioAccessGroupMembers,
  listStudioAccessGroups,
  listStudioAccessPolicyAttachments,
} from '@herta/db';
import Link from 'next/link';
import { ArrowLeft, Blocks, ShieldCheck, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { AccessGroupManager } from '@/components/access-group-manager';
import { ManagedPolicyManager } from '@/components/managed-policy-manager';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { prisma } from '@/lib/db';
import { authorizeStudioPermission } from '@/lib/studio-access';
import {
  STUDIO_ROOT_DISCORD_ROLE_ID,
  validateStudioAccessPolicy,
  type StudioAccessPolicy,
} from '@/lib/studio-access-policy';
import { listStudioRolePolicies } from '@/lib/studio-role-policy-store';

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
    `guild:${guildId}:access:*`,
  );
  if (!authorization.ok) {
    return <AccessUnavailable guildId={guildId} status={authorization.response.status} />;
  }

  const options = await getGuildConfigurationOptions(guildId);
  if (!options) return <AccessUnavailable guildId={guildId} status={503} />;

  const [storedPolicies, attachments, groups, members, legacyRolePolicies] = await Promise.all([
    listManagedStudioAccessPolicies(prisma, guildId),
    listStudioAccessPolicyAttachments(prisma, guildId),
    listStudioAccessGroups(prisma, guildId),
    listStudioAccessGroupMembers(prisma, guildId),
    listStudioRolePolicies(guildId),
  ]);

  const policies: Array<{
    id: string;
    name: string;
    description: string | null;
    policy: StudioAccessPolicy;
    revision: number;
    updatedAt: string;
  }> = [];
  let invalidPolicyCount = 0;
  for (const stored of storedPolicies) {
    const validation = validateStudioAccessPolicy(stored.document, guildId);
    if (!validation.valid || !validation.policy) {
      invalidPolicyCount += 1;
      continue;
    }
    policies.push({
      id: stored.id,
      name: stored.name,
      description: stored.description,
      policy: validation.policy,
      revision: stored.revision,
      updatedAt: stored.updatedAt.toISOString(),
    });
  }

  const roleOptions = options.roles
    .filter((role) => role.id !== STUDIO_ROOT_DISCORD_ROLE_ID)
    .map((role) => ({ id: role.id, name: role.name }));
  const groupOptions = groups.map((group) => ({ id: group.id, name: group.name }));
  const directUserIds = new Set(
    attachments
      .filter((attachment) => attachment.principalType === 'user')
      .map((attachment) => attachment.principalId),
  );
  for (const member of members) directUserIds.add(member.userId);

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
              {options.guildName} · Herta IAM
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Access Control Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Policyを独立した権限リソースとして作成し、Discord Role・User・Herta
              GroupへAttachします。RoleごとのJSON複製ではなく、1つのPolicyを複数Principalから再利用できます。
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Policies" value={storedPolicies.length} />
        <SummaryCard label="Groups" value={groups.length} />
        <SummaryCard label="Roles" value={roleOptions.length} />
        <SummaryCard label="Users" value={directUserIds.size} />
      </div>

      {legacyRolePolicies.length > 0 ? (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
          <div className="flex gap-3">
            <Blocks className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold">Legacy Role Policy互換モード</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                既存のRole Policyが{legacyRolePolicies.length}
                件あります。既存ユーザーの権限を壊さないため認可時のみ読み取り継続します。新しい権限設定はManaged
                Policyを使用してください。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {invalidPolicyCount > 0 ? (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 sm:p-5" role="alert">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
            無効なManaged Policyを検出しました
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            {invalidPolicyCount}
            件のPolicy documentが現在のPolicy schemaまたはGuild scopeを満たしていません。認可resolverも安全側に倒して拒否します。
          </p>
        </section>
      ) : null}

      <ManagedPolicyManager
        guildId={guildId}
        policies={policies}
        attachments={attachments.map((attachment) => ({
          policyId: attachment.policyId,
          principalType: attachment.principalType,
          principalId: attachment.principalId,
        }))}
        roles={roleOptions}
        groups={groupOptions}
        canEdit={authorization.access.isRoot}
      />

      <AccessGroupManager
        guildId={guildId}
        groups={groups.map((group) => ({
          id: group.id,
          name: group.name,
          description: group.description,
        }))}
        members={members.map((member) => ({ groupId: member.groupId, userId: member.userId }))}
        canEdit={authorization.access.isRoot}
      />

      {!authorization.access.isRoot ? (
        <section className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
          <Users className="mr-2 inline h-4 w-4" aria-hidden="true" />
          閲覧モードです。Policy・Group・Attachmentの変更にはOWNER root Roleが必要です。
        </section>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </section>
  );
}

function AccessUnavailable({ guildId, status }: { guildId: string; status: number }) {
  const message =
    status === 403
      ? 'Access Control Centerを閲覧する権限がありません。OWNER rootまたは許可されたPolicyが必要です。'
      : 'Discordまたは権限データを確認できませんでした。安全のためAccess Controlを拒否しています。';
  return (
    <div className="space-y-6">
      <Link href={`/dashboard/guilds/${guildId}`} className="text-sm text-muted hover:text-foreground">
        ← サーバー概要へ戻る
      </Link>
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h1 className="text-xl font-semibold">Access Control Centerを開けません</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
      </section>
    </div>
  );
}
