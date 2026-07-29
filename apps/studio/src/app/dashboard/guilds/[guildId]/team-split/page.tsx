import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MessageSquareWarning, Shuffle } from 'lucide-react';
import {
  listTeamSplitSessions,
  normalizeTeamSplitConfig,
  type TeamSplitPrismaClient,
} from '@herta/plugin-catalog/team-split-service';
import { auth } from '@/auth';
import { TeamSplitManager, type TeamSplitSessionItem } from '@/components/team-split-manager';
import { prisma } from '@/lib/db';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function TeamSplitPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const plugin = await getGuildPlugin(guildId, 'team-split');
  if (!plugin) notFound();
  const config = normalizeTeamSplitConfig(plugin.config);

  let sessions: TeamSplitSessionItem[] = [];
  let loadError: string | null = null;
  try {
    const rows = await listTeamSplitSessions(prisma as unknown as TeamSplitPrismaClient, {
      guildId,
      take: 100,
    });
    sessions = rows.map((row) => ({
      id: row.id,
      creatorId: row.creatorId,
      channelId: row.channelId,
      messageId: row.messageId,
      title: row.title,
      teamCount: row.teamCount,
      mode: row.mode,
      maxParticipants: row.maxParticipants,
      participantCount: row.participantCount,
      generation: row.generation,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      splitAt: row.splitAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      messageState: row.messageState,
      lastErrorName: row.lastErrorName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error(
      'Team Split page failed to load',
      error instanceof Error ? error.name : 'UnknownError',
    );
    loadError = 'Team Splitセッションを取得できませんでした。時間をおいて再読み込みしてください。';
  }

  const activeCount = sessions.filter(
    (item) => item.status === 'open' || item.status === 'split',
  ).length;
  const messageIssueCount = sessions.filter(
    (item) => item.messageState === 'missing' || item.messageState === 'failed',
  ).length;

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/team-split`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Team Split Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shuffle className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Team Split管理</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            {guild.name} の参加受付、score、分割結果、再抽選、Discordメッセージを管理します。
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-sm text-muted">
          進行中 {activeCount} / {config.maxOpenSessionsPerGuild}件
        </span>
      </div>

      {!plugin.enabled ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          Pluginは現在無効です。履歴は確認できますが、Discord操作・期限切れ・表示同期・復旧は停止します。
        </div>
      ) : null}

      {messageIssueCount > 0 ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
          Discordメッセージの削除・投稿失敗が{messageIssueCount}
          件あります。Plugin有効時はWorkerが自動復旧します。
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <div className="mt-6">
          <TeamSplitManager
            guildId={guildId}
            initialSessions={sessions}
            pluginEnabled={plugin.enabled}
            maxParticipantsLimit={config.maxParticipantsLimit}
            maxTeamCount={config.maxTeamCount}
          />
        </div>
      )}
    </div>
  );
}
