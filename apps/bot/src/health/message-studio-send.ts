const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const MESSAGE_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const FORUM_CHANNEL_TYPES = new Set([15]);
const SUPPORTED_CHANNEL_TYPES = new Set([...MESSAGE_CHANNEL_TYPES, ...FORUM_CHANNEL_TYPES]);
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface DiscordChannelPayload {
  id: string;
  type: number;
  guild_id?: string;
  thread_metadata?: { archived?: boolean; locked?: boolean };
  message?: { id?: unknown };
}

export interface GuildMessageStudioSendInput {
  channelId: string;
  content: string;
  forumTitle: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  image: {
    filename: string;
    contentType: string;
    dataBase64: string;
  } | null;
}

export interface GuildMessageStudioSendResult {
  messageId: string;
  channelId: string;
  threadId: string | null;
  channelType: number;
}

export class GuildMessageStudioSendError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'GuildMessageStudioSendError';
  }
}

export function parseGuildMessageStudioSendInput(
  value: unknown,
): GuildMessageStudioSendInput | null {
  if (!isRecord(value)) return null;
  const channelId = typeof value.channelId === 'string' ? value.channelId.trim() : '';
  const content = typeof value.content === 'string' ? value.content : '';
  const forumTitle = typeof value.forumTitle === 'string' ? value.forumTitle.trim() : '';
  if (!/^\d{17,20}$/u.test(channelId) || content.length > 4_000 || forumTitle.length > 100)
    return null;
  if (
    typeof value.allowUserMentions !== 'boolean' ||
    typeof value.publishAnnouncement !== 'boolean'
  ) {
    return null;
  }

  let image: GuildMessageStudioSendInput['image'] = null;
  if (value.image !== null && value.image !== undefined) {
    if (!isRecord(value.image)) return null;
    const filename = typeof value.image.filename === 'string' ? value.image.filename.trim() : '';
    const contentType = typeof value.image.contentType === 'string' ? value.image.contentType : '';
    const dataBase64 = typeof value.image.dataBase64 === 'string' ? value.image.dataBase64 : '';
    if (!filename || filename.length > 100 || !IMAGE_MIME_TYPES.has(contentType) || !dataBase64)
      return null;
    const bytes = decodeBase64(dataBase64);
    if (!bytes || bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    image = { filename, contentType, dataBase64 };
  }
  if (!content.trim() && !image) return null;

  return {
    channelId,
    content,
    forumTitle,
    allowUserMentions: value.allowUserMentions,
    publishAnnouncement: value.publishAnnouncement,
    image,
  };
}

export async function sendGuildMessageStudioMessage(
  token: string,
  guildId: string,
  input: GuildMessageStudioSendInput,
): Promise<GuildMessageStudioSendResult> {
  const channel = await fetchChannel(token, input.channelId);
  if (channel.guild_id !== guildId) {
    throw new GuildMessageStudioSendError('選択した投稿先はこのサーバーに属していません', 403);
  }
  if (!SUPPORTED_CHANNEL_TYPES.has(channel.type)) {
    throw new GuildMessageStudioSendError('このチャンネル種別には投稿できません', 400);
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type) && channel.thread_metadata?.locked) {
    throw new GuildMessageStudioSendError('ロック中のスレッドには投稿できません', 409);
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type) && channel.thread_metadata?.archived) {
    await unarchiveThread(token, input.channelId);
  }

  if (FORUM_CHANNEL_TYPES.has(channel.type)) {
    if (input.publishAnnouncement) {
      throw new GuildMessageStudioSendError('Forum投稿ではCrosspostを利用できません', 400);
    }
    return sendForumPost(token, guildId, input, channel.type);
  }

  const messageId = await sendChannelMessage(token, input);
  if (input.publishAnnouncement && channel.type === 5) {
    await crosspost(token, input.channelId, messageId);
  }
  return { messageId, channelId: input.channelId, threadId: null, channelType: channel.type };
}

async function fetchChannel(token: string, channelId: string): Promise<DiscordChannelPayload> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await discordError('投稿先チャンネルを確認できませんでした', response);
  return (await response.json()) as DiscordChannelPayload;
}

async function unarchiveThread(token: string, channelId: string): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: false }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw await discordError('アーカイブ済みスレッドを再開できませんでした', response);
}

async function sendChannelMessage(
  token: string,
  input: GuildMessageStudioSendInput,
): Promise<string> {
  const payload = {
    content: input.content || undefined,
    allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
    attachments: input.image ? [{ id: 0, filename: input.image.filename }] : undefined,
  };
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {
    method: 'POST',
    headers: input.image
      ? { Authorization: `Bot ${token}` }
      : { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: input.image ? buildMultipart(payload, input.image) : JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await discordError('Discordへの投稿に失敗しました', response);
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== 'string' || !message.id) {
    throw new GuildMessageStudioSendError('Discordから不正な応答を受け取りました');
  }
  return message.id;
}

async function sendForumPost(
  token: string,
  guildId: string,
  input: GuildMessageStudioSendInput,
  channelType: number,
): Promise<GuildMessageStudioSendResult> {
  const payload = {
    name: resolveForumTitle(input.forumTitle, input.content),
    message: {
      content: input.content || undefined,
      allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
      attachments: input.image ? [{ id: 0, filename: input.image.filename }] : undefined,
    },
  };
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/threads`, {
    method: 'POST',
    headers: input.image
      ? { Authorization: `Bot ${token}` }
      : { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: input.image ? buildMultipart(payload, input.image) : JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await discordError('Forum投稿の作成に失敗しました', response);
  const thread = (await response.json()) as DiscordChannelPayload;
  if (thread.guild_id && thread.guild_id !== guildId) {
    throw new GuildMessageStudioSendError('作成されたForum投稿のGuildが一致しません', 502);
  }
  const messageId = thread.message?.id;
  if (typeof thread.id !== 'string' || typeof messageId !== 'string') {
    throw new GuildMessageStudioSendError('DiscordからForum投稿の不正な応答を受け取りました');
  }
  return { messageId, channelId: input.channelId, threadId: thread.id, channelType };
}

function buildMultipart(
  payload: unknown,
  image: NonNullable<GuildMessageStudioSendInput['image']>,
): FormData {
  const bytes = decodeBase64(image.dataBase64);
  if (!bytes) throw new GuildMessageStudioSendError('添付画像を復元できませんでした', 400);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const form = new FormData();
  form.set('payload_json', JSON.stringify(payload));
  form.set('files[0]', new Blob([arrayBuffer], { type: image.contentType }), image.filename);
  return form;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const buffer = Buffer.from(value, 'base64');
    if (
      buffer.length === 0 ||
      buffer.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
    ) {
      return null;
    }
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function resolveForumTitle(explicit: string, content: string): string {
  if (explicit) return explicit.slice(0, 100);
  const firstLine =
    content
      .split(/\r?\n/u)
      .find((line) => line.trim())
      ?.trim() ?? '';
  return (firstLine || 'Hertaからのお知らせ').slice(0, 100);
}

async function crosspost(token: string, channelId: string, messageId: string): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}/crosspost`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw await discordError('投稿は完了しましたがCrosspostに失敗しました', response);
}

async function discordError(
  message: string,
  response: Response,
): Promise<GuildMessageStudioSendError> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    detail = typeof body.message === 'string' ? body.message.slice(0, 180) : '';
  } catch {
    detail = '';
  }
  return new GuildMessageStudioSendError(
    detail ? `${message}: ${detail}` : message,
    response.status,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
