import Link from 'next/link';
import { ArrowLeft, Workflow } from 'lucide-react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { RuleStudioManager } from '@/components/rule-studio-manager';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import { prisma } from '@/lib/db';
import { parseStoredRuleStudioView } from '@/lib/rule-studio';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@/lib/studio-access-policy';

export const dynamic = 'force-dynamic';

export default async function GuildRuleStudioPage({
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
    `guild:${guildId}:rule:*`,
  );
  if (!authorization.ok) {
    return <AccessUnavailable guildId={guildId} status={authorization.response.status} />;
  }

  const [records, options] = await Promise.all([
    prisma.rule.findMany({
      where: { guildId },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    }),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!options) return <AccessUnavailable guildId={guildId} status={503} />;

  const rules = records.map(parseStoredRuleStudioView).filter((rule) => rule !== null);
  const editableRoleOptions = options.roles
    .filter((role) => role.id !== STUDIO_ROOT_DISCORD_ROLE_ID && !role.managed && role.editable)
    .map((role) => ({ id: role.id, name: role.name }));

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
            <Workflow className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              {options.guildName} · Automation
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Rule Studio</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Schedule / Member joined TriggerからDiscord Role Actionを実行するproduction
              Ruleを管理します。Runtime側のroot再認証・idempotency・Role hierarchy・Guild
              boundary検証は保存後も継続します。
            </p>
          </div>
        </div>
      </section>

      <RuleStudioManager
        guildId={guildId}
        rules={rules}
        editableRoleOptions={editableRoleOptions}
        canEdit={authorization.access.isRoot}
        unsupportedCount={records.length - rules.length}
      />
    </div>
  );
}

function AccessUnavailable({ guildId, status }: { guildId: string; status: number }) {
  const message =
    status === 403
      ? 'Rule Studioを閲覧する権限がありません。OWNER rootまたは許可されたPolicyが必要です。'
      : 'DiscordまたはGuild状態を確認できませんでした。安全側に倒してRule Studioを停止しています。';
  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← サーバー概要へ戻る
      </Link>
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h1 className="text-xl font-semibold">Rule Studioを開けません</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
      </section>
    </div>
  );
}
