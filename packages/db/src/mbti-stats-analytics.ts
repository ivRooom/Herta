import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export type MbtiAxis = 'EI' | 'SN' | 'TF' | 'JP';
export type MbtiLikertAnswer =
  'agree' | 'slightly_agree' | 'neutral' | 'slightly_disagree' | 'disagree';

const MBTI_TYPES = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const;

const MBTI_AXES: readonly MbtiAxis[] = ['EI', 'SN', 'TF', 'JP'];
const MBTI_LIKERT_ANSWERS: readonly MbtiLikertAnswer[] = [
  'agree',
  'slightly_agree',
  'neutral',
  'slightly_disagree',
  'disagree',
];

const MAX_GUILD_ID_LENGTH = 64;
const MAX_SCORE = 30;
const MAX_QUESTION_INDEX = 99;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 365;
const MAX_RETENTION_DAYS = 3_650;

export interface MbtiQuizAnswerInput {
  questionIndex: number;
  axis: MbtiAxis;
  answer: MbtiLikertAnswer;
}

export interface MbtiQuizCompletionInput {
  guildId: string;
  resultType: string;
  eiScore: number;
  snScore: number;
  tfScore: number;
  jpScore: number;
  answers: readonly MbtiQuizAnswerInput[];
}

function normalizeGuildId(value: string): string {
  const trimmed = value.trim().slice(0, MAX_GUILD_ID_LENGTH);
  return trimmed || 'unknown-guild';
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_SCORE, Math.max(-MAX_SCORE, Math.round(value)));
}

function normalizeQuestionIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_QUESTION_INDEX, Math.max(0, Math.round(value)));
}

/**
 * 未知のresultType/axis/answerを記録しようとする呼び出し側の不整合を、
 * DB CHECK制約に頼らずアプリ層で早期に弾く（fire-and-forgetのため失敗が黙殺されやすい）。
 */
export function isKnownMbtiResultType(value: string): value is (typeof MBTI_TYPES)[number] {
  return (MBTI_TYPES as readonly string[]).includes(value);
}

export interface NormalizedMbtiQuizCompletion {
  completionId: string;
  guildId: string;
  resultType: string;
  eiScore: number;
  snScore: number;
  tfScore: number;
  jpScore: number;
  answers: Array<{
    questionIndex: number;
    axis: MbtiAxis;
    answer: MbtiLikertAnswer;
  }>;
}

export function normalizeMbtiQuizCompletionInput(
  input: MbtiQuizCompletionInput,
  completionId: string,
): NormalizedMbtiQuizCompletion {
  if (!isKnownMbtiResultType(input.resultType)) {
    throw new Error(`Unknown MBTI result type: ${input.resultType}`);
  }

  return {
    completionId,
    guildId: normalizeGuildId(input.guildId),
    resultType: input.resultType,
    eiScore: normalizeScore(input.eiScore),
    snScore: normalizeScore(input.snScore),
    tfScore: normalizeScore(input.tfScore),
    jpScore: normalizeScore(input.jpScore),
    answers: input.answers
      .filter(
        (entry) => MBTI_AXES.includes(entry.axis) && MBTI_LIKERT_ANSWERS.includes(entry.answer),
      )
      .map((entry) => ({
        questionIndex: normalizeQuestionIndex(entry.questionIndex),
        axis: entry.axis,
        answer: entry.answer,
      })),
  };
}

export async function recordMbtiQuizCompletion(
  prisma: PrismaClient,
  input: MbtiQuizCompletionInput,
): Promise<void> {
  const normalized = normalizeMbtiQuizCompletionInput(input, randomUUID().replaceAll('-', ''));

  await prisma.$transaction([
    prisma.mbtiQuizResultEvent.create({
      data: {
        id: randomUUID(),
        completionId: normalized.completionId,
        guildId: normalized.guildId,
        resultType: normalized.resultType,
        eiScore: normalized.eiScore,
        snScore: normalized.snScore,
        tfScore: normalized.tfScore,
        jpScore: normalized.jpScore,
      },
    }),
    prisma.mbtiQuestionAnswerEvent.createMany({
      data: normalized.answers.map((entry) => ({
        id: randomUUID(),
        completionId: normalized.completionId,
        guildId: normalized.guildId,
        questionIndex: entry.questionIndex,
        axis: entry.axis,
        answer: entry.answer,
      })),
    }),
  ]);
}

export async function pruneMbtiStatsEvents(
  prisma: PrismaClient,
  retentionDays = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  const normalizedRetentionDays = Math.min(
    MAX_RETENTION_DAYS,
    Math.max(1, Math.floor(retentionDays)),
  );
  const cutoff = new Date(Date.now() - normalizedRetentionDays * DAY_MS);

  const [resultDeleted, answerDeleted] = await Promise.all([
    prisma.mbtiQuizResultEvent.deleteMany({ where: { completedAt: { lt: cutoff } } }),
    prisma.mbtiQuestionAnswerEvent.deleteMany({ where: { answeredAt: { lt: cutoff } } }),
  ]);

  return resultDeleted.count + answerDeleted.count;
}
