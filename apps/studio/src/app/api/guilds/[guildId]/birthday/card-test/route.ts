import { inspectBirthdayCardBackgroundImage } from '@herta/shared';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { readRequestBodyBytes, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { parseBirthdayCardTestUserId } from '@/lib/birthday-card-test-send';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { prisma } from '@/lib/db';
import {
  MessageStudioDiscordError,
  sendMessageStudioMessage,
  type MessageStudioImageAttachment,
} from '@/lib/message-studio-discord';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { authorizeStudioPermission } from '@/lib/studio-access';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

const DISCORD_ID_PATTERN = /^\d+$/u;
const TEST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_REQUEST_BYTES = TEST_IMAGE_MAX_BYTES + 256 * 1024;
const TEST_SEND_RATE_LIMIT = 5;
const TEST_SEND_WINDOW_MS = 60_000;
const TEST_SEND_ATTEMPT_EVENT = 'birthday_card.test_send_attempt';

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正な送信元からのリクエストです' }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const access = await authorizeStudioPermission(
    guildId,
    session.user.id,
    'studio.operation.execute',
    studioBirthdayResource(guildId, 'card-test-send'),
  );
  if (!access.ok) return access.response;

  const recent = await prisma.auditLog.count({
    where: {
      guildId,
      actorId: session.user.id,
      event: TEST_SEND_ATTEMPT_EVENT,
      createdAt: { gte: new Date(Date.now() - TEST_SEND_WINDOW_MS) },
    },
  });
  if (recent >= TEST_SEND_RATE_LIMIT) {
    return NextResponse.json(
      { error: 'テスト送信が連続しています。少し待ってから再実行してください' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  // 成否や入力validation結果に依存せず、認可済みの試行そのものをrate-limitへ計上する。
  // Bot / Discord側で失敗し続けるリクエストでも内部APIへ無制限に到達させない。
  await prisma.auditLog.create({
    data: {
      guildId,
      actorId: session.user.id,
      event: TEST_SEND_ATTEMPT_EVENT,
      targetType: 'birthday_card',
      targetId: guildId,
    },
  });

  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-dataが必要です' }, { status: 415 });
  }

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readRequestBodyBytes(request, MAX_MULTIPART_REQUEST_BYTES);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? 'テスト送信データが大きすぎます'
            : 'テスト送信データを読み取れませんでした',
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const replay = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body,
  });
  let form: FormData;
  try {
    form = await replay.formData();
  } catch {
    return NextResponse.json({ error: 'テスト送信データが不正です' }, { status: 400 });
  }

  const channelId = formText(form, 'channelId');
  if (!DISCORD_ID_PATTERN.test(channelId)) {
    return NextResponse.json({ error: '送信先Channelを選択してください' }, { status: 400 });
  }

  const previewUserId = parseBirthdayCardTestUserId(form.get('userId'));
  if (!previewUserId.ok) {
    return NextResponse.json({ error: 'テスト対象メンバーが不正です' }, { status: 400 });
  }

  let previewMemberId: string | null = null;
  if (previewUserId.userId) {
    const member = await getGuildMemberById(guildId, previewUserId.userId);
    if (!member || member.bot) {
      return NextResponse.json(
        { error: 'テスト対象メンバーをこのGuildで確認できませんでした' },
        { status: 404 },
      );
    }
    previewMemberId = member.id;
  }

  const rawImage = form.get('image');
  if (!(rawImage instanceof File) || rawImage.size <= 0 || rawImage.size > TEST_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: 'Birthday Card画像が不正です' }, { status: 400 });
  }
  const bytes = new Uint8Array(await rawImage.arrayBuffer());
  const imageInfo = inspectBirthdayCardBackgroundImage(bytes);
  if (!imageInfo || imageInfo.contentType !== 'image/png') {
    return NextResponse.json({ error: 'テスト送信には有効なPNG画像が必要です' }, { status: 400 });
  }

  const attachment: MessageStudioImageAttachment = {
    bytes,
    filename: 'birthday-card-preview.png',
    contentType: 'image/png',
  };

  try {
    const result = await sendMessageStudioMessage({
      guildId,
      channelId,
      content: '🎂 Birthday Card Test Preview',
      forumTitle: '',
      allowUserMentions: false,
      publishAnnouncement: false,
      embed: null,
      attachment,
      voice: null,
    });
    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: session.user.id,
        event: 'birthday_card.test_send',
        targetType: 'discord_message',
        targetId: result.messageId,
        metadata: {
          channelId,
          messageId: result.messageId,
          channelType: result.channelType,
          imageBytes: bytes.byteLength,
          previewMemberId,
          previewMode: previewMemberId ? 'member' : 'sample',
        },
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof MessageStudioDiscordError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('Birthday Card test send failed', {
      guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Birthday Cardのテスト送信に失敗しました' }, { status: 500 });
  }
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
