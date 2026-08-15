import Link from 'next/link';
import { ArrowLeft, Bot, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { BotProfileSettings } from '@/components/bot-profile-settings';
import { getManageableGuild } from '@/lib/guilds';
import { prisma } from '@/lib/db';
import { getDiscordAccessToken } from '@/lib/session';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export default async function BotProfilePage({ params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  const { guildId } = await params;

  if (!accessToken || !session?.user) {
    return (
      <div className="space-y-6">
        <PageHeader guildId={guildId} guildName="Botプロフィール" />
        <ReconnectNotice />
      </div>
    );
  }

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });

  return (
    <div className="space-y-7">
      <PageHeader guildId={guildId} guildName={guild.name} />

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">設定範囲を分離しています</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              NicknameとAvatarはこのサーバーだけに反映されます。Online / Idle /
              DNDやActivityはDiscord Gateway上のBot全体設定なので、Herta管理者だけが変更できます。
            </p>
          </div>
        </div>
      </section>

      <BotProfileSettings
        guildId={guildId}
        guildName={guild.name}
        canManageGlobalPresence={currentUser?.isAdmin ?? false}
      />
    </div>
  );
}

function PageHeader({ guildId, guildName }: { guildId: string; guildName: string }) {
  return (
    <>
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
            <Bot className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              {guildName}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Botプロフィール
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Discord上で見えるHertaのプロフィールとPresenceをStudioから安全に管理します。
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
