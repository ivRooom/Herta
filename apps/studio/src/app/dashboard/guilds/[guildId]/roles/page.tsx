import Link from 'next/link';
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { RolePolicyManager } from '@/components/role-policy-manager';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';
import { listStudioRolePolicies } from '@/lib/studio-role-policy-store';

export const dynamic = 'force-dynamic';

export default async function GuildRoleManagerPage({
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
  if (!authorization.ok) {
    return <AccessUnavailable guildId={guildId} status={authorization.response.status} />;
  }

  const options = await getGuildConfigurationOptions(guildId);
  if (!options) return <AccessUnavailable guildId={guildId} status={503} />;
  const policies = await listStudioRolePolicies(guildId);

  return (
    <div className="space-y-7">
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> サーバー概要へ戻る
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              {options.guildName}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Role Manager</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Discord RoleごとにHerta
              Studioの閲覧・編集・作成・削除・Command・AI・Secret・RAG・MCP権限を管理します。GUIとIAM風JSONの両方で設定できます。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
        <div className="flex gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">root security boundary</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Discord Role <code>{STUDIO_ROOT_DISCORD_ROLE_ID}</code>{' '}
              はrootとして固定され、Policyから変更・削除できません。v1ではPolicy変更もrootだけが実行できます。
            </p>
          </div>
        </div>
      </section>

      <Link
        href={`/dashboard/guilds/${guildId}/roles/plugins`}
        className="flex items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5 transition hover:border-primary/40 hover:bg-primary/10"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">Plugin Permission Matrix</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Pluginごとの有効・無効操作と、設定項目単位の「閲覧のみ / 編集可」をRoleごとに指定します。
            </p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
      </Link>

      <RolePolicyManager
        guildId={guildId}
        roles={options.roles.map((role) => ({ id: role.id, name: role.name, color: role.color }))}
        policies={policies}
        rootRoleId={STUDIO_ROOT_DISCORD_ROLE_ID}
        canEdit={authorization.access.isRoot}
      />
    </div>
  );
}

function AccessUnavailable({ guildId, status }: { guildId: string; status: number }) {
  const message =
    status === 403
      ? 'このページを閲覧するRole Policyがありません。初期設定はOWNER root Roleを持つメンバーが行ってください。'
      : 'Discord RoleまたはBot接続状態を確認できませんでした。権限判定は安全側に倒して拒否されています。';
  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← サーバー概要へ戻る
      </Link>
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h1 className="text-xl font-semibold">Role Managerを開けません</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
      </section>
    </div>
  );
}
