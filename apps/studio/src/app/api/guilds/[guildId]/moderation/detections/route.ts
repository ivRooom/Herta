import { NextResponse } from 'next/server';
import {
  getModerationDetectionStats,
  listModerationDetections,
  ModerationValidationError,
  type ModerationDetectionKind,
  type ModerationDetectionReviewStatus,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { authorizeGuild } from '@/lib/guild-plugins';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ guildId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { guildId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  const url = new URL(request.url);
  const filters = {
    guildId,
    detectionKind: parseDetectionKind(url.searchParams.get('kind')),
    reviewStatus: parseReviewStatus(url.searchParams.get('status')),
    userId: optionalDiscordId(url.searchParams.get('userId')),
    channelId: optionalDiscordId(url.searchParams.get('channelId')),
    from: parseDate(url.searchParams.get('from'), false),
    toExclusive: parseDate(url.searchParams.get('to'), true),
  };

  try {
    const [result, stats] = await Promise.all([
      listModerationDetections(prisma as unknown as ModerationPrismaClient, {
        ...filters,
        page: parsePositiveInteger(url.searchParams.get('page')),
        pageSize: parsePositiveInteger(url.searchParams.get('pageSize')),
      }),
      getModerationDetectionStats(prisma as unknown as ModerationPrismaClient, filters),
    ]);
    return NextResponse.json({ ...result, stats });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

const DETECTION_KINDS: ModerationDetectionKind[] = [
  'word_exact',
  'word_contains',
  'word_regex',
  'invite_link',
  'mention_burst',
  'message_burst',
  'duplicate_message',
];

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseDetectionKind(value: string | null): ModerationDetectionKind | undefined {
  return DETECTION_KINDS.includes(value as ModerationDetectionKind)
    ? (value as ModerationDetectionKind)
    : undefined;
}

function parseReviewStatus(value: string | null): ModerationDetectionReviewStatus | undefined {
  return value === 'unreviewed' ||
    value === 'confirmed' ||
    value === 'false_positive' ||
    value === 'ignored'
    ? value
    : undefined;
}

function optionalDiscordId(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && /^\d+$/.test(normalized) ? normalized : undefined;
}

function parseDate(value: string | null, endExclusive: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const candidate = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(candidate.getTime())) return null;
  return endExclusive ? new Date(candidate.getTime() + 24 * 60 * 60 * 1000) : candidate;
}

function moderationErrorResponse(error: unknown): NextResponse {
  if (error instanceof ModerationValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error('Moderation detection API request failed', error);
  return NextResponse.json({ error: '自動検知履歴の取得に失敗しました' }, { status: 500 });
}
