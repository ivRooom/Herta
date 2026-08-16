const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_REQUEST_TIMEOUT_MS = 5_000;
const YOUTUBE_QUERY_MAX_LENGTH = 160;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CACHE_TTL_MS = 5 * 60_000;
const YOUTUBE_CACHE_MAX_ENTRIES = 50;

interface YouTubeThumbnail {
  url?: string;
}

interface YouTubeSnippet {
  title?: string;
  channelTitle?: string;
  thumbnails?: {
    maxres?: YouTubeThumbnail;
    standard?: YouTubeThumbnail;
    high?: YouTubeThumbnail;
    medium?: YouTubeThumbnail;
    default?: YouTubeThumbnail;
  };
}

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: YouTubeSnippet;
}

interface YouTubeVideoItem {
  id?: string;
  snippet?: YouTubeSnippet;
}

interface YouTubeListResponse<T> {
  items?: T[];
  error?: {
    errors?: { reason?: string }[];
    message?: string;
  };
}

export interface YouTubeVideoResult {
  id: string;
  title: string;
  channelTitle: string;
  url: string;
  imageUrl: string | null;
  presenceText: string;
}

type YouTubeCatalogErrorCode =
  'invalid_query' | 'not_configured' | 'timeout' | 'rate_limited' | 'upstream_failed';

const resultCache = new Map<string, { expiresAt: number; videos: YouTubeVideoResult[] }>();

export function isYouTubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (YOUTUBE_VIDEO_ID_PATTERN.test(value)) return value;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;

    if (url.hostname === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    const host = url.hostname.replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;

    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0] ?? '')) {
      const id = parts[1] ?? '';
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function formatYouTubePresenceText(title: string, channelTitle: string): string {
  const value = channelTitle ? `${title} — ${channelTitle}` : title;
  return value.slice(0, 128);
}

export async function searchYouTubeVideos(query: string): Promise<YouTubeVideoResult[]> {
  const normalizedQuery = query.trim().normalize('NFKC');
  if (!normalizedQuery || normalizedQuery.length > YOUTUBE_QUERY_MAX_LENGTH) {
    throw new YouTubeCatalogError('invalid_query', '検索文字列は1〜160文字で入力してください');
  }
  if (!isYouTubeConfigured()) {
    throw new YouTubeCatalogError('not_configured', 'YouTube連携が設定されていません');
  }

  const videoId = parseYouTubeVideoId(normalizedQuery);
  const cacheKey = videoId ? `video:${videoId}` : `search:${normalizedQuery.toLowerCase()}`;
  const cached = getCachedResult(cacheKey);
  if (cached) return cached;

  const videos = videoId ? await getVideoById(videoId) : await searchByKeyword(normalizedQuery);
  setCachedResult(cacheKey, videos);
  return videos;
}

async function getVideoById(videoId: string): Promise<YouTubeVideoResult[]> {
  const url = new URL(`${YOUTUBE_API_BASE_URL}/videos`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', getApiKey());

  const body = await youtubeFetch<YouTubeVideoItem>(url.toString());
  return (body.items ?? []).map(normalizeVideo).filter(isVideoResult);
}

async function searchByKeyword(query: string): Promise<YouTubeVideoResult[]> {
  const url = new URL(`${YOUTUBE_API_BASE_URL}/search`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '5');
  url.searchParams.set('regionCode', 'JP');
  url.searchParams.set('safeSearch', 'moderate');
  url.searchParams.set('key', getApiKey());

  const body = await youtubeFetch<YouTubeSearchItem>(url.toString());
  return (body.items ?? []).map(normalizeSearchResult).filter(isVideoResult);
}

function getApiKey(): string {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new YouTubeCatalogError('not_configured', 'YouTube連携が設定されていません');
  return apiKey;
}

async function youtubeFetch<T>(url: string): Promise<YouTubeListResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YOUTUBE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = (await response.json()) as YouTubeListResponse<T>;

    if (!response.ok) {
      const reason = body.error?.errors?.[0]?.reason ?? '';
      if (
        response.status === 429 ||
        [
          'quotaExceeded',
          'dailyLimitExceeded',
          'rateLimitExceeded',
          'userRateLimitExceeded',
        ].includes(reason)
      ) {
        throw new YouTubeCatalogError(
          'rate_limited',
          'YouTubeの検索上限に達しました。時間を置いて再試行してください',
        );
      }
      throw new YouTubeCatalogError(
        'upstream_failed',
        response.status === 400 || response.status === 403
          ? 'YouTube API設定またはAPIキーを確認してください'
          : 'YouTubeから動画情報を取得できませんでした',
      );
    }

    return body;
  } catch (error) {
    if (error instanceof YouTubeCatalogError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new YouTubeCatalogError('timeout', 'YouTubeへの接続がタイムアウトしました');
    }
    throw new YouTubeCatalogError('upstream_failed', 'YouTubeへ接続できませんでした');
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSearchResult(item: YouTubeSearchItem): YouTubeVideoResult | null {
  return normalizeVideo({ id: item.id?.videoId, snippet: item.snippet });
}

function normalizeVideo(item: YouTubeVideoItem): YouTubeVideoResult | null {
  const id = item.id?.trim();
  const title = decodeYouTubeText(item.snippet?.title?.trim() ?? '');
  const channelTitle = decodeYouTubeText(item.snippet?.channelTitle?.trim() ?? '');
  if (!id || !YOUTUBE_VIDEO_ID_PATTERN.test(id) || !title) return null;

  return {
    id,
    title,
    channelTitle,
    url: `https://www.youtube.com/watch?v=${id}`,
    imageUrl:
      item.snippet?.thumbnails?.maxres?.url ??
      item.snippet?.thumbnails?.standard?.url ??
      item.snippet?.thumbnails?.high?.url ??
      item.snippet?.thumbnails?.medium?.url ??
      item.snippet?.thumbnails?.default?.url ??
      null,
    presenceText: formatYouTubePresenceText(title, channelTitle),
  };
}

function decodeYouTubeText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function getCachedResult(key: string): YouTubeVideoResult[] | null {
  const cached = resultCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return null;
  }
  return cached.videos;
}

function setCachedResult(key: string, videos: YouTubeVideoResult[]) {
  if (resultCache.size >= YOUTUBE_CACHE_MAX_ENTRIES) {
    const oldestKey = resultCache.keys().next().value as string | undefined;
    if (oldestKey) resultCache.delete(oldestKey);
  }
  resultCache.set(key, { expiresAt: Date.now() + YOUTUBE_CACHE_TTL_MS, videos });
}

function isVideoResult(value: YouTubeVideoResult | null): value is YouTubeVideoResult {
  return value !== null;
}

export class YouTubeCatalogError extends Error {
  readonly code: YouTubeCatalogErrorCode;

  constructor(code: YouTubeCatalogErrorCode, message: string) {
    super(message);
    this.name = 'YouTubeCatalogError';
    this.code = code;
  }
}
