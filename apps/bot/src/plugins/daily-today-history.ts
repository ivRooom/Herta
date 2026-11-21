import { createHmac, randomUUID } from 'node:crypto';

export const TODAY_HISTORY_PATH = '/v2/today-history/herta/daily';

export interface TodayHistoryEvent {
  title: string;
  summary: string;
  sourceUrl: string;
  anniversary: number | null;
}

export interface TodayHistoryConfig {
  apiBaseUrl: string;
  secret: string;
  guildId: string;
}

/** Theme keys of the daily bundle contract (ivrm-web #1304). */
export const DAILY_BUNDLE_THEME_KEYS = [
  'standard',
  'halloween',
  'christmas',
  'new_year',
  'sakura',
  'summer',
  'autumn',
  'anniversary',
] as const;

export type DailyBundleThemeKey = (typeof DAILY_BUNDLE_THEME_KEYS)[number];

export interface DailyBundleImage {
  url: string;
  width: number;
  height: number;
  alt: string | null;
}

export interface DailyBundleVideo {
  url: string;
}

/**
 * The day's delivery bundle resolved by the Web side (#1304): a
 * banner image and a theme key, each resolved date > annual >
 * default. Contract v2 (ivrm-web #1500) adds an optional video
 * URL, delivered by link: the announcement message content
 * carries the URL and Discord renders it inline. The bot only
 * renders what the bundle carries; content management lives in
 * the Web Admin calendar.
 */
export interface DailyBundle {
  themeKey: DailyBundleThemeKey | null;
  image: DailyBundleImage | null;
  video: DailyBundleVideo | null;
}

export interface TodayHistoryPayload {
  events: TodayHistoryEvent[];
  bundle: DailyBundle | null;
}

/**
 * The anniversary bank lives in ivrm-web (Today-in-History, ivrm-web
 * #866); this client only renders the day's confirmed selection that
 * the Web API returns (Herta #880). The call uses the same HMAC
 * service auth as the points bridge (HERTA_POINTS_SECRET), and the
 * "confirm" mode is the Web side's freeze step: the first caller of
 * the day fixes the snapshot every other surface reads, so the 09:00
 * announcement never re-draws its own items.
 */
export function resolveTodayHistoryConfig(
  env: Partial<Record<string, string | undefined>>,
): TodayHistoryConfig | null {
  const raw = env.IVRM_WEB_API_BASE_URL?.trim();
  const secret = env.HERTA_POINTS_SECRET?.trim();
  if (!raw || !secret) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    )
      return null;
    const guildId = env.IVRM_INTEGRATION_GUILD_ID?.trim();
    if (!guildId || !/^\d{17,20}$/.test(guildId)) return null;
    return { apiBaseUrl: url.origin, secret, guildId };
  } catch {
    return null;
  }
}

export function buildTodayHistoryRequest(
  config: TodayHistoryConfig,
  guildId: string,
  date: string,
  requestId: string,
  timestamp: string,
  mode: 'confirm' | 'preview' = 'confirm',
) {
  const body = JSON.stringify({ guildId, date, mode });
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${requestId}.POST.${TODAY_HISTORY_PATH}.${body}`)
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${TODAY_HISTORY_PATH}`,
    init: {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': requestId,
        'X-IVRM-Signature': signature,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Strictly validate the Web selection before rendering it. Any
 * malformed item invalidates the whole response: a partially rendered
 * anniversary section is worse than none. Returns null when the
 * payload is not a confirmed selection for the requested date.
 */
export function parseTodayHistoryResponse(
  value: unknown,
  date: string,
  limit: number,
): TodayHistoryEvent[] | null {
  if (
    !isRecord(value) ||
    value.date !== date ||
    value.confirmed !== true ||
    !Array.isArray(value.items)
  )
    return null;
  const events: TodayHistoryEvent[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) return null;
    const { title, summary, sourceUrl, anniversaryYears } = item;
    if (typeof title !== 'string' || !title.trim() || title.length > 256) return null;
    if (typeof summary !== 'string' || summary.length > 1024) return null;
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048 || !/^https:\/\//.test(sourceUrl))
      return null;
    if (!(
      anniversaryYears === null ||
      (Number.isSafeInteger(anniversaryYears) && (anniversaryYears as number) >= 0)
    ))
      return null;
    events.push({
      title,
      summary,
      sourceUrl,
      anniversary: anniversaryYears as number | null,
    });
  }
  const cap = Math.max(0, Math.min(3, Math.floor(limit)));
  return events.slice(0, cap);
}

const DAILY_BUNDLE_SOURCES = new Set(['default', 'annual', 'date']);

/**
 * Full URL validation for the banner image: EmbedBuilder.setImage
 * rejects values like "https://" and the throw would fail the whole
 * announcement, so anything the URL parser cannot accept as an
 * https URL with a host is rejected here instead.
 */
function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Validate the bundle block of a today-history response. The bundle
 * degrades independently of the anniversary items: a missing or
 * malformed bundle yields null (the announcement renders without a
 * banner/theme) and never invalidates a good selection.
 */
/**
 * Validate the contract v2 video block. The video degrades on its
 * own: a malformed video yields null and never discards a valid
 * image or theme, because the video is an additive field the day
 * can simply go without.
 */
function parseDailyBundleVideo(value: unknown): DailyBundleVideo | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  const { url, source } = value;
  if (typeof url !== 'string' || url.length > 2048 || !isHttpsUrl(url)) return null;
  if (!DAILY_BUNDLE_SOURCES.has(source as string)) return null;
  return { url };
}

export function parseDailyBundle(value: unknown): DailyBundle | null {
  if (!isRecord(value) || (value.contractVersion !== 1 && value.contractVersion !== 2)) return null;
  const { themeKey, themeSource, image } = value;
  if (themeKey !== null && !(DAILY_BUNDLE_THEME_KEYS as readonly unknown[]).includes(themeKey))
    return null;
  if (themeSource !== null && !DAILY_BUNDLE_SOURCES.has(themeSource as string)) return null;
  const video = value.contractVersion === 2 ? parseDailyBundleVideo(value.video) : null;
  if (image === null)
    return { themeKey: themeKey as DailyBundleThemeKey | null, image: null, video };
  if (!isRecord(image)) return null;
  const { url, width, height, alt, source } = image;
  if (typeof url !== 'string' || url.length > 2048 || !isHttpsUrl(url)) return null;
  if (!Number.isSafeInteger(width) || (width as number) < 1 || (width as number) > 8192)
    return null;
  if (!Number.isSafeInteger(height) || (height as number) < 1 || (height as number) > 8192)
    return null;
  if (alt !== null && (typeof alt !== 'string' || alt.length > 300)) return null;
  if (!DAILY_BUNDLE_SOURCES.has(source as string)) return null;
  return {
    themeKey: themeKey as DailyBundleThemeKey | null,
    image: {
      url,
      width: width as number,
      height: height as number,
      alt: alt as string | null,
    },
    video,
  };
}

/**
 * Parse the full confirm payload: anniversary events plus bundle.
 * The envelope (date + confirmation) gates the whole payload, but
 * the two sections then degrade independently: an invalid item
 * selection yields an empty event list without discarding a valid
 * bundle, and vice versa.
 */
export function parseTodayHistoryPayload(
  value: unknown,
  date: string,
  limit: number,
): TodayHistoryPayload | null {
  if (!isRecord(value) || value.date !== date || value.confirmed !== true) return null;
  const events = parseTodayHistoryResponse(value, date, limit) ?? [];
  const bundle = parseDailyBundle(value.bundle);
  return { events, bundle };
}

/**
 * Fetch the day's anniversaries from the Web bank. Every failure
 * (unconfigured, unreachable, rejected, malformed) degrades to an
 * empty list: the announcement goes out without an anniversary
 * section, exactly like a day with no entries, and never blocks the
 * login bonus itself.
 */
export async function fetchTodayHistoryEvents(
  guildId: string,
  date: string,
  limit: number,
  config = resolveTodayHistoryConfig(process.env),
): Promise<TodayHistoryEvent[]> {
  const payload = await fetchDailyTodayHistory(guildId, date, limit, config);
  return payload?.events ?? [];
}

/**
 * Fetch the day's anniversaries and delivery bundle in one confirm
 * call. Failures degrade exactly like fetchTodayHistoryEvents: null
 * means "render the announcement without either section".
 */
export async function fetchDailyTodayHistory(
  guildId: string,
  date: string,
  limit: number,
  config = resolveTodayHistoryConfig(process.env),
  mode: 'confirm' | 'preview' = 'confirm',
): Promise<TodayHistoryPayload | null> {
  if (!config || config.guildId !== guildId) return null;
  const requestId = randomUUID();
  const request = buildTodayHistoryRequest(
    config,
    guildId,
    date,
    requestId,
    new Date().toISOString(),
    mode,
  );
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return null;
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parseTodayHistoryPayload(value, date, limit);
  } catch {
    return null;
  } // Never log URLs, response bodies or entry contents.
}
