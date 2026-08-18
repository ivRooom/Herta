import type { GuildChannelOption } from './guild-options.js';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const FORUM_CHANNEL_TYPE = 15;
const PUBLIC_THREAD_TYPE = 11;
const MAX_ARCHIVED_THREADS_PER_PAGE = 50;

export interface GuildArchivedForumThreadPage {
  threads: GuildChannelOption[];
  nextBefore: string | null;
}

export class GuildForumThreadCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GuildForumThreadCatalogError';
  }
}

export async function fetchGuildArchivedForumThreads(
  token: string,
  guildId: string,
  forumId: string,
  before: string | null,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GuildArchivedForumThreadPage> {
  if (!/^\d{17,20}$/u.test(guildId) || !/^\d{17,20}$/u.test(forumId)) {
    throw new GuildForumThreadCatalogError('GuildまたはForum IDが不正です', 400, 'invalid_id');
  }

  const normalizedBefore = normalizeBefore(before);
  if (before && !normalizedBefore) {
    throw new GuildForumThreadCatalogError('ページングcursorが不正です', 400, 'invalid_before');
  }
  const normalizedLimit = Math.max(
    1,
    Math.min(MAX_ARCHIVED_THREADS_PER_PAGE, Math.trunc(limit) || MAX_ARCHIVED_THREADS_PER_PAGE),
  );

  const forum = await fetchForumChannel(token, forumId, fetchImpl);
  if (forum.guildId !== guildId) {
    throw new GuildForumThreadCatalogError(
      '選択したForumはこのGuildに属していません',
      403,
      'guild_mismatch',
    );
  }
  if (forum.type !== FORUM_CHANNEL_TYPE) {
    throw new GuildForumThreadCatalogError(
      '選択したChannelはForumではありません',
      400,
      'not_forum',
    );
  }

  const endpoint = new URL(`${DISCORD_API_BASE_URL}/channels/${forumId}/threads/archived/public`);
  endpoint.searchParams.set('limit', String(normalizedLimit));
  if (normalizedBefore) endpoint.searchParams.set('before', normalizedBefore);

  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bot ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new GuildForumThreadCatalogError(
      'Forumの過去投稿を取得できませんでした',
      discordStatus(response.status),
      response.status === 403
        ? 'missing_permission'
        : response.status === 404
          ? 'forum_not_found'
          : response.status === 429
            ? 'rate_limited'
            : 'discord_unavailable',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.threads) ||
    typeof payload.has_more !== 'boolean'
  ) {
    throw new GuildForumThreadCatalogError(
      'Discordから不正なForum投稿一覧を受け取りました',
      502,
      'invalid_discord_response',
    );
  }

  const accepted: Array<{ option: GuildChannelOption; archivedAt: string | null }> = [];
  let oldestArchivedAt: string | null = null;
  for (const rawThread of payload.threads) {
    const metadata =
      isRecord(rawThread) && isRecord(rawThread.thread_metadata) ? rawThread.thread_metadata : null;
    const rawArchivedAt =
      typeof metadata?.archive_timestamp === 'string'
        ? normalizeBefore(metadata.archive_timestamp)
        : null;
    if (
      rawArchivedAt &&
      (!oldestArchivedAt || Date.parse(rawArchivedAt) < Date.parse(oldestArchivedAt))
    ) {
      oldestArchivedAt = rawArchivedAt;
    }

    const parsed = parseArchivedThread(rawThread, guildId, forumId, forum.position);
    if (parsed) accepted.push(parsed);
  }

  return {
    threads: accepted.map((entry) => entry.option),
    nextBefore: payload.has_more ? oldestArchivedAt : null,
  };
}

async function fetchForumChannel(
  token: string,
  forumId: string,
  fetchImpl: typeof fetch,
): Promise<{ guildId: string; type: number; position: number }> {
  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/channels/${forumId}`, {
    headers: { Authorization: `Bot ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new GuildForumThreadCatalogError(
      'Forumを確認できませんでした',
      discordStatus(response.status),
      response.status === 403
        ? 'missing_permission'
        : response.status === 404
          ? 'forum_not_found'
          : response.status === 429
            ? 'rate_limited'
            : 'discord_unavailable',
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (
    !isRecord(payload) ||
    payload.id !== forumId ||
    typeof payload.guild_id !== 'string' ||
    typeof payload.type !== 'number'
  ) {
    throw new GuildForumThreadCatalogError(
      'Discordから不正なForum情報を受け取りました',
      502,
      'invalid_discord_response',
    );
  }
  return {
    guildId: payload.guild_id,
    type: payload.type,
    position: Number.isInteger(payload.position) ? Number(payload.position) : 0,
  };
}

function parseArchivedThread(
  value: unknown,
  guildId: string,
  forumId: string,
  forumPosition: number,
): { option: GuildChannelOption; archivedAt: string | null } | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !/^\d{17,20}$/u.test(value.id) ||
    value.guild_id !== guildId ||
    value.parent_id !== forumId ||
    value.type !== PUBLIC_THREAD_TYPE ||
    typeof value.name !== 'string' ||
    !value.name.trim()
  ) {
    return null;
  }

  const metadata = isRecord(value.thread_metadata) ? value.thread_metadata : null;
  const rawArchivedAt = metadata?.archive_timestamp;
  const archivedAt = typeof rawArchivedAt === 'string' ? normalizeBefore(rawArchivedAt) : null;
  return {
    option: {
      id: value.id,
      name: value.name.trim().slice(0, 100),
      kind: 'thread',
      position: forumPosition,
      parentId: forumId,
      viewable: true,
      readMessageHistory: true,
    },
    archivedAt,
  };
}

function normalizeBefore(value: string | null): string | null {
  if (!value || value.length > 64) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function discordStatus(status: number): number {
  if (status === 400 || status === 403 || status === 404 || status === 429) return status;
  return 502;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
