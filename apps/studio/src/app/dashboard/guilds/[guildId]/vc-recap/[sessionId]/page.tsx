import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarDays, Clock, MessageSquareText, Mic, Tag } from 'lucide-react';
import { auth } from '@/auth';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { withStudioPagePermission } from '@/components/studio-page-permission-boundary';
import { prisma } from '@/lib/db';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { hasStudioPermission, resolveStudioAccess } from '@/lib/studio-access';
import { studioVcRecapExportResource } from '@/lib/studio-policy-resources';
import { formatVcRecapDuration, getVcRecapSessionDetailForStudio } from '@/lib/vc-recap-studio';
import { VcRecapTranscriptChat } from './vc-recap-transcript-chat';

export const dynamic = 'force-dynamic';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

async function VcRecapSessionPage({
  params,
}: {
  params: Promise<{ guildId: string; sessionId: string }>;
}) {
  const { guildId, sessionId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();

  if (!accessToken) {
    return (
      <div>
        <BackLink guildId={guildId} />
        <div className="mt-6">
          <ReconnectNotice />
        </div>
      </div>
    );
  }

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild || !session?.user || !SESSION_ID.test(sessionId)) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const detail = await getVcRecapSessionDetailForStudio(prisma, guildId, sessionId);
  if (!detail) notFound();
  const { session: recap, transcript, transcriptExpiresAt } = detail;
  const duration = formatVcRecapDuration(recap.startedAt, recap.endedAt);
  const exportAccess = await resolveStudioAccess(guildId, session.user.id);
  const canExport = exportAccess.ok && hasStudioPermission(exportAccess.access, 'studio.operation.execute', studioVcRecapExportResource(guildId));

  return (
    <div>
      <BackLink guildId={guildId} />

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium">
            <Mic className="h-3 w-3" aria-hidden="true" />
            {recap.channelName}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {formatDateTime(recap.startedAt)}
            {recap.endedAt ? ` 〜 ${formatTime(recap.endedAt)}` : ''}
          </span>
          {duration ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {duration}
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">VC Recapの詳細</h1>
        {canExport && transcript.length > 0 ? (
          <nav aria-label="セッション本文の出力" className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/api/guilds/${guildId}/vc-recap/export?format=json&sessionIds=${sessionId}`}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:border-primary"
            >
              JSONを出力
            </a>
            <a
              href={`/api/guilds/${guildId}/vc-recap/export?format=csv&sessionIds=${sessionId}`}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:border-primary"
            >
              CSVを出力
            </a>
          </nav>
        ) : null}
      </header>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h2 className="font-medium">要約</h2>
        <p className="mt-3 text-sm leading-relaxed">{recap.summary ?? '要約はありません。'}</p>
        {recap.topics.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {recap.topics.map((topic) => (
              <span
                key={topic}
                className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                <Tag className="h-3 w-3" aria-hidden="true" />
                {topic}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="flex items-center gap-2 font-medium">
            <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
            文字起こし
            <span className="text-sm font-normal text-muted">{transcript.length}件</span>
          </h2>
          {transcriptExpiresAt && transcript.length > 0 ? (
            <p className="text-xs text-muted">{formatDateTime(transcriptExpiresAt)}に自動削除</p>
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          本文の保存に同意したメンバーの発言だけを、セッション終了から30日間表示します。
          未同意のメンバーや本文の保存に同意していないメンバーの発言は残りません。
        </p>
        {transcript.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
            保存されている文字起こしはありません。
          </p>
        ) : (
          <div className="mt-5">
            <VcRecapTranscriptChat
              messages={transcript.map((entry) => ({
                segmentId: entry.segmentId,
                speaker: entry.speaker,
                text: entry.text,
                startedAt: entry.startedAt.toISOString(),
                endedAt: entry.endedAt.toISOString(),
              }))}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function BackLink({ guildId }: { guildId: string }) {
  return (
    <Link
      href={`/dashboard/guilds/${guildId}/vc-recap`}
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      VC Recap一覧へ戻る
    </Link>
  );
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(value);
}

function formatTime(value: Date, withSeconds = false): string {
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    timeZone: 'Asia/Tokyo',
  }).format(value);
}

export default withStudioPagePermission(VcRecapSessionPage, 'vc-recap');
