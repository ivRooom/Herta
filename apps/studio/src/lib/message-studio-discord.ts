const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const MESSAGE_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const FORUM_CHANNEL_TYPES = new Set([15]);
const SUPPORTED_CHANNEL_TYPES = new Set([...MESSAGE_CHANNEL_TYPES, ...FORUM_CHANNEL_TYPES]);
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

export const MESSAGE_STUDIO_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MESSAGE_STUDIO_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

interface DiscordChannelPayload {
  id: string;
  type: number;
  guild_id?: string;
  thread_metadata?: { archived?: boolean; locked?: boolean };
}

interface DiscordMessagePayload {
  id?: unknown;
}

interface DiscordForumPayload extends DiscordChannelPayload {
  message?: DiscordMessagePayload;
}

export interface MessageStudioImageAttachment {
  bytes: Uint8Array;
  filename: string;
  contentType: (typeof MESSAGE_STUDIO_IMAGE_MIME_TYPES)[number];
}

export interface SendMessageStudioMessageInput {
  token: string;
  guildId: string;
  channelId: string;
  content: string;
  forumTitle: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  attachment: MessageStudioImageAttachment | null;
}

export interface SendMessageStudioMessageResult {
  messageId: string;
  channelId: string;
  threadId: string | null;
  channelType: number;
}

export class MessageStudioDiscordError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'MessageStudioDiscordError';
    this.status = status;
  }
}

export function validateMessageStudioImageFile(file: File): string | null {
  if (file.size <= 0) return '画像ファイルが空です';
  if (file.size > MESSAGE_STUDIO_IMAGE_MAX_BYTES) return '画像は8MiB以下にしてください';
  if (!MESSAGE_STUDIO_IMAGE_MIME_TYPES.includes(file.type as never)) {
    return '画像はPNG / JPEG / GIF / WebPを選択してください';
  }
  return null;
}

export function sanitizeMessageStudioFilename(name: string, contentType: string): string {
  const extension = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  }[contentType] ?? '.bin';
  const base = name
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  if (!base) return `image${extension}`;
  return /\.[A-Za-z0-9]{2,5}$/u.test(base) ? base : `${base}${extension}`;
}

export async function sendMessageStudioMessage(
  input: SendMessageStudioMessageInput,
): Promise<SendMessageStudioMessageResult> {
  if (!/^\d+$/u.test(input.guildId) || !/^\d+$/u.test(input.channelId)) {
    throw new MessageStudioDiscordError('Discordの投稿先が不正です', 400);
  }
  const channel = await fetchDiscordChannel(input.token, input.channelId);
  if (channel.guild_id !== input.guildId) {
    throw new MessageStudioDiscordError('選択した投稿先はこのサーバーに属していません', 403);
  }
  if (!SUPPORTED_CHANNEL_TYPES.has(channel.type)) {
    throw new MessageStudioDiscordError('このチャンネル種別には投稿できません', 400);
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type) && channel.thread_metadata?.locked) {
    throw new MessageStudioDiscordError('ロック中のスレッドには投稿できません', 409);
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type) && channel.thread_metadata?.archived) {
    await unarchiveDiscordThread(input.token, input.channelId);
  }

  if (FORUM_CHANNEL_TYPES.has(channel.type)) {
    if (input.publishAnnouncement) {
      throw new MessageStudioDiscordError('Forum投稿ではCrosspostを利用できません', 400);
    }
    return sendForumPost(input, channel.type);
  }

  const messageId = await sendChannelMessage(input);
  if (input.publishAnnouncement && channel.type === 5) {
    await crosspostMessage(input.token, input.channelId, messageId);
  }
  return { messageId, channelId: input.channelId, threadId: null, channelType: channel.type };
}

async function fetchDiscordChannel(token: string, channelId: string): Promise<DiscordChannelPayload> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await discordError('投稿先チャンネルを確認できませんでした', response);
  return (await response.json()) as DiscordChannelPayload;
}

async function unarchiveDiscordThread(token: string, channelId: string): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: false }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await discordError('アーカイブ済みスレッドを再開できませんでした', response);
}

async function sendChannelMessage(input: SendMessageStudioMessageInput): Promise<string> {
  const payload = {
    content: input.content || undefined,
    allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
    attachments: input.attachment
      ? [{ id: 0, filename: input.attachment.filename }]
      : undefined,
  };
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {
    method: 'POST',
    headers: input.attachment
      ? { Authorization: `Bot ${input.token}` }
      : { Authorization: `Bot ${input.token}`, 'Content-Type': 'application/json' },
    body: input.attachment ? buildMultipartBody(payload, input.attachment) : JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await discordError('Discordへの投稿に失敗しました', response);
  const message = (await response.json()) as DiscordMessagePayload;
  if (typeof message.id !== 'string' || !message.id) {
    throw new MessageStudioDiscordError('Discordから不正な応答を受け取りました');
  }
  return message.id;
}

async function sendForumPost(
  input: SendMessageStudioMessageInput,
  channelType: number,
): Promise<SendMessageStudioMessageResult> {
  const title = normalizeForumTitle(input.forumTitle, input.content);
  const payload = {
    name: title,
    message: {
      content: input.content || undefined,
      allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
      attachments: input.attachment
        ? [{ id: 0, filename: input.attachment.filename }]
        : undefined,
    },
  };
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/threads`, {
    method: 'POST',
    headers: input.attachment
      ? { Authorization: `Bot ${input.token}` }
      : { Authorization: `Bot ${input.token}`, 'Content-Type': 'application/json' },
    body: input.attachment ? buildMultipartBody(payload, input.attachment) : JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await discordError('Forum投稿の作成に失敗しました', response);
  const thread = (await response.json()) as DiscordForumPayload;
  const messageId = thread.message?.id;
  if (typeof thread.id !== 'string' || typeof messageId !== 'string') {
    throw new MessageStudioDiscordError('DiscordからForum投稿の不正な応答を受け取りました');
  }
  return {
    messageId,
    channelId: input.channelId,
    threadId: thread.id,
    channelType,
  };
}

function buildMultipartBody(payload: unknown, attachment: MessageStudioImageAttachment): FormData {
  const form = new FormData();
  form.set('payload_json', JSON.stringify(payload));
  form.set(
    'files[0]',
    new Blob([attachment.bytes], { type: attachment.contentType }),
    attachment.filename,
  );
  return form;
}

function normalizeForumTitle(forumTitle: string, content: string): string {
  const explicit = forumTitle.trim();
  if (explicit) return explicit.slice(0, 100);
  const firstLine = content.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? '';
  return (firstLine || 'Hertaからのお知らせ').slice(0, 100);
}

async function crosspostMessage(token: string, channelId: string, messageId: string): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}/crosspost`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw await discordError('投稿は完了しましたがCrosspostに失敗しました', response);
}

async function discordError(message: string, response: Response): Promise<MessageStudioDiscordError> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    detail = typeof body.message === 'string' ? body.message.slice(0, 180) : '';
  } catch {
    detail = '';
  }
  return new MessageStudioDiscordError(detail ? `${message}: ${detail}` : message, response.status);
}
