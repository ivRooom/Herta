import { NextResponse } from 'next/server';
import { normalizeDailyContentConfig } from '@herta/plugin-catalog/daily-content-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';
import {
  MessageStudioDiscordError,
  sanitizeMessageStudioFilename,
  sendMessageStudioMessage,
  validateMessageStudioImageFile,
  type MessageStudioImageAttachment,
  type MessageStudioImmediateEmbed,
} from '@/lib/message-studio-discord';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ guildId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正な送信元からのリクエストです' }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: '送信データを読み込めませんでした' }, { status: 400 });
  }

  const channelId = formText(form, 'channelId');
  const content = formText(form, 'content');
  const forumTitle = formText(form, 'forumTitle');
  const publishAnnouncement = formText(form, 'publishAnnouncement') === 'true';
  const rawAttachment = form.get('image');
  const rawEmbed = formText(form, 'embed');

  try {
    const plugin = await getGuildPlugin(guildId, 'daily-content');
    if (!plugin?.enabled) {
      return NextResponse.json(
        { error: 'Announcement / Message Studio Pluginが無効です' },
        { status: 409 },
      );
    }
    const config = normalizeDailyContentConfig(plugin.config);
    if (!/^\d+$/u.test(channelId)) {
      return NextResponse.json({ error: '投稿先を選択してください' }, { status: 400 });
    }
    if (content.length > config.maxContentLength) {
      return NextResponse.json(
        { error: `本文は${config.maxContentLength}文字以下にしてください` },
        { status: 400 },
      );
    }

    const embed = parseImmediateEmbed(rawEmbed);
    if (rawEmbed && !embed) {
      return NextResponse.json({ error: 'Embedの入力内容が不正です' }, { status: 400 });
    }

    let attachment: MessageStudioImageAttachment | null = null;
    if (rawAttachment instanceof File && rawAttachment.size > 0) {
      const fileError = validateMessageStudioImageFile(rawAttachment);
      if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
      attachment = {
        bytes: new Uint8Array(await rawAttachment.arrayBuffer()),
        filename: sanitizeMessageStudioFilename(rawAttachment.name, rawAttachment.type),
        contentType: rawAttachment.type as MessageStudioImageAttachment['contentType'],
      };
    }
    if (!content.trim() && !attachment && !embed) {
      return NextResponse.json(
        { error: '本文・Embed・画像のいずれかを入力してください' },
        { status: 400 },
      );
    }

    const result = await sendMessageStudioMessage({
      guildId,
      channelId,
      content,
      forumTitle,
      allowUserMentions: config.allowUserMentions,
      publishAnnouncement: publishAnnouncement && config.allowAnnouncementCrosspost,
      embed,
      attachment,
    });

    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: 'message_studio.send',
        targetType: result.threadId ? 'discord_forum_thread' : 'discord_message',
        targetId: result.threadId ?? result.messageId,
        metadata: {
          channelId,
          messageId: result.messageId,
          threadId: result.threadId,
          channelType: result.channelType,
          hasAttachment: attachment !== null,
          hasEmbed: embed !== null,
          contentLength: content.length,
        },
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof MessageStudioDiscordError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('Message Studio immediate send failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      guildId,
    });
    return NextResponse.json({ error: 'Botでの発言に失敗しました' }, { status: 500 });
  }
}

function parseImmediateEmbed(value: string): MessageStudioImmediateEmbed | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const title = text(parsed.title);
  const description = text(parsed.description);
  const color = text(parsed.color) || '#5865F2';
  const imageUrl = text(parsed.imageUrl);
  const thumbnailUrl = text(parsed.thumbnailUrl);
  const footerText = text(parsed.footerText);
  if (
    title.length > 256 ||
    description.length > 4096 ||
    footerText.length > 2048 ||
    !/^#[0-9A-Fa-f]{6}$/u.test(color) ||
    !isSafeHttpUrl(imageUrl) ||
    !isSafeHttpUrl(thumbnailUrl) ||
    !Array.isArray(parsed.fields) ||
    parsed.fields.length > 25
  ) {
    return null;
  }
  const fields: MessageStudioImmediateEmbed['fields'] = [];
  for (const rawField of parsed.fields) {
    if (!isRecord(rawField)) return null;
    const name = text(rawField.name);
    const fieldValue = text(rawField.value);
    if (!name || !fieldValue || name.length > 256 || fieldValue.length > 1024) return null;
    fields.push({ name, value: fieldValue, inline: rawField.inline === true });
  }
  if (!title && !description && !imageUrl && !thumbnailUrl && !footerText && fields.length === 0) {
    return null;
  }
  return { title, description, color, imageUrl, thumbnailUrl, footerText, fields };
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trimEnd() : '';
}

function text(value: unknown): string {
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
