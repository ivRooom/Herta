import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Layers3,
  MessageSquareText,
} from 'lucide-react';
import {
  listDailyContents,
  nextContentOccurrence,
  normalizeDailyContentConfig,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { getGuildConfigurationOptions } from '@/lib/bot-guild-options';
import {
  buildMessageStudioCalendarDays,
  buildMessageStudioCalendarEntries,
  firstWeekdayOfMessageStudioCalendarMonth,
  messageStudioCalendarScanRange,
  parseMessageStudioCalendarMonth,
  shiftMessageStudioCalendarMonth,
  type MessageStudioCalendarOccurrence,
} from '@/lib/message-studio-calendar';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const MAX_OCCURRENCES_PER_SCHEDULE = 100;

export default async function MessageStudioCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ guildId }, query] = await Promise.all([params, searchParams]);
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const [plugin, discordOptions] = await Promise.all([
    getGuildPlugin(guildId, 'daily-content'),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!plugin) notFound();
  const config = normalizeDailyContentConfig(plugin.config);
  const calendarMonth = parseMessageStudioCalendarMonth(
    typeof query.month === 'string' ? query.month : null,
    new Date(),
    config.defaultTimezone,
  );
  const previousMonth = shiftMessageStudioCalendarMonth(calendarMonth, -1);
  const nextMonth = shiftMessageStudioCalendarMonth(calendarMonth, 1);

  let occurrences: MessageStudioCalendarOccurrence[] = [];
  let enabledScheduleCount = 0;
  let loadError: string | null = null;
  try {
    const schedules = await listDailyContents(
      prisma as unknown as DailyContentPrismaClient,
      guildId,
    );
    enabledScheduleCount = schedules.filter((schedule) => schedule.enabled).length;
    const scanRange = messageStudioCalendarScanRange(calendarMonth);
    for (const schedule of schedules) {
      if (!schedule.enabled || schedule.deletedAt) continue;
      let after = new Date(scanRange.start.getTime() - 1);
      for (let index = 0; index < MAX_OCCURRENCES_PER_SCHEDULE; index += 1) {
        const next = nextContentOccurrence({
          recurrenceType: schedule.recurrenceType,
          onceAt: schedule.onceAt,
          weekdays: schedule.weekdays,
          scheduleTime: schedule.scheduleTime,
          timezone: schedule.timezone,
          after,
        });
        if (!next || next >= scanRange.end) break;
        if (next >= scanRange.start) {
          occurrences.push({
            scheduleId: schedule.id,
            channelId: schedule.channelId,
            title: schedule.title,
            scheduledAt: next,
            scheduleTimezone: schedule.timezone,
            recurrenceType: schedule.recurrenceType,
            messageFormat: schedule.messageFormat,
            publishAnnouncement: schedule.publishAnnouncement,
          });
        }
        after = new Date(next.getTime() + 1);
        if (schedule.recurrenceType === 'once') break;
      }
    }
  } catch (error) {
    console.error('Message Studio calendar failed to load', error);
    loadError = '投稿カレンダーを取得できませんでした。時間をおいて再読み込みしてください。';
  }

  const entries = buildMessageStudioCalendarEntries(
    occurrences,
    calendarMonth,
    config.defaultTimezone,
  );
  const calendarDays = buildMessageStudioCalendarDays(calendarMonth);
  const firstWeekday = firstWeekdayOfMessageStudioCalendarMonth(calendarMonth);
  const entriesByDate = new Map<string, typeof entries>();
  for (const entry of entries) {
    const current = entriesByDate.get(entry.dateKey) ?? [];
    current.push(entry);
    entriesByDate.set(entry.dateKey, current);
  }
  const channelOptions = discordOptions?.messageTargets ?? discordOptions?.channels ?? [];
  const channelNames = new Map(channelOptions.map((channel) => [channel.id, channel.name]));
  const conflictKeys = new Set(
    entries
      .filter((entry) => entry.conflictCount > 1)
      .map((entry) => `${entry.dateKey}:${entry.timeLabel}:${entry.channelId}`),
  );
  const scheduledDays = entriesByDate.size;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/dashboard/guilds/${guildId}/daily-content`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Botで発言 / Message Studioへ戻る
        </Link>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
          表示Timezone: {config.defaultTimezone}
        </span>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight">投稿カレンダー</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            {guild.name} の1回予約・毎日・毎週投稿を月単位で確認できます。同じチャンネルへ同じ分に複数投稿が重なる場合は競合として表示します。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthButton
            href={`/dashboard/guilds/${guildId}/daily-content/calendar?month=${previousMonth.key}`}
            label="前月"
            icon={<ChevronLeft className="h-4 w-4" />}
          />
          <span className="min-w-28 text-center text-lg font-semibold">
            {calendarMonth.year}年{calendarMonth.month}月
          </span>
          <MonthButton
            href={`/dashboard/guilds/${guildId}/daily-content/calendar?month=${nextMonth.key}`}
            label="翌月"
            icon={<ChevronRight className="h-4 w-4" />}
            iconAfter
          />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Metric icon={<MessageSquareText className="h-5 w-5" />} label="有効な投稿" value={enabledScheduleCount} />
        <Metric icon={<Layers3 className="h-5 w-5" />} label="今月の配信予定" value={entries.length} />
        <Metric icon={<CircleAlert className="h-5 w-5" />} label="重複時間帯" value={conflictKeys.size} />
      </div>

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="grid grid-cols-7 border-b border-border bg-background/60">
            {WEEKDAYS.map((weekday, index) => (
              <div
                key={weekday}
                className={`px-2 py-2 text-center text-xs font-semibold ${
                  index === 0
                    ? 'text-rose-500'
                    : index === 6
                      ? 'text-blue-500'
                      : 'text-muted'
                }`}
              >
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: firstWeekday }, (_, index) => (
              <div
                key={`leading-${index}`}
                aria-hidden="true"
                className="min-h-32 border-b border-r border-border bg-background/30 p-2"
              />
            ))}
            {calendarDays.map((day) => {
              const dayEntries = entriesByDate.get(day.dateKey) ?? [];
              const weekday = new Date(
                Date.UTC(calendarMonth.year, calendarMonth.month - 1, day.day),
              ).getUTCDay();
              return (
                <div
                  key={day.dateKey}
                  className="min-h-32 border-b border-r border-border p-2 align-top"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-semibold ${
                        weekday === 0
                          ? 'text-rose-500'
                          : weekday === 6
                            ? 'text-blue-500'
                            : 'text-foreground'
                      }`}
                    >
                      {day.day}
                    </span>
                    {dayEntries.length > 0 ? (
                      <span className="text-[10px] text-muted">{dayEntries.length}件</span>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {dayEntries.slice(0, 5).map((entry) => (
                      <Link
                        key={`${entry.scheduleId}:${entry.scheduledAt.toISOString()}`}
                        href={`/dashboard/guilds/${guildId}/daily-content#message-studio-composer`}
                        className={`block rounded-lg border px-2 py-1.5 text-[11px] transition hover:bg-background ${
                          entry.conflictCount > 1
                            ? 'border-amber-500/40 bg-amber-500/5'
                            : 'border-border bg-background/70'
                        }`}
                        title={`${entry.title || '無題の投稿'} / ${channelNames.get(entry.channelId) ?? entry.channelId}`}
                      >
                        <span className="flex items-center gap-1 font-semibold">
                          <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {entry.timeLabel}
                          {entry.conflictCount > 1 ? (
                            <span className="ml-auto text-amber-600 dark:text-amber-300">
                              ×{entry.conflictCount}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate">
                          {entry.title || channelNames.get(entry.channelId) || '無題の投稿'}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted">
                          #{channelNames.get(entry.channelId) ?? entry.channelId}
                        </span>
                      </Link>
                    ))}
                    {dayEntries.length > 5 ? (
                      <p className="px-1 text-[10px] text-muted">ほか{dayEntries.length - 5}件</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">競合チェック</h2>
          <p className="mt-1 text-xs text-muted">
            同一チャンネル・同一分に複数の予約がある場合だけ警告します。Discord側の投稿自体は止めません。
          </p>
          {conflictKeys.size === 0 ? (
            <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-300">
              今月は重複時間帯がありません。
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {[...conflictKeys].slice(0, 10).map((key) => {
                const [dateKey, timeLabel, channelId] = key.split(':');
                return (
                  <div key={key} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <p className="font-medium text-amber-700 dark:text-amber-300">
                      {dateKey} {timeLabel}
                    </p>
                    <p className="mt-1 text-muted">#{channelNames.get(channelId ?? '') ?? channelId}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">カレンダーの見方</h2>
          <div className="mt-3 space-y-2 text-xs leading-5 text-muted">
            <p>・1回予約、毎日、毎週の設定から、この月に実際に発火する予定時刻を算出しています。</p>
            <p>・表示時刻はMessage Studioの既定Timezone（{config.defaultTimezone}）へ統一しています。</p>
            <p>・個別投稿で別Timezoneを設定していても、実際の絶対時刻へ変換してから並べます。</p>
            <p>・停止中の投稿はカレンダーへ出さず、有効なスケジュールだけを表示します。</p>
          </div>
        </section>
      </div>

      <p className="mt-4 text-xs text-muted">
        今月は{scheduledDays}日間に配信予定があります。カレンダーは確認用で、既存Schedulerの実行状態や配信ロジックは変更しません。
      </p>
    </div>
  );
}

function MonthButton({
  href,
  label,
  icon,
  iconAfter = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  iconAfter?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:bg-surface"
    >
      {!iconAfter ? icon : null}
      <span className="hidden sm:inline">{label}</span>
      {iconAfter ? icon : null}
    </Link>
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
