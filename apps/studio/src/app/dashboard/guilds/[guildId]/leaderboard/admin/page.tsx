import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldAlert, Trophy } from 'lucide-react';
import { auth } from '@/auth';
import { LeaderboardXpAdmin } from '@/components/leaderboard-xp-admin';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { getXpAdminGuildSummary } from '@/lib/xp-admin';

export const dynamic = 'force-dynamic';

export default async function LeaderboardAdminPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const summary = await getXpAdminGuildSummary(guildId);

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}/leaderboard`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Leaderboardへ戻る
      </Link>

      <section className="rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              <Trophy className="h-3.5 w-3.5" /> Leaderboard v2
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              XP Operations
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {guild.name} のXPを管理します。変更は即時反映され、すべてAudit Logへ記録されます。
            </p>
          </div>
        </div>
      </section>

      <LeaderboardXpAdmin guildId={guildId} initialSummary={summary} />
    </div>
  );
}
