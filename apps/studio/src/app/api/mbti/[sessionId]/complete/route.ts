import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  completeMbtiWebQuizSession,
  getMbtiWebQuizSessionRecord,
  resolveMbtiWebQuizSessionForAnswer,
  syncAchievementUnlocks,
} from '@herta/db';
import {
  createMbtiScoreSnapshot,
  computeMbtiIdentity,
  computeMbtiType,
  createEmptyMbtiScores,
  toLegacyMbtiAnswers,
  type MbtiAxis,
  type MbtiScores,
  type MbtiSessionAnswer,
} from '@herta/shared/mbti-core';
import { pushMbtiResultToIvrmWeb, resolveMbtiIvrmSyncConfig } from '@herta/shared/mbti-ivrm-sync';
import { prisma } from '@/lib/db';
import { reconcileMbtiRoleForWebQuiz } from '@/lib/mbti-role-reconciliation';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** packages/shared/src/achievement-catalog.ts記載のID。apps/bot/src/plugins/mbti.tsの
 * MBTI_COMPLETION_ACHIEVEMENT_IDと同じ文字列(Discordフローと同じAchievementを解除する)。 */
const MBTI_COMPLETION_ACHIEVEMENT_ID = 'personality-explorer';
const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  if (!isSameOriginMutationRequest(request)) {
    return json({ error: '不正な送信元からのリクエストです' }, 403);
  }

  const { sessionId } = await params;
  if (!UUID_PATTERN.test(sessionId)) {
    return json({ error: 'リンクが正しくありません' }, 400);
  }

  const resolution = await resolveMbtiWebQuizSessionForAnswer(prisma, sessionId);
  if (!resolution.ok && resolution.reason === 'already_completed') {
    const completed = await getMbtiWebQuizSessionRecord(prisma, sessionId);
    if (completed?.resultType && completed.resultIdentity) {
      return json({
        resultType: completed.resultType,
        resultIdentity: completed.resultIdentity,
        scores: { ...createEmptyMbtiScores(), ...completed.scores },
        roleNote: null,
      });
    }
  }
  if (!resolution.ok) {
    return json(
      { error: toErrorMessage(resolution.reason) },
      resolution.reason === 'not_found' ? 404 : resolution.reason === 'expired' ? 410 : 409,
    );
  }

  const { session } = resolution;
  if (session.answers.length !== session.questionOrder.length) {
    return json({ error: 'すべての設問に回答してから完了してください' }, 409);
  }

  const scores: MbtiScores = {
    ...createEmptyMbtiScores(),
    ...(session.scores as Partial<MbtiScores>),
  };
  const resultType = computeMbtiType(scores);
  const resultIdentity = computeMbtiIdentity(scores);

  const completedAt = new Date();
  const completed = await completeMbtiWebQuizSession(prisma, sessionId, {
    resultType,
    resultIdentity,
    history: {
      completionKey: `web:${sessionId}`,
      guildId: session.guildId,
      discordUserId: session.discordUserId,
      resultType,
      resultIdentity,
      ...createMbtiScoreSnapshot(scores),
      source: 'web',
      completedAt,
    },
    stats: {
      guildId: session.guildId,
      resultType,
      eiScore: scores.EI,
      snScore: scores.SN,
      tfScore: scores.TF,
      jpScore: scores.JP,
      answers: toLegacyMbtiAnswers(
        session.answers.map((entry): MbtiSessionAnswer => ({
          questionIndex: entry.questionIndex,
          axis: entry.axis as MbtiAxis,
          answer: entry.answer as MbtiSessionAnswer['answer'],
        })),
      ),
    },
  });
  if (!completed)
    return json({ error: 'この診断は既に完了しているか、有効期限が切れています' }, 409);

  try {
    await syncAchievementUnlocks(prisma, session.guildId, session.discordUserId, [
      MBTI_COMPLETION_ACHIEVEMENT_ID,
    ]);
  } catch (error) {
    console.error('MBTI Web診断完了Achievementの解除に失敗しました', {
      guildId: session.guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  const ivrmConfig = resolveMbtiIvrmSyncConfig(process.env);
  if (ivrmConfig) {
    try {
      await pushMbtiResultToIvrmWeb(
        ivrmConfig,
        {
          eventId: randomUUID(),
          discordUserId: session.discordUserId,
          mbtiType: resultType,
          mbtiIdentity: resultIdentity,
          occurredAt: completedAt.toISOString(),
        },
        { warn: (obj, msg) => console.warn(msg, obj) },
      );
    } catch (error) {
      console.error('ivrm-webへのMBTI Web診断結果同期に失敗しました', {
        guildId: session.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  let roleNote: string | null = null;
  try {
    const result = await reconcileMbtiRoleForWebQuiz(
      session.guildId,
      session.discordUserId,
      resultType,
    );
    if (result.addedRoleName) roleNote = `@${result.addedRoleName} を付与しました`;
  } catch (error) {
    console.error('MBTI Web診断のRole付与に失敗しました', {
      guildId: session.guildId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  return json({ resultType, resultIdentity, scores, roleNote });
}

function toErrorMessage(reason: 'not_found' | 'expired' | 'already_completed'): string {
  if (reason === 'not_found') return 'リンクが無効です';
  if (reason === 'expired') return 'リンクの有効期限が切れました';
  return 'この診断は既に完了しています';
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}
