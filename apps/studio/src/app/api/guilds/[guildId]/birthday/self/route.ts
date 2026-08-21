import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  BirthdayAdminValidationError,
  getBirthdayRegistration,
  removeBirthdayRegistration,
  setBirthdayRegistration,
} from '@/lib/birthday-admin';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { resolveBirthdaySelfRegistrationAccess } from '@/lib/birthday-self-registration-access';
import { parseBirthdaySelfRegistrationRequest } from '@/lib/birthday-self-registration-core';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const MAX_JSON_BYTES = 2 * 1024;
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const context = await authorizeSelfRegistration(params);
  if (!context.ok) return context.response;

  const registration = await getBirthdayRegistration(context.guildId, context.userId);
  return json({ registration });
}

export async function POST(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  if (!isSameOriginMutationRequest(request)) {
    return json({ error: '不正な送信元からのリクエストです' }, 403);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'application/jsonが必要です' }, 415);
  }

  const context = await authorizeSelfRegistration(params);
  if (!context.ok) return context.response;

  let raw: unknown;
  try {
    raw = await readJsonBodyWithLimit(request, MAX_JSON_BYTES);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? '登録データが大きすぎます'
            : '登録データを読み取れませんでした',
      },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  const input = parseBirthdaySelfRegistrationRequest(raw);
  if (!input) return json({ error: '誕生日または生年が不正です' }, 400);

  try {
    const registration = await setBirthdayRegistration({
      guildId: context.guildId,
      actorId: context.userId,
      userId: context.userId,
      month: input.month,
      day: input.day,
      birthYear: input.birthYear,
      operationSource: 'discord',
    });
    return json({ registration }, 200);
  } catch (error) {
    if (error instanceof BirthdayAdminValidationError) {
      return json({ error: error.message }, 400);
    }
    console.error('Birthday self registration failed', {
      guildId: context.guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return json({ error: '誕生日を登録できませんでした' }, 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  if (!isSameOriginMutationRequest(request)) {
    return json({ error: '不正な送信元からのリクエストです' }, 403);
  }

  const context = await authorizeSelfRegistration(params);
  if (!context.ok) return context.response;

  try {
    const deleted = await removeBirthdayRegistration({
      guildId: context.guildId,
      actorId: context.userId,
      userId: context.userId,
      operationSource: 'discord',
    });
    return json({ deleted });
  } catch (error) {
    console.error('Birthday self registration removal failed', {
      guildId: context.guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return json({ error: '誕生日登録を削除できませんでした' }, 500);
  }
}

async function authorizeSelfRegistration(params: Promise<{ guildId: string }>) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, response: json({ error: '認証が必要です' }, 401) };
  }

  const { guildId } = await params;
  if (!DISCORD_ID_PATTERN.test(guildId)) {
    return { ok: false as const, response: json({ error: 'Guild IDが不正です' }, 400) };
  }

  const access = await resolveBirthdaySelfRegistrationAccess(guildId, session.user.id);
  if (!access.ok) {
    if (access.reason === 'unavailable') {
      return {
        ok: false as const,
        response: json(
          { error: 'Discordメンバー情報を確認できません。時間を置いて再試行してください' },
          503,
        ),
      };
    }
    return {
      ok: false as const,
      response: json(
        { error: 'この誕生日登録URLは現在対象Guildに参加しているユーザーだけが利用できます' },
        403,
      ),
    };
  }

  return { ok: true as const, guildId, userId: session.user.id, displayName: access.displayName };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}
