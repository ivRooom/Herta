const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const MESSAGE_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const FORUM_CHANNEL_TYPES = new Set([15]);
const SUPPORTED_CHANNEL_TYPES = new Set([...MESSAGE_CHANNEL_TYPES, ...FORUM_CHANNEL_TYPES]);
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_BYTES = 20 * 1024 * 1024;
const MAX_VOICE_DURATION_SECONDS = 6 * 60 * 60;
const VOICE_MESSAGE_FLAG = 1 << 13;
const EMBED_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;

interface DiscordChannelPayload {
  id: string;
  type: number;
  guild_id?: string;
  thread_metadata?: { archived?: boolean; locked?: boolean };
  message?: { id?: unknown };
}

export interface GuildMessageStudioEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface GuildMessageStudioEmbed {
  title: string;
  description: string;
  color: string;
  imageUrl: string;
  thumbnailUrl: string;
  footerText: string;
  fields: GuildMessageStudioEmbedField[];
}

interface EncodedAttachment {
  filename: string;
  contentType: string;
  dataBase64: string;
}

export interface GuildMessageStudioSendInput {
  channelId: string;
  content: string;
  forumTitle: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  embed: GuildMessageStudioEmbed | null;
  image: EncodedAttachment | null;
  voice: (EncodedAttachment & { durationSeconds: number; waveform: string }) | null;
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
  if (!/^\d{17,20}$/u.test(channelId) || content.length > 4_000 || forumTitle.length > 100) {
    return null;
  }
  if (
    typeof value.allowUserMentions !== 'boolean' ||
    typeof value.publishAnnouncement !== 'boolean'
  ) {
    return null;
  }

  const embed = parseEmbed(value.embed);
  if (value.embed !== null && value.embed !== undefined && !embed) return null;

  let image: GuildMessageStudioSendInput['image'] = null;
  if (value.image !== null && value.image !== undefined) {
    if (!isRecord(value.image)) return null;
    const parsed = parseEncodedAttachment(value.image, MAX_IMAGE_BYTES);
    if (!parsed || !IMAGE_MIME_TYPES.has(parsed.contentType)) return null;
    image = parsed;
  }

  let voice: GuildMessageStudioSendInput['voice'] = null;
  if (value.voice !== null && value.voice !== undefined) {
    if (!isRecord(value.voice)) return null;
    const parsed = parseEncodedAttachment(value.voice, MAX_VOICE_BYTES);
    const durationSeconds =
      typeof value.voice.durationSeconds === 'number' ? value.voice.durationSeconds : Number.NaN;
    const waveform = typeof value.voice.waveform === 'string' ? value.voice.waveform : '';
    const waveformBytes = decodeBase64(waveform);
    if (
      !parsed ||
      !parsed.contentType.toLowerCase().startsWith('audio/') ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > MAX_VOICE_DURATION_SECONDS ||
      !waveformBytes ||
      waveformBytes.length <= 0 ||
      waveformBytes.length > 256
    ) {
      return null;
    }
    voice = { ...parsed, durationSeconds, waveform };
  }

  if (voice && (content.trim() || image || embed || value.publishAnnouncement)) return null;
  if (!content.trim() && !image && !embed && !voice) return null;

  return {
    channelId,
    content,
    forumTitle,
    allowUserMentions: value.allowUserMentions,
    publishAnnouncement: value.publishAnnouncement,
    embed,
    image,
    voice,
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
    if (input.voice) {
      throw new GuildMessageStudioSendError(
        'ボイスメッセージはForumの新規投稿には使用できません。通常チャンネルまたは既存Threadを選択してください',
        400,
      );
    }
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
  if (!response.ok) {
    throw await discordError('アーカイブ済みスレッドを再開できませんでした', response);
  }
}

async function sendChannelMessage(
  token: string,
  input: GuildMessageStudioSendInput,
): Promise<string> {
  const attachment = input.voice ?? input.image;
  const payload = input.voice
    ? {
        flags: VOICE_MESSAGE_FLAG,
        attachments: [
          {
            id: 0,
            filename: input.voice.filename,
            duration_secs: input.voice.durationSeconds,
            waveform: input.voice.waveform,
          },
        ],
      }
    : {
        content: input.content || undefined,
        embeds: input.embed ? [toDiscordEmbed(input.embed)] : undefined,
        allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
        attachments: input.image ? [{ id: 0, filename: input.image.filename }] : undefined,
      };
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {
    method: 'POST',
    headers: attachment
      ? { Authorization: `Bot ${token}` }
      : { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: attachment ? buildMultipart(payload, attachment) : JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
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
    name: resolveForumTitle(input.forumTitle, input.content, input.embed),
    message: {
      content: input.content || undefined,
      embeds: input.embed ? [toDiscordEmbed(input.embed)] : undefined,
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

function parseEmbed(value: unknown): GuildMessageStudioEmbed | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;

  const title = stringValue(value.title);
  const description = stringValue(value.description);
  const color = stringValue(value.color);
  const imageUrl = stringValue(value.imageUrl);
  const thumbnailUrl = stringValue(value.thumbnailUrl);
  const footerText = stringValue(value.footerText);
  if (
    title.length > 256 ||
    description.length > 4096 ||
    footerText.length > 2048 ||
    (color && !EMBED_COLOR_PATTERN.test(color)) ||
    !isSafeHttpUrl(imageUrl) ||
    !isSafeHttpUrl(thumbnailUrl)
  ) {
    return null;
  }

  if (!Array.isArray(value.fields) || value.fields.length > 25) return null;
  const fields: GuildMessageStudioEmbedField[] = [];
  for (const rawField of value.fields) {
    if (!isRecord(rawField)) return null;
    const name = stringValue(rawField.name);
    const fieldValue = stringValue(rawField.value);
    if (!name || !fieldValue || name.length > 256 || fieldValue.length > 1024) return null;
    fields.push({
      name,
      value: fieldValue,
      inline: rawField.inline === true,
    });
  }

  if (!title && !description && !imageUrl && !thumbnailUrl && !footerText && fields.length === 0) {
    return null;
  }
  return {
    title,
    description,
    color: color || '#5865F2',
    imageUrl,
    thumbnailUrl,
    footerText,
    fields,
  };
}

function toDiscordEmbed(embed: GuildMessageStudioEmbed): Record<string, unknown> {
  return {
    title: embed.title || undefined,
    description: embed.description || undefined,
    color: Number.parseInt(embed.color.slice(1), 16),
    image: embed.imageUrl ? { url: embed.imageUrl } : undefined,
    thumbnail: embed.thumbnailUrl ? { url: embed.thumbnailUrl } : undefined,
    footer: embed.footerText ? { text: embed.footerText } : undefined,
    fields: embed.fields.length > 0 ? embed.fields : undefined,
  };
}

function buildMultipart(payload: unknown, attachment: EncodedAttachment): FormData {
  const bytes = decodeBase64(attachment.dataBase64);
  if (!bytes) throw new GuildMessageStudioSendError('添付ファイルを復元できませんでした', 400);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const form = new FormData();
  form.set('payload_json', JSON.stringify(payload));
  form.set(
    'files[0]',
    new Blob([arrayBuffer], { type: attachment.contentType }),
    attachment.filename,
  );
  return form;
}

function parseEncodedAttachment(
  value: Record<string, unknown>,
  maxBytes: number,
): EncodedAttachment | null {
  const filename = typeof value.filename === 'string' ? value.filename.trim() : '';
  const contentType =
    typeof value.contentType === 'string' ? value.contentType.trim().toLowerCase() : '';
  const dataBase64 = typeof value.dataBase64 === 'string' ? value.dataBase64 : '';
  if (
    !filename ||
    filename.length > 100 ||
    !contentType ||
    contentType.length > 100 ||
    !dataBase64
  ) {
    return null;
  }
  const bytes = decodeBase64(dataBase64);
  if (!bytes || bytes.length <= 0 || bytes.length > maxBytes) return null;
  return { filename, contentType, dataBase64 };
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

function resolveForumTitle(
  explicit: string,
  content: string,
  embed: GuildMessageStudioEmbed | null,
): string {
  if (explicit) return explicit.slice(0, 100);
  if (embed?.title) return embed.title.slice(0, 100);
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
  if (!response.ok) {
    throw await discordError('投稿は完了しましたがCrosspostに失敗しました', response);
  }
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isSafeHttpUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
