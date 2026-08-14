import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  BirthdayAdminValidationError,
  listBirthdayRegistrations,
  removeBirthdayRegistration,
  setBirthdayRegistration,
} from '@/lib/birthday-admin';
import { birthdayMemberEligibility, parseBirthdayAdminRequest } from '@/lib/birthday-admin-core';
import { searchGuildMembers } from '@/lib/bot-guild-members';
import { authorizeGuild } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type GuildRouteContext = { params: Promise<{ guildId: string }> };

export async function GET(_request: Request, { params }: GuildRouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;
  try {
    return NextResponse.json(
      { registrations: await listBirthdayRegistrations(guildId) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return birthdayAdminErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: GuildRouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const body = await request.json().catch(() => null);
  const parsed = parseBirthdayAdminRequest(body);
  if (!parsed) {
    return NextResponse.json({ error: '誕生日管理操作の入力が不正です' }, { status: 400 });
  }

  try {
    if (parsed.action === 'set') {
      if (parsed.month === null || parsed.day === null) {
        return NextResponse.json({ error: '誕生日の月日が不正です' }, { status: 400 });
      }

      const members = await searchGuildMembers(guildId, parsed.userId, 1);
      if (!members) {
        return NextResponse.json(
          { error: 'Discordメンバーを確認できないため、誕生日を保存できませんでした' },
          { status: 503 },
        );
      }
      const eligibility = birthdayMemberEligibility(parsed.userId, members);
      if (eligibility === 'not-found') {
        return NextResponse.json(
          { error: '対象ユーザーは現在このDiscordサーバーに所属していません' },
          { status: 400 },
        );
      }
      if (eligibility === 'bot') {
        return NextResponse.json(
          { error: 'Botアカウントは誕生日登録の対象にできません' },
          { status: 400 },
        );
      }

      await setBirthdayRegistration({
        guildId,
        actorId: session.user.id,
        userId: parsed.userId,
        month: parsed.month,
        day: parsed.day,
      });
    } else {
      await removeBirthdayRegistration({
        guildId,
        actorId: session.user.id,
        userId: parsed.userId,
      });
    }
    return NextResponse.json({ registrations: await listBirthdayRegistrations(guildId) });
  } catch (error) {
    return birthdayAdminErrorResponse(error);
  }
}

function birthdayAdminErrorResponse(error: unknown): NextResponse {
  if (error instanceof BirthdayAdminValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Birthday admin API request failed', error);
  return NextResponse.json({ error: '誕生日管理操作に失敗しました' }, { status: 500 });
}
