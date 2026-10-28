import { NextResponse } from 'next/server';
import { getUserDataConsent } from '@herta/db';
import { auth } from '@/auth';
import { getGuildMemberById } from '@/lib/bot-guild-members';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { resolveStudioAccess } from '@/lib/studio-access';
import { hasEffectivePluginPermission } from '@/lib/studio-plugin-permissions';
import { studioVoiceConsentResource } from '@/lib/studio-policy-resources';
import { setVoiceConsentAsAdmin, VoiceConsentRefusedError } from '@/lib/vc-recap-consent-admin';

export const dynamic = 'force-dynamic';

const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

type GuildRouteContext = { params: Promise<{ guildId: string }> };

export async function GET(request: Request, { params }: GuildRouteContext) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: '認証が必要です' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;
  if (
    !hasEffectivePluginPermission(
      access.access,
      'studio.settings.read',
      studioVoiceConsentResource(guildId),
    )
  ) {
    return NextResponse.json(
      { error: 'VC同意状態を閲覧する権限がありません' },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const userId = new URL(request.url).searchParams.get('userId')?.trim() ?? '';
  if (!DISCORD_ID_PATTERN.test(userId)) {
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

  const consent = await getUserDataConsent(prisma, userId);
  return NextResponse.json(
    {
      member: { userId: member.id, displayName: member.displayName, avatarUrl: member.avatarUrl },
      consent: {
        voiceTranscriptionConsent: consent.voiceTranscriptionConsent,
        updatedAt: consent.updatedAt.toISOString(),
      },
    },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function POST(request: Request, { params }: GuildRouteContext) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: '認証が必要です' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json(
      { error: '不正なOriginです' },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const access = await resolveStudioAccess(guildId, session.user.id);
  if (!access.ok) return access.response;
  if (
    !hasEffectivePluginPermission(
      access.access,
      'studio.settings.write',
      studioVoiceConsentResource(guildId),
    )
  ) {
    return NextResponse.json(
      { error: 'VC同意状態を変更する権限がありません' },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const consent = body?.consent;
  if (!DISCORD_ID_PATTERN.test(userId) || typeof consent !== 'boolean') {
    return NextResponse.json(
      { error: 'リクエストが不正です' },
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

  try {
    await setVoiceConsentAsAdmin(prisma, { guildId, actorId: session.user.id, userId, consent });
  } catch (error) {
    if (error instanceof VoiceConsentRefusedError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    throw error;
  }
  return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE_HEADERS });
}
