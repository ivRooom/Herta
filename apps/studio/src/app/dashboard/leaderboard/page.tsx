import Link from 'next/link';
import { ArrowRight, Medal, ServerCog, Trophy } from 'lucide-react';
import { redirect } from 'next/navigation';
import { GuildAvatar } from '@/components/guild-avatar';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LeaderboardLandingPage() {
  const accessToken = await getDiscordAccessToken();
  if (!accessToken) redirect('/login');

  const guilds = await getManageableGuilds(accessToken);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Community Leaderboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              XP、Level、発言、Reaction、VC、Minecraft、Achievement、Season
              Pointをサーバーごとに比較できます。
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">サーバーを選択</h2>
            <p className="mt-1 text-sm text-muted">
              管理権限を持つDiscordサーバーを表示しています。
            </p>
          </div>
          <span className="text-sm text-muted">{guilds.length.toLocaleString()} servers</span>
        </div>

        {guilds.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <ServerCog className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 font-medium">管理可能なサーバーがありません</p>
            <p className="mt-1 text-sm text-muted">
              Discordでサーバー管理権限を確認してください。
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {guilds.map((guild) => (
              <Link
                key={guild.id}
                href={`/dashboard/guilds/${guild.id}/leaderboard`}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
              >
                <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{guild.name}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <Medal className="h-3.5 w-3.5" />
                    ランキングを表示
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
