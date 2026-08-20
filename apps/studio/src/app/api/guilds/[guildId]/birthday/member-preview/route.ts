import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getBirthdayRegistration } from '@/lib/birthday-admin';
import { BIRTHDAY_ADMIN_DISCORD_ID_PATTERN } from '@/lib/birthday-admin-core';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { authorizeEffectiveStudioPermission } from '@/lib/studio-access';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: '認証が必要です' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const access = await authorizeEffectiveStudioPermission(
    guildId,
    session.user.id,
    'studio.settings.read',
    studioBirthdayResource(guildId, 'registrations'),
  );
  if (!access.ok) return access.response;

  const userId = new URL(request.url).searchParams.get('userId')?.trim() ?? '';
  if (!BIRTHDAY_ADMIN_DISCORD_ID_PATTERN.test(userId)) {
    return NextResponse.json(
      { error: 'DiscordユーザーIDが不正です' },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const member = await getGuildMemberById(guildId, userId);
  if (!member || member.bot) {
    return NextResponse.json(
      { error: 'このGuildのDiscordメンバーを確認できませんでした' },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const registration = await getBirthdayRegistration(guildId, userId);
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  const birthdayPassed =
    registration !== null &&
    (currentMonth > registration.month ||
      (currentMonth === registration.month && currentDay >= registration.day));

  return NextResponse.json(
    {
      member: {
        userId: member.id,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        birthday: registration
          ? {
              month: registration.month,
              day: registration.day,
              age:
                registration.birthYear === null
                  ? null
                  : Math.max(0, currentYear - registration.birthYear - (birthdayPassed ? 0 : 1)),
            }
          : null,
      },
    },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}
