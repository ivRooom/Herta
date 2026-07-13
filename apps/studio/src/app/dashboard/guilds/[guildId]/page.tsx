import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plug, ShieldCheck } from 'lucide-react';
import { auth } from '@/auth';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { GuildAvatar } from '@/components/guild-avatar';
import { ReconnectNotice } from '@/components/reconnect-notice';

export const dynamic = 'force-dynamic';

export default async function GuildDetailPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();

  if (!accessToken) {
    return (
      <div>
        <BackLink />
        <div className="mt-6">
          <ReconnectNotice />
        </div>
      </div>
    );
  }

  // 管理権限が無い Guild は 404 として扱い、アクセスを防ぐ
  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild || !session?.user) {
    notFound();
  }

  // 選択された Guild とメンバーシップを DB へ保存
  await persistSelectedGuild(guild, session.user.id);

  return (
    <div>
      <BackLink />

      <div className="mt-6 flex items-center gap-4">
        <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={64} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{guild.name}</h1>
          <p className="mt-1 text-sm text-muted">サーバー ID: {guild.id}</p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-medium">あなたの権限</h2>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            <PermissionRow label="オーナー" active={guild.owner} />
            <PermissionRow label="管理者 (Administrator)" active={guild.hasAdministrator} />
            <PermissionRow label="サーバー管理 (Manage Guild)" active={guild.hasManageGuild} />
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <h2 className="font-medium">概要</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            このサーバーは Herta の管理対象として選択されました。
            今後、プラグインやモデレーション設定をここから構成できるようになります。
          </p>
        </section>
      </div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins`}
        className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-surface p-6 shadow-card transition-colors hover:border-primary/40"
      >
        <Plug className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-medium">Plugin Manager</h2>
          <p className="mt-1 text-sm text-muted">この Guild の Plugin を有効化・設定する</p>
        </div>
      </Link>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/guilds"
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      サーバー一覧へ戻る
    </Link>
  );
}

function PermissionRow({ label, active }: { label: string; active: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span
        className={
          active
            ? 'rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
            : 'rounded-md bg-border/50 px-2 py-0.5 text-xs font-medium text-muted'
        }
      >
        {active ? 'あり' : 'なし'}
      </span>
    </li>
  );
}
