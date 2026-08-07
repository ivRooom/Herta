import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Ban } from 'lucide-react';
import {
  listModerationBlacklistEntries,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { ModerationBlacklistToggle } from '@/components/moderation-blacklist-toggle';
import { prisma } from '@/lib/db';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

export default async function ModerationBlacklistPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { guildId } = await params;
  const query = await searchParams;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);
  const plugin = await getGuildPlugin(guildId, 'moderation');
  if (!plugin) notFound();

  const includeInactive = query.all === '1';
  let loadError: string | null = null;
  let entries: Awaited<ReturnType<typeof listModerationBlacklistEntries>> = [];
  try {
    entries = await listModerationBlacklistEntries(
      prisma as unknown as ModerationPrismaClient,
      guildId,
      { includeInactive, limit: 500 },
    );
  } catch (error) {
    console.error('Moderation blacklist page failed to load', error);
    loadError = 'ブラックリストを取得できませんでした。';
  }

  return (
    <div className="min-w-0">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/moderation`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Moderation Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Ban className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">ブラックリスト管理</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Hertaの永久排除対象を確認・解除します。activeなユーザーは再参加を検知すると自動BANされます。
          </p>
        </div>
        <Link
          href={
            includeInactive
              ? `/dashboard/guilds/${guildId}/moderation/blacklist`
              : `/dashboard/guilds/${guildId}/moderation/blacklist?all=1`
          }
          className="rounded-xl border border-border px-4 py-2 text-center text-sm font-medium hover:bg-surface"
        >
          {includeInactive ? '有効のみ表示' : '解除済みも表示'}
        </Link>
      </div>

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError}
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
          {includeInactive ? 'ブラックリスト登録はありません。' : '有効なブラックリスト登録はありません。'}
        </div>
      ) : (
        <div className="mt-6 grid gap-4">
          {entries.map((entry) => (
            <article
              key={entry.userId}
              className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-card"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm break-all">{entry.userId}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        entry.active
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-background text-muted'
                      }`}
                    >
                      {entry.active ? '有効' : '解除済み'}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {entry.reason ?? '理由は記録されていません。'}
                  </p>
                  <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
                    <div>
                      <dt>登録者</dt>
                      <dd className="mt-0.5 break-all font-mono">{entry.createdBy}</dd>
                    </div>
                    <div>
                      <dt>更新日時</dt>
                      <dd className="mt-0.5">{formatDate(entry.updatedAt)}</dd>
                    </div>
                    {entry.originDetectionId ? (
                      <div className="sm:col-span-2">
                        <dt>元検知</dt>
                        <dd className="mt-0.5">
                          <Link
                            href={`/dashboard/guilds/${guildId}/moderation/detections?detectionId=${encodeURIComponent(
                              entry.originDetectionId,
                            )}#detection-${encodeURIComponent(entry.originDetectionId)}`}
                            className="break-all font-mono text-primary hover:underline"
                          >
                            {entry.originDetectionId}
                          </Link>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                <ModerationBlacklistToggle
                  guildId={guildId}
                  userId={entry.userId}
                  initialActive={entry.active}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(value);
}
