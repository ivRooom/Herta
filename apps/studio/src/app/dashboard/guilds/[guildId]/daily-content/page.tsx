import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarClock, CheckCircle2, History, TriangleAlert } from 'lucide-react';
import {
  listDailyContents,
  listDeliveryHistory,
  normalizeDailyContentConfig,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import {
  DailyContentManager,
  type DailyContentDeliveryItem,
  type DailyContentScheduleItem,
} from '@/components/daily-content-manager';
import { prisma } from '@/lib/db';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function DailyContentPage({
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

  const plugin = await getGuildPlugin(guildId, 'daily-content');
  if (!plugin) notFound();
  const config = normalizeDailyContentConfig(plugin.config);

  let schedules: DailyContentScheduleItem[] = [];
  let deliveries: DailyContentDeliveryItem[] = [];
  let loadError: string | null = null;
  try {
    const [scheduleRows, deliveryRows] = await Promise.all([
      listDailyContents(prisma as unknown as DailyContentPrismaClient, guildId),
      listDeliveryHistory(prisma as unknown as DailyContentPrismaClient, guildId, 50),
    ]);
    schedules = scheduleRows.map((schedule) => ({
      id: schedule.id,
      channelId: schedule.channelId,
      title: schedule.title,
      content: schedule.content,
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      lastSentAt: schedule.lastSentAt?.toISOString() ?? null,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    }));
    deliveries = deliveryRows.map((delivery) => ({
      id: delivery.id,
      dailyContentId: delivery.dailyContentId,
      origin: delivery.origin,
      scheduledFor: delivery.scheduledFor.toISOString(),
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      messageId: delivery.messageId,
      errorName: delivery.errorName,
      sentAt: delivery.sentAt?.toISOString() ?? null,
      failedAt: delivery.failedAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Daily Content page failed to load', error);
    loadError = 'Daily Contentを取得できませんでした。時間をおいて再読み込みしてください。';
  }

  const sentCount = deliveries.filter((delivery) => delivery.status === 'sent').length;
  const failedCount = deliveries.filter(
    (delivery) => delivery.status === 'failed' || delivery.status === 'skipped',
  ).length;

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/daily-content`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Daily Content Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Daily Content</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            {guild.name} の定時コンテンツ、次回配信、履歴、失敗再実行を管理します。
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-sm text-muted">
          {schedules.length} / {config.maxSchedules}件
        </span>
      </div>

      {!plugin.enabled ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          Pluginは現在無効です。設定は編集できますが、定時・手動配信はWorkerでスキップされます。
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Metric
          icon={<CalendarClock className="h-5 w-5" />}
          label="スケジュール"
          value={schedules.length}
        />
        <Metric icon={<CheckCircle2 className="h-5 w-5" />} label="直近の成功" value={sentCount} />
        <Metric
          icon={<TriangleAlert className="h-5 w-5" />}
          label="再確認が必要"
          value={failedCount}
        />
      </div>

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <div className="mt-6">
          <DailyContentManager
            guildId={guildId}
            initialSchedules={schedules}
            initialDeliveries={deliveries}
            defaultTimezone={config.defaultTimezone}
            maxContentLength={config.maxContentLength}
            pluginEnabled={plugin.enabled}
          />
        </div>
      )}

      <div className="mt-8 flex items-center gap-2 text-xs text-muted">
        <History className="h-4 w-4" />{' '}
        配信履歴は本文を保持せず、状態・予定日時・試行回数・安全なエラー名だけを表示します。
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}
