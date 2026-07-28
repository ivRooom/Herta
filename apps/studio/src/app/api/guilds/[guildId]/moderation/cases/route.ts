import { NextResponse } from 'next/server';
import {
  listModerationCases,
  ModerationValidationError,
  type ModerationAction,
  type ModerationCaseStatus,
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
  try {
    const result = await listModerationCases(prisma as unknown as ModerationPrismaClient, {
      guildId,
      page: parsePositiveInteger(url.searchParams.get('page')),
      pageSize: parsePositiveInteger(url.searchParams.get('pageSize')),
      search: url.searchParams.get('search') ?? undefined,
      action: parseAction(url.searchParams.get('action')),
      status: parseStatus(url.searchParams.get('status')),
      targetUserId: optionalDiscordId(url.searchParams.get('targetUserId')),
      from: parseDate(url.searchParams.get('from'), false),
      toExclusive: parseDate(url.searchParams.get('to'), true),
    });
    return NextResponse.json(result);
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAction(value: string | null): ModerationAction | undefined {
  return value === 'warn' || value === 'timeout' || value === 'kick' || value === 'ban'
    ? value
    : undefined;
}

function parseStatus(value: string | null): ModerationCaseStatus | undefined {
  return value === 'active' || value === 'completed' || value === 'revoked' || value === 'failed'
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
  console.error('Moderation API request failed', error);
  return NextResponse.json({ error: 'モデレーションケースの取得に失敗しました' }, { status: 500 });
}
