const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_REQUEST_TIMEOUT_MS = 5_000;
const SPOTIFY_QUERY_MAX_LENGTH = 160;
const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

interface SpotifyTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface SpotifyArtist {
  name?: string;
}

interface SpotifyAlbum {
  images?: { url?: string }[];
}

interface SpotifyTrackObject {
  id?: string;
  name?: string;
  artists?: SpotifyArtist[];
  external_urls?: { spotify?: string };
  album?: SpotifyAlbum;
}

interface SpotifySearchResponse {
  tracks?: {
    items?: SpotifyTrackObject[];
  };
}

export interface SpotifyTrackResult {
  id: string;
  name: string;
  artists: string[];
  url: string;
  imageUrl: string | null;
  presenceText: string;
}

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

export function isSpotifyConfigured(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim(),
  );
}

export function parseSpotifyTrackId(input: string): string | null {
  const value = input.trim();
  if (SPOTIFY_TRACK_ID_PATTERN.test(value)) return value;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || parts[0] !== 'track') return null;
    return SPOTIFY_TRACK_ID_PATTERN.test(parts[1] ?? '') ? parts[1]! : null;
  } catch {
    return null;
  }
}

export function formatSpotifyPresenceText(name: string, artists: readonly string[]): string {
  const artistText = artists.filter(Boolean).join(', ');
  const value = artistText ? `${name} — ${artistText}` : name;
  return value.slice(0, 128);
}

export async function searchSpotifyTracks(query: string): Promise<SpotifyTrackResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > SPOTIFY_QUERY_MAX_LENGTH) {
    throw new SpotifyCatalogError('invalid_query', '検索文字列は1〜160文字で入力してください');
  }
  if (!isSpotifyConfigured()) {
    throw new SpotifyCatalogError('not_configured', 'Spotify連携が設定されていません');
  }

  const accessToken = await getSpotifyAccessToken();
  const trackId = parseSpotifyTrackId(normalizedQuery);
  if (trackId) {
    const response = await spotifyFetch(`${SPOTIFY_API_BASE_URL}/tracks/${trackId}`, accessToken);
    const track = (await response.json()) as SpotifyTrackObject;
    const normalized = normalizeTrack(track);
    return normalized ? [normalized] : [];
  }

  const url = new URL(`${SPOTIFY_API_BASE_URL}/search`);
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('type', 'track');
  url.searchParams.set('market', 'JP');
  url.searchParams.set('limit', '5');

  const response = await spotifyFetch(url.toString(), accessToken);
  const body = (await response.json()) as SpotifySearchResponse;
  return (body.tracks?.items ?? []).map(normalizeTrack).filter(isTrackResult);
}

async function getSpotifyAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) return tokenCache.accessToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new SpotifyCatalogError('not_configured', 'Spotify連携が設定されていません');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPOTIFY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SpotifyCatalogError('token_failed', 'Spotify認証に失敗しました');
    }
    const body = (await response.json()) as SpotifyTokenResponse;
    if (!body.access_token || !Number.isFinite(body.expires_in)) {
      throw new SpotifyCatalogError('token_failed', 'Spotify認証レスポンスが不正です');
    }
    tokenCache = {
      accessToken: body.access_token,
      expiresAt: now + Math.max(60, body.expires_in ?? 3600) * 1_000,
    };
    return body.access_token;
  } catch (error) {
    if (error instanceof SpotifyCatalogError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SpotifyCatalogError('timeout', 'Spotifyへの接続がタイムアウトしました');
    }
    throw new SpotifyCatalogError('upstream_failed', 'Spotifyへ接続できませんでした');
  } finally {
    clearTimeout(timeout);
  }
}

async function spotifyFetch(url: string, accessToken: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPOTIFY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new SpotifyCatalogError(
        'rate_limited',
        'Spotifyの検索上限に達しました。少し時間を置いてください',
      );
    }
    if (!response.ok) {
      throw new SpotifyCatalogError('upstream_failed', 'Spotifyから楽曲情報を取得できませんでした');
    }
    return response;
  } catch (error) {
    if (error instanceof SpotifyCatalogError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SpotifyCatalogError('timeout', 'Spotifyへの接続がタイムアウトしました');
    }
    throw new SpotifyCatalogError('upstream_failed', 'Spotifyへ接続できませんでした');
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTrack(track: SpotifyTrackObject): SpotifyTrackResult | null {
  const id = track.id?.trim();
  const name = track.name?.trim();
  const url = track.external_urls?.spotify?.trim();
  if (!id || !name || !url) return null;

  const artists = (track.artists ?? [])
    .map((artist) => artist.name?.trim() ?? '')
    .filter(Boolean)
    .slice(0, 4);
  return {
    id,
    name,
    artists,
    url,
    imageUrl: track.album?.images?.find((image) => image.url)?.url ?? null,
    presenceText: formatSpotifyPresenceText(name, artists),
  };
}

function isTrackResult(value: SpotifyTrackResult | null): value is SpotifyTrackResult {
  return value !== null;
}

export class SpotifyCatalogError extends Error {
  constructor(
    readonly code:
      | 'invalid_query'
      | 'not_configured'
      | 'token_failed'
      | 'timeout'
      | 'rate_limited'
      | 'upstream_failed',
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyCatalogError';
  }
}
