import { createHmac, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';

/**
 * クエストボード B7e (ivrm-web #1407) 向けの日次活動集計 push。
 *
 * Herta が既に収集している日次活動のうち、クエスト判定に必要な2 metric を
 * 1時間間隔で ivrm-web apps/api の `POST /v1/herta/activity-daily` へ署名付きで
 * 送る。対象は `IVRM_INTEGRATION_GUILD_ID` の単一 guild のみで、直近8日分を
 * (user, date, metric) 単位で送り、ivrm-web 側が置換 upsert する (再送・再集計に
 * 冪等)。
 *
 * - `reactions_given`: `community_activity_daily` の既存日次集計 (JST
 *   カレンダー日、Activity Rules 適用済み、取り消しは差し引かない gross)。
 * - `commands`: 日次 `commands` ではなく `command_execution_events` を正本に、
 *   status=success のみを JST カレンダー日へ畳む (Community Points の
 *   「コマンドを数えた」意味論と一致させる)。
 *
 * 署名は community-activity-ivrm-sync.ts (活動同期) と同じ HMAC-SHA256
 * パターン・同じ共有鍵 (`HERTA_ACTIVITY_SYNC_SECRET`) を使う。送信は
 * fail-soft で、失敗しても Bot の他機能には影響せず、次回 cycle で同じ
 * 窓を再送する。
 */

export const ACTIVITY_DAILY_REQUEST_PATH = '/v1/herta/activity-daily';
const REQUEST_TIMEOUT_MS = 5_000;

/** 同期窓の日数。当日を含み、当該週と期間境界をカバーする。 */
export const ACTIVITY_DAILY_WINDOW_DAYS = 8;

export const ACTIVITY_DAILY_METRICS = ['reactions_given', 'commands'] as const;
export type ActivityDailyMetric = (typeof ACTIVITY_DAILY_METRICS)[number];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface ActivityDailySyncConfig {
  /** ivrm-web apps/api のベースURL (末尾スラッシュなし)。例: https://api.ivrm.jp */
  apiBaseUrl: string;
  /** ivrm-webの`HERTA_ACTIVITY_SYNC_SECRET`と同じ値を設定するHMAC共有鍵 (活動同期と共用)。 */
  secret: string;
  /** 送信対象のguild。`IVRM_INTEGRATION_GUILD_ID` と同じ単一guildのみを対象にする。 */
  guildId: string;
}

export interface ActivityDailyRow {
  discordUserId: string;
  /** JST カレンダー日 (YYYY-MM-DD)。 */
  activityDate: string;
  metric: ActivityDailyMetric;
  value: number;
}

export interface ActivityDailySyncRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/**
 * `HERTA_ACTIVITY_DAILY_SYNC_ENABLED=true` の場合のみ有効。未設定・false・
 * 必須env不足では null を返し、Bot は送信ループ自体を開始しない (既定OFFの
 * フェイルクローズド)。URL検証は activity-xp-ivrm-emitter.ts と同じ方針。
 */
export function resolveActivityDailySyncConfig(
  env: Partial<Record<string, string | undefined>>,
): ActivityDailySyncConfig | null {
  if (env['HERTA_ACTIVITY_DAILY_SYNC_ENABLED']?.trim() !== 'true') return null;
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_ACTIVITY_SYNC_SECRET']?.trim();
  const guildId = env['IVRM_INTEGRATION_GUILD_ID']?.trim();
  if (!rawUrl || !secret || !guildId) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret, guildId };
  } catch {
    return null;
  }
}

/**
 * 瞬間が属する JST カレンダー日 (YYYY-MM-DD)。
 * community-activity.ts の `jstDate()` と同じ導出 (UTC+9 の日付)。
 */
export function jstActivityDateKey(value: Date): string {
  return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 同期窓の日付キー一覧 (古い順)。`now` の JST 当日を末尾に含む `days` 日分。 */
export function activityDailyDateKeys(
  now: Date,
  days: number = ACTIVITY_DAILY_WINDOW_DAYS,
): string[] {
  const todayUtcMidnightMs = new Date(`${jstActivityDateKey(now)}T00:00:00.000Z`).getTime();
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(new Date(todayUtcMidnightMs - i * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

/** `community_activity_daily.activity_date` の格納形 (JST 日付キーを UTC 0時として持つ)。 */
function storedActivityDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** JST カレンダー日の開始瞬間 (UTC では前日15:00)。 */
function jstDayStartInstant(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000+09:00`);
}

function nextDateKey(dateKey: string): string {
  return new Date(storedActivityDate(dateKey).getTime() + DAY_MS).toISOString().slice(0, 10);
}

/**
 * `command_execution_events` の成功実行を (user, JST日) 単位へ畳む純粋関数。
 * userId が無い行 (記録経路の都合で欠ける行) は数えない。
 */
export function foldCommandExecutionsToDailyRows(
  events: readonly { userId: string | null; executedAt: Date }[],
): ActivityDailyRow[] {
  const counts = new Map<string, ActivityDailyRow>();
  for (const event of events) {
    if (!event.userId) continue;
    const activityDate = jstActivityDateKey(event.executedAt);
    const key = `${event.userId}\n${activityDate}`;
    const existing = counts.get(key);
    if (existing) {
      existing.value += 1;
    } else {
      counts.set(key, {
        discordUserId: event.userId,
        activityDate,
        metric: 'commands',
        value: 1,
      });
    }
  }
  return [...counts.values()];
}

/** payload の行順を安定させる (date → user → metric の昇順)。 */
export function sortActivityDailyRows(rows: readonly ActivityDailyRow[]): ActivityDailyRow[] {
  return [...rows].sort((a, b) => {
    if (a.activityDate !== b.activityDate) return a.activityDate < b.activityDate ? -1 : 1;
    if (a.discordUserId !== b.discordUserId) return a.discordUserId < b.discordUserId ? -1 : 1;
    if (a.metric !== b.metric) return a.metric < b.metric ? -1 : 1;
    return 0;
  });
}

/**
 * 同期窓 (直近8日) の行を正本2系統から集める。
 * - reactions_given は `community_activity_daily` の既存日次をそのまま読む。
 * - commands は `command_execution_events` の success のみを JST 日次へ畳む
 *   (日次 `commands` 列は使わない。畳み込みの定義を1箇所に寄せるため)。
 */
export async function collectActivityDailyRows(
  prisma: PrismaClient,
  guildId: string,
  now: Date,
): Promise<ActivityDailyRow[]> {
  const dateKeys = activityDailyDateKeys(now);
  const firstKey = dateKeys[0]!;
  const lastKey = dateKeys[dateKeys.length - 1]!;

  const reactionRows = await prisma.communityActivityDaily.findMany({
    where: {
      guildId,
      metric: 'reactions_given',
      activityDate: {
        gte: storedActivityDate(firstKey),
        lte: storedActivityDate(lastKey),
      },
    },
    select: { userId: true, activityDate: true, value: true },
  });

  const rows: ActivityDailyRow[] = [];
  for (const row of reactionRows) {
    const value = Number(row.value);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    rows.push({
      discordUserId: row.userId,
      activityDate: row.activityDate.toISOString().slice(0, 10),
      metric: 'reactions_given',
      value,
    });
  }

  const commandEvents = await prisma.commandExecutionEvent.findMany({
    where: {
      guildId,
      status: 'success',
      executedAt: {
        gte: jstDayStartInstant(firstKey),
        lt: jstDayStartInstant(nextDateKey(lastKey)),
      },
    },
    select: { userId: true, executedAt: true },
  });
  rows.push(...foldCommandExecutionsToDailyRows(commandEvents));

  return sortActivityDailyRows(rows);
}

/**
 * 活動同期 (community-activity-ivrm-sync.ts) と同じ canonical
 * (`POST\nPATH\nTIMESTAMP\nEVENT_ID\nBODY`) で署名する。ネットワークI/Oを
 * 含まないため単体テストで検証できる。
 */
export function buildActivityDailySyncRequest(
  config: ActivityDailySyncConfig,
  eventId: string,
  rows: readonly ActivityDailyRow[],
  timestamp: string,
): ActivityDailySyncRequest {
  const body = JSON.stringify({
    schemaVersion: 1,
    eventId,
    guildId: config.guildId,
    rows: rows.map((row) => ({
      discordUserId: row.discordUserId,
      activityDate: row.activityDate,
      metric: row.metric,
      value: row.value,
    })),
  });
  const canonical = ['POST', ACTIVITY_DAILY_REQUEST_PATH, timestamp, eventId, body].join('\n');
  const signature = createHmac('sha256', config.secret).update(canonical).digest('hex');

  return {
    url: `${config.apiBaseUrl}${ACTIVITY_DAILY_REQUEST_PATH}`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': eventId,
        'X-IVRM-Signature': signature,
      },
      body,
    },
  };
}

/**
 * 日次集計の fire-and-forget push。行が無い cycle では送らない。
 * 置換 upsert 前提のため再送は冪等で、失敗しても例外は投げず次回 cycle で
 * 同じ窓を送り直す。404 は受付側が未着地の間だけ起こりうるため活動同期と
 * 同じく正常な無視対象とし、warn は 5xx・network failure・timeout のみ。
 */
export async function pushActivityDailyToIvrmWeb(
  config: ActivityDailySyncConfig,
  rows: readonly ActivityDailyRow[],
  logger: Logger,
): Promise<void> {
  if (rows.length === 0) return;
  const eventId = randomUUID();
  const request = buildActivityDailySyncRequest(config, eventId, rows, new Date().toISOString());

  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      logger.warn(
        { status: response.status, eventId, rowCount: rows.length },
        'ivrm-webへの日次活動集計同期が失敗しました',
      );
    }
  } catch (error) {
    logger.warn(
      { err: error, eventId, rowCount: rows.length },
      'ivrm-webへの日次活動集計同期でリクエストに失敗しました',
    );
  }
}
