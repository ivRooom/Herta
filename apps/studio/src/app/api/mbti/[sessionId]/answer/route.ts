import { NextResponse } from 'next/server';
import { appendMbtiWebQuizAnswer, resolveMbtiWebQuizSessionForAnswer } from '@herta/db';
import {
  createEmptyMbtiScores,
  isMbtiLikertAnswer,
  mbtiLikertWeight,
  type MbtiLikertAnswer,
  type MbtiScores,
} from '@herta/shared/mbti-core';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/bounded-request-body';
import { prisma } from '@/lib/db';
import { isSameOriginMutationRequest } from '@/lib/request-origin';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_JSON_BYTES = 1 * 1024;
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
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'application/jsonが必要です' }, 415);
  }

  const { sessionId } = await params;
  if (!UUID_PATTERN.test(sessionId)) {
    return json({ error: 'リンクが正しくありません' }, 400);
  }

  let raw: unknown;
  try {
    raw = await readJsonBodyWithLimit(request, MAX_JSON_BYTES);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? '回答が大きすぎます'
            : '回答を読み取れませんでした',
      },
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }

  const input = parseAnswerInput(raw);
  if (!input) return json({ error: '回答の形式が不正です' }, 400);

  const resolution = await resolveMbtiWebQuizSessionForAnswer(prisma, sessionId);
  if (!resolution.ok)
    return json({ error: toErrorMessage(resolution.reason) }, toStatus(resolution.reason));

  const { session } = resolution;
  if (input.questionIndex !== session.answers.length) {
    return json({ error: '想定と異なる設問への回答です。ページを再読み込みしてください' }, 409);
  }
  const question = session.questionOrder[input.questionIndex];
  if (!question) return json({ error: '設問が見つかりません' }, 400);

  const scores: MbtiScores = {
    ...createEmptyMbtiScores(),
    ...(session.scores as Partial<MbtiScores>),
  };
  scores[question.axis as keyof MbtiScores] += mbtiLikertWeight(input.answer);

  const updatedAnswers = [
    ...session.answers,
    { questionIndex: input.questionIndex, axis: question.axis, answer: input.answer },
  ];

  const updated = await appendMbtiWebQuizAnswer(prisma, sessionId, updatedAnswers, scores);
  if (!updated) {
    return json({ error: 'リンクの有効期限が切れたか、既に回答済みです' }, 409);
  }

  return json({
    nextQuestionIndex: updated.answers.length,
    isLastQuestion: updated.answers.length === updated.questionOrder.length,
  });
}

function parseAnswerInput(
  value: unknown,
): { questionIndex: number; answer: MbtiLikertAnswer } | null {
  if (!isRecord(value)) return null;
  const { questionIndex, answer } = value;
  if (!Number.isInteger(questionIndex) || (questionIndex as number) < 0) return null;
  if (typeof answer !== 'string' || !isMbtiLikertAnswer(answer)) return null;
  return { questionIndex: questionIndex as number, answer };
}

function toStatus(reason: 'not_found' | 'expired' | 'already_completed'): number {
  if (reason === 'not_found') return 404;
  if (reason === 'expired') return 410;
  return 409;
}

function toErrorMessage(reason: 'not_found' | 'expired' | 'already_completed'): string {
  if (reason === 'not_found') return 'リンクが無効です';
  if (reason === 'expired') return 'リンクの有効期限が切れました';
  return 'この診断は既に完了しています';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}
