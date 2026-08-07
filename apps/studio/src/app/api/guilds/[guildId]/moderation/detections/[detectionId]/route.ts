import { NextResponse } from 'next/server';
import {
  createModerationCaseFromDetection,
  ModerationValidationError,
  normalizeModerationConfig,
  reviewModerationDetection,
  shouldAutoCreateCaseOnConfirmed,
  type ModerationDetectionReviewStatus,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { authorizeGuild, getGuildPlugin } from '@/lib/guild-plugins';
import { prisma } from '@/lib/db';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; detectionId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { guildId, detectionId } = await params;
  const authorization = await authorizeGuild(guildId, session.user.id);
  if ('response' in authorization) return authorization.response;

  try {
    const body = await readBody(request);
    const result = await reviewModerationDetection(prisma as unknown as ModerationPrismaClient, {
      guildId,
      detectionId,
      actorId: session.user.id,
      reviewStatus: parseReviewStatus(body.reviewStatus),
      reviewNote: parseReviewNote(body.reviewNote),
    });
    if (!result) {
      return NextResponse.json({ error: '検知履歴が見つかりません' }, { status: 404 });
    }

    const automaticCase = await maybeCreateAutomaticCase({
      guildId,
      actorId: session.user.id,
      detection: result,
    });
    return NextResponse.json({ ...result, automaticCase });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'JSON形式が不正です' }, { status: 400 });
    }
    if (error instanceof ModerationValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Moderation detection review failed', error);
    return NextResponse.json({ error: 'レビューの保存に失敗しました' }, { status: 500 });
  }
}

async function maybeCreateAutomaticCase({
  guildId,
  actorId,
  detection,
}: {
  guildId: string;
  actorId: string;
  detection: {
    id: string;
    detectionKind: Parameters<typeof shouldAutoCreateCaseOnConfirmed>[1]['detectionKind'];
    ruleIndex: number | null;
    reviewStatus: ModerationDetectionReviewStatus;
  };
}) {
  if (detection.reviewStatus !== 'confirmed') return null;

  const plugin = await getGuildPlugin(guildId, 'moderation');
  if (!plugin?.enabled) return null;
  const config = normalizeModerationConfig(plugin.config);
  if (
    !shouldAutoCreateCaseOnConfirmed(config, {
      detectionKind: detection.detectionKind,
      ruleIndex: detection.ruleIndex,
    })
  ) {
    return null;
  }

  return createModerationCaseFromDetection(prisma as unknown as ModerationPrismaClient, {
    guildId,
    detectionId: detection.id,
    actorId,
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json()) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ModerationValidationError('リクエスト本文が不正です');
  }
  return body as Record<string, unknown>;
}

function parseReviewStatus(value: unknown): ModerationDetectionReviewStatus {
  if (
    value === 'unreviewed' ||
    value === 'confirmed' ||
    value === 'false_positive' ||
    value === 'ignored'
  ) {
    return value;
  }
  throw new ModerationValidationError('レビュー状態が不正です');
}

function parseReviewNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ModerationValidationError('レビュー備考が不正です');
  }
  return value;
}
