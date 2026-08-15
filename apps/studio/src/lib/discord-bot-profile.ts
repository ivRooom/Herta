import { resolveBotHealthRequestTimeoutMs } from '@/lib/bot-health';

const MIN_INTERNAL_API_SECRET_LENGTH = 32;

export interface DiscordBotGuildProfile {
  userId: string;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  guildAvatar: boolean;
}

export class DiscordBotProfileError extends Error {
  constructor(readonly status: number) {
    super(`Discord Bot profile request failed (${status})`);
    this.name = 'DiscordBotProfileError';
  }
}

export async function getDiscordBotGuildProfile(
  guildId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordBotGuildProfile> {
  return requestBotGuildProfile(guildId, { method: 'GET' }, fetchImpl);
}

export async function updateDiscordBotGuildProfile(
  guildId: string,
  input: { nickname: string | null; avatar?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordBotGuildProfile> {
  return requestBotGuildProfile(
    guildId,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    fetchImpl,
  );
}

async function requestBotGuildProfile(
  guildId: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<DiscordBotGuildProfile> {
  const url = resolveBotInternalProfileUrl(guildId);
  const secret = process.env['BOT_INTERNAL_API_SECRET']?.trim();
  if (!url || !secret || secret.length < MIN_INTERNAL_API_SECRET_LENGTH) {
    throw new DiscordBotProfileError(503);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        ...init.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(resolveBotHealthRequestTimeoutMs() + 5_000),
    });
  } catch {
    throw new DiscordBotProfileError(502);
  }

  if (!response.ok) {
    if (response.status === 404) throw new DiscordBotProfileError(404);
    if (response.status === 429) throw new DiscordBotProfileError(429);
    if (response.status === 401 || response.status === 403 || response.status === 503) {
      throw new DiscordBotProfileError(503);
    }
    throw new DiscordBotProfileError(502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DiscordBotProfileError(502);
  }

  const profile = isRecord(payload) ? parseBotGuildProfile(payload.profile) : null;
  if (!profile) throw new DiscordBotProfileError(502);
  return profile;
}

function resolveBotInternalProfileUrl(guildId: string): string | null {
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  if (!healthUrl || !/^\d{17,20}$/u.test(guildId)) return null;

  try {
    const url = new URL(healthUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = `/internal/guilds/${guildId}/bot-profile`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseBotGuildProfile(value: unknown): DiscordBotGuildProfile | null {
  if (!isRecord(value)) return null;

  const { userId, username, nickname, avatarUrl, guildAvatar } = value;
  if (typeof userId !== 'string' || !/^\d{17,20}$/u.test(userId)) return null;
  if (typeof username !== 'string' || username.length === 0) return null;
  if (nickname !== null && typeof nickname !== 'string') return null;
  if (avatarUrl !== null && typeof avatarUrl !== 'string') return null;
  if (typeof guildAvatar !== 'boolean') return null;

  return { userId, username, nickname, avatarUrl, guildAvatar };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
