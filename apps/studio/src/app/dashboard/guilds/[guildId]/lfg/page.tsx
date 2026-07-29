import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MessageSquareWarning, Users } from 'lucide-react';
import {
  listLfgPosts,
  normalizeLfgConfig,
  type LfgPrismaClient,
} from '@herta/plugin-catalog/lfg-service';
import { auth } from '@/auth';
import { LfgManager, type LfgPostItem } from '@/components/lfg-manager';
import { prisma } from '@/lib/db';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LfgPage({
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

  const plugin = await getGuildPlugin(guildId, 'lfg');
  if (!plugin) notFound();
  const config = normalizeLfgConfig(plugin.config);

  let posts: LfgPostItem[] = [];
  let loadError: string | null = null;
  try {
    const rows = await listLfgPosts(prisma as unknown as LfgPrismaClient, {
      guildId,
      take: 100,
    });
    posts = rows.map((post) => ({
      id: post.id,
      creatorId: post.creatorId,
      channelId: post.channelId,
      messageId: post.messageId,
      game: post.game,
      title: post.title,
      description: post.description,
      maxPlayers: post.maxPlayers,
      participantCount: post.participantCount,
      startTime: post.startTime?.toISOString() ?? null,
      expiresAt: post.expiresAt.toISOString(),
      status: post.status,
      messageState: post.messageState,
      lastErrorName: post.lastErrorName,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error('LFG page failed to load', error);
    loadError = 'LFG募集を取得できませんでした。時間をおいて再読み込みしてください。';
  }

  const activeCount = posts.filter((post) => post.status === 'open' || post.status === 'full').length;
  const messageIssueCount = posts.filter(
    (post) => post.messageState === 'missing' || post.messageState === 'failed',
  ).length;

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/lfg`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> LFG Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">LFG募集管理</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            {guild.name} の募集、参加人数、Discordメッセージ、期限を管理します。
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-sm text-muted">
          募集中 {activeCount} / {config.maxOpenPostsPerGuild}件
        </span>
      </div>

      {!plugin.enabled ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          Pluginは現在無効です。設定と履歴は確認できますが、Discord投稿・Button操作・期限切れ処理は停止します。
        </div>
      ) : null}

      {messageIssueCount > 0 ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
          Discordメッセージの削除・投稿失敗が{messageIssueCount}件あります。Plugin有効時はWorkerが自動復旧します。
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <div className="mt-6">
          <LfgManager
            guildId={guildId}
            initialPosts={posts}
            pluginEnabled={plugin.enabled}
            maxPlayersLimit={config.maxPlayersLimit}
          />
        </div>
      )}
    </div>
  );
}
