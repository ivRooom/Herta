import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readRequestBodyBytes } from '@/lib/bounded-request-body';
import {
  matchesBotAvatarSignature,
  parseBotNickname,
  validateBotAvatarMetadata,
} from '@/lib/bot-profile-input';
import {
  DiscordBotProfileError,
  getDiscordBotGuildProfile,
  updateDiscordBotGuildProfile,
} from '@/lib/discord-bot-profile';
import { prisma } from '@/lib/db';
import { authorizeGuild } from '@/lib/guild-plugins';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const MAX_FORM_BODY_BYTES = 1_500_000;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    return NextResponse.json({ profile: await getDiscordBotGuildProfile(guildId) });
  } catch (error) {
    return botProfileErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  let formData: FormData;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      return NextResponse.json({ error: 'フォームデータが不正です' }, { status: 400 });
    }
    const body = await readRequestBodyBytes(request, MAX_FORM_BODY_BYTES);
    formData = await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'アップロードサイズが大きすぎます' }, { status: 413 });
    }
    return NextResponse.json({ error: 'フォームデータが不正です' }, { status: 400 });
  }

  const nickname = parseBotNickname(formData.get('nickname'));
  if (nickname === undefined) {
    return NextResponse.json({ error: 'Nicknameは32文字以内で指定してください' }, { status: 400 });
  }

  const avatarAction = formData.get('avatarAction');
  if (avatarAction !== 'keep' && avatarAction !== 'replace' && avatarAction !== 'reset') {
    return NextResponse.json({ error: 'Avatar操作が不正です' }, { status: 400 });
  }

  let avatar: string | null | undefined;
  if (avatarAction === 'reset') {
    avatar = null;
  } else if (avatarAction === 'replace') {
    const file = formData.get('avatar');
    if (!(file instanceof File) || !validateBotAvatarMetadata(file)) {
      return NextResponse.json(
        { error: 'Avatarは1MiB以下のPNG/JPEG/GIFを指定してください' },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesBotAvatarSignature(file.type, bytes)) {
      return NextResponse.json(
        { error: 'Avatarの画像形式とデータが一致しません' },
        { status: 400 },
      );
    }
    avatar = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  try {
    const previousProfile = await getDiscordBotGuildProfile(guildId);
    const profile = await updateDiscordBotGuildProfile(guildId, { nickname, avatar });
    try {
      await prisma.auditLog.create({
        data: {
          guildId,
          actorId: session.user.id,
          event: 'bot_profile.updated',
          targetType: 'bot_member',
          targetId: profile.userId,
          changes: {
            nicknameChanged: previousProfile.nickname !== profile.nickname,
            avatarAction,
          },
          metadata: { operationSource: 'studio' },
        },
      });
    } catch (error) {
      console.error('Botプロフィール更新の監査ログ保存に失敗しました', {
        guildId,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      return NextResponse.json(
        {
          profile,
          error: 'Discordへの変更は反映されましたが、監査ログを保存できませんでした',
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ profile });
  } catch (error) {
    return botProfileErrorResponse(error);
  }
}

function botProfileErrorResponse(error: unknown): Response {
  if (!(error instanceof DiscordBotProfileError)) {
    console.error('Botプロフィール処理で内部エラーが発生しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Botプロフィールを更新できませんでした' }, { status: 500 });
  }

  if (error.status === 429) {
    return NextResponse.json(
      { error: 'Discordのレート制限中です。少し時間を空けて再実行してください' },
      { status: 429 },
    );
  }
  if (error.status === 503) {
    return NextResponse.json(
      { error: 'Bot内部APIの設定または接続状態を確認してください' },
      { status: 503 },
    );
  }
  if (error.status === 404) {
    return NextResponse.json(
      { error: '選択したサーバーでBotを確認できませんでした' },
      { status: 502 },
    );
  }

  return NextResponse.json({ error: 'Bot内部APIへ接続できませんでした' }, { status: 502 });
}
