/**
 * Release Notifications internal send (Issue #899).
 *
 * Receives a signed (Bearer) request from the Release Platform worker
 * and posts the already-rendered notification body to a guild channel
 * as the bot, returning the Discord message id synchronously.
 *
 * Contract: Release Platform docs/NOTIFICATION_BOT_API_JA.md (v0.2).
 * - Mentions are always suppressed server-side (allowed_mentions is
 *   pinned to an empty parse list, whatever the caller sent).
 * - Errors carry the HTTP status the internal server should return;
 *   Discord-side statuses pass through so callers can distinguish a
 *   missing channel (404) from transient failures.
 */

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const MESSAGE_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);
const MAX_CONTENT_LENGTH = 2000;
const MAX_EMBEDS = 10;

interface DiscordChannelPayload {
  id: string;
  type: number;
  guild_id?: string;
  thread_metadata?: { archived?: boolean; locked?: boolean };
}

export interface ReleaseNotificationSendInput {
  channelId: string;
  content: string;
  embeds: Record<string, unknown>[];
}

export interface ReleaseNotificationSendResult {
  messageId: string;
  channelId: string;
}

export class ReleaseNotificationSendError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'ReleaseNotificationSendError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseReleaseNotificationSendInput(
  value: unknown,
): ReleaseNotificationSendInput | null {
  if (!isRecord(value)) return null;
  const channelId =
    typeof value.destinationChannelId === 'string' ? value.destinationChannelId.trim() : '';
  if (!/^\d{17,20}$/u.test(channelId)) return null;
  const content = typeof value.content === 'string' ? value.content : '';
  if (content.length < 1 || content.length > MAX_CONTENT_LENGTH) return null;

  let embeds: Record<string, unknown>[] = [];
  if (value.embeds !== undefined && value.embeds !== null) {
    if (!Array.isArray(value.embeds) || value.embeds.length > MAX_EMBEDS) return null;
    if (!value.embeds.every((embed) => isRecord(embed))) return null;
    embeds = value.embeds as Record<string, unknown>[];
  }
  // allowedMentions is intentionally not read: mentions are always
  // suppressed for release notifications (policy), whatever was sent.
  return { channelId, content, embeds };
}

async function discordError(
  message: string,
  response: Response,
): Promise<ReleaseNotificationSendError> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    detail = typeof body.message === 'string' ? body.message.slice(0, 180) : '';
  } catch {
    detail = '';
  }
  return new ReleaseNotificationSendError(
    detail ? `${message}: ${detail}` : message,
    response.status,
  );
}

async function fetchChannel(
  token: string,
  channelId: string,
  fetchImpl: typeof fetch,
): Promise<DiscordChannelPayload> {
  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await discordError('投稿先チャンネルを確認できませんでした', response);
  return (await response.json()) as DiscordChannelPayload;
}

async function unarchiveThread(
  token: string,
  channelId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: false }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await discordError('スレッドのアーカイブ解除に失敗しました', response);
}

export async function sendReleaseNotification(
  token: string,
  input: ReleaseNotificationSendInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseNotificationSendResult> {
  const channel = await fetchChannel(token, input.channelId, fetchImpl);
  if (!channel.guild_id) {
    throw new ReleaseNotificationSendError('投稿先はサーバー内のチャンネルではありません', 400);
  }
  if (!MESSAGE_CHANNEL_TYPES.has(channel.type)) {
    throw new ReleaseNotificationSendError('このチャンネル種別には投稿できません', 400);
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type) && channel.thread_metadata?.locked) {
    throw new ReleaseNotificationSendError('ロック中のスレッドには投稿できません', 409);
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type) && channel.thread_metadata?.archived) {
    await unarchiveThread(token, input.channelId, fetchImpl);
  }

  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: input.content,
      embeds: input.embeds.length > 0 ? input.embeds : undefined,
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw await discordError('Discordへの投稿に失敗しました', response);
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== 'string' || !message.id) {
    throw new ReleaseNotificationSendError('Discordから不正な応答を受け取りました');
  }
  return { messageId: message.id, channelId: input.channelId };
}
