import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  BirthdayAdminValidationError,
  listBirthdayRegistrations,
  removeBirthdayRegistration,
  setBirthdayRegistration,
} from '@/lib/birthday-admin';
import {
  birthdayMemberEligibility,
  parseBirthdayAdminRequest,
  type BirthdayRegistration,
} from '@/lib/birthday-admin-core';
import { searchGuildMembers } from '@/lib/bot-guild-members';
import { readBoundedRequestBody, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';
import { studioBirthdayResource } from '@/lib/studio-policy-resources';

export const dynamic = 'force-dynamic';

const BIRTHDAY_ADMIN_BODY_MAX_BYTES = 8 * 1024;

type GuildRouteContext = { params: Promise<{ guildId: string }> };

export async function GET(_request: Request, { params }: GuildRouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { guildId } = await params;
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;

  if (!canReadBirthdayRegistrations(access.access, guildId)) {
    return birthdayPermissionDenied('メンバー誕生日を閲覧する権限がありません');
  }

  try {
    const registrations = await listBirthdayRegistrations(guildId);
    return NextResponse.json(
      {
        registrations: redactCelebrationStats(
          registrations,
          canReadBirthdayCelebrations(access.access, guildId),
        ),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return birthdayAdminErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: GuildRouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なOriginです' }, { status: 403 });
  }

  const { guildId } = await params;
  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;

  if (
    !hasEffectivePluginPermission(
      access.access,
      'studio.settings.write',
      studioBirthdayResource(guildId, 'registrations'),
    )
  ) {
    return birthdayPermissionDenied('メンバー誕生日を編集する権限がありません');
  }

  let body: unknown;
  try {
    const rawBody = await readBoundedRequestBody(request, BIRTHDAY_ADMIN_BODY_MAX_BYTES);
    body = JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'リクエストが大きすぎます' }, { status: 413 });
    }
    return NextResponse.json({ error: 'JSON形式が不正です' }, { status: 400 });
  }

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
        birthYear: parsed.birthYear,
      });
    } else {
      await removeBirthdayRegistration({
        guildId,
        actorId: session.user.id,
        userId: parsed.userId,
      });
    }

    const canReadRegistrations = canReadBirthdayRegistrations(access.access, guildId);
    if (!canReadRegistrations) {
      return NextResponse.json({ updated: true });
    }

    const registrations = await listBirthdayRegistrations(guildId);
    return NextResponse.json(
      {
        updated: true,
        registrations: redactCelebrationStats(
          registrations,
          canReadBirthdayCelebrations(access.access, guildId),
        ),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return birthdayAdminErrorResponse(error);
  }
}

function canReadBirthdayRegistrations(
  access: Parameters<typeof hasEffectivePluginPermission>[0],
  guildId: string,
): boolean {
  return hasEffectivePluginPermission(
    access,
    'studio.settings.read',
    studioBirthdayResource(guildId, 'registrations'),
  );
}

function canReadBirthdayCelebrations(
  access: Parameters<typeof hasEffectivePluginPermission>[0],
  guildId: string,
): boolean {
  return hasEffectivePluginPermission(
    access,
    'studio.settings.read',
    studioBirthdayResource(guildId, 'celebrations'),
  );
}

function redactCelebrationStats(
  registrations: readonly BirthdayRegistration[],
  canReadCelebrations: boolean,
): BirthdayRegistration[] {
  if (canReadCelebrations) return [...registrations];
  return registrations.map(
    ({
      latestAge: _age,
      latestServerBirthdayNumber: _number,
      celebrationCount: _count,
      ...registration
    }) => registration,
  );
}

function birthdayPermissionDenied(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

function birthdayAdminErrorResponse(error: unknown): NextResponse {
  if (error instanceof BirthdayAdminValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Birthday admin API request failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  return NextResponse.json({ error: '誕生日管理操作に失敗しました' }, { status: 500 });
}
