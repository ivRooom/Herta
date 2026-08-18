import { z } from 'zod';
import { resolveBotHealthRequestTimeoutMs } from './bot-health.ts';
import { guildChannelOptionSchema, type GuildChannelOption } from './bot-guild-options.ts';
import { getBotInternalApiAuthorizationHeader } from './bot-internal-api-auth.ts';

const archivedForumThreadPageSchema = z.object({
  threads: z.array(guildChannelOptionSchema).max(50),
  nextBefore: z.string().datetime().nullable(),
});

export interface ArchivedForumThreadPage {
  threads: GuildChannelOption[];
  nextBefore: string | null;
}

export class BotForumThreadsError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BotForumThreadsError';
    this.status = status;
  }
}

export async function getArchivedForumThreads(
  guildId: string,
  forumId: string,
  before: string | null,
  limit = 50,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchivedForumThreadPage> {
  if (!/^\d{17,20}$/u.test(guildId) || !/^\d{17,20}$/u.test(forumId)) {
    throw new BotForumThreadsError('GuildまたはForum IDが不正です', 400);
  }
  const normalizedBefore = normalizeBefore(before);
  if (before && !normalizedBefore) {
    throw new BotForumThreadsError('ページングcursorが不正です', 400);
  }

  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  const authorization = getBotInternalApiAuthorizationHeader();
  if (!healthUrl || !authorization) {
    throw new BotForumThreadsError('Bot内部APIが設定されていません', 503);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(
      `/internal/guilds/${guildId}/message-studio/forums/${forumId}/threads`,
      healthUrl,
    );
    endpoint.searchParams.set('limit', String(Math.max(1, Math.min(50, Math.trunc(limit) || 50))));
    if (normalizedBefore) endpoint.searchParams.set('before', normalizedBefore);
  } catch {
    throw new BotForumThreadsError('Bot内部APIのURLが不正です', 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(5_000, resolveBotHealthRequestTimeoutMs() + 5_000),
  );
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Authorization: authorization, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new BotForumThreadsError(
        messageForStatus(response.status),
        safeStatus(response.status),
      );
    }

    const payload = await response.json().catch(() => null);
    const parsed = archivedForumThreadPageSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BotForumThreadsError('Botから不正なForum投稿一覧を受け取りました', 502);
    }
    if (
      parsed.data.threads.some(
        (thread) => thread.kind !== 'thread' || thread.parentId !== forumId || !thread.viewable,
      )
    ) {
      throw new BotForumThreadsError('Forum投稿一覧の境界検証に失敗しました', 502);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof BotForumThreadsError) throw error;
    throw new BotForumThreadsError('Bot内部APIへ接続できませんでした', 503);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBefore(value: string | null): string | null {
  if (!value || value.length > 64) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function safeStatus(status: number): number {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 429) {
    return status;
  }
  return 503;
}

function messageForStatus(status: number): string {
  if (status === 400) return '選択したForumまたはページング情報が不正です';
  if (status === 401) return 'Bot内部APIの認証に失敗しました';
  if (status === 403) return 'このForumの過去投稿をBotが読み取れません';
  if (status === 404) return '選択したForumが見つかりません';
  if (status === 429) return 'Discordの取得制限に達しました。少し待ってから再試行してください';
  return 'Forumの過去投稿を取得できませんでした';
}
