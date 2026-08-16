export const MESSAGE_STUDIO_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MESSAGE_STUDIO_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export interface MessageStudioImageAttachment {
  bytes: Uint8Array;
  filename: string;
  contentType: (typeof MESSAGE_STUDIO_IMAGE_MIME_TYPES)[number];
}

export interface MessageStudioImmediateEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface MessageStudioImmediateEmbed {
  title: string;
  description: string;
  color: string;
  imageUrl: string;
  thumbnailUrl: string;
  footerText: string;
  fields: MessageStudioImmediateEmbedField[];
}

export interface SendMessageStudioMessageInput {
  guildId: string;
  channelId: string;
  content: string;
  forumTitle: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  embed: MessageStudioImmediateEmbed | null;
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
  const extension =
    {
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
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  const secret = process.env['BOT_INTERNAL_API_SECRET']?.trim();
  if (!healthUrl || !secret || secret.length < 32) {
    throw new MessageStudioDiscordError('Bot内部送信APIが設定されていません', 503);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(`/internal/guilds/${input.guildId}/message-studio/send`, healthUrl);
  } catch {
    throw new MessageStudioDiscordError('Bot内部送信APIのURLが不正です', 503);
  }

  const image = input.attachment
    ? {
        filename: input.attachment.filename,
        contentType: input.attachment.contentType,
        dataBase64: Buffer.from(input.attachment.bytes).toString('base64'),
      }
    : null;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        channelId: input.channelId,
        content: input.content,
        forumTitle: input.forumTitle,
        allowUserMentions: input.allowUserMentions,
        publishAnnouncement: input.publishAnnouncement,
        embed: input.embed,
        image,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new MessageStudioDiscordError('Botへの送信がタイムアウトしました', 504);
    }
    throw new MessageStudioDiscordError('Bot内部送信APIへ接続できませんでした', 503);
  }

  const body = (await response.json().catch(() => null)) as {
    result?: SendMessageStudioMessageResult;
    status?: string;
  } | null;
  if (!response.ok || !body?.result) {
    const message =
      {
        400: '投稿内容または投稿先が不正です',
        401: 'Bot内部送信APIの認証に失敗しました',
        403: '選択した投稿先へ送信できません',
        409: '投稿先の状態により送信できません',
        413: '画像データが大きすぎます',
        429: 'Discordの送信制限に達しました',
      }[response.status] ?? 'Discordへの投稿に失敗しました';
    throw new MessageStudioDiscordError(message, response.status || 502);
  }
  return body.result;
}
