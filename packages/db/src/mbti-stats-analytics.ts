import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

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
const MAX_ANALYTICS_DAYS = 3_650;

/**
 * 各軸の設問数(mini-games-mbti-core.tsのMBTI_AXIS_QUESTION_COUNTSと同じ値)。
 * 出題プールから抽出する設問数を変えない限りこの値は変わらないため、
 * computeMbtiAxisPercentと同じ「50 + (score/maxScore)*50」の式をここでも使う。
 */
const MBTI_AXIS_QUESTION_COUNTS: Record<MbtiAxis, number> = { EI: 13, SN: 13, TF: 12, JP: 12 };

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

export interface MbtiUsageAnalyticsOptions {
  now?: Date;
  /** 未指定なら全期間を対象にする（MBTI診断は低頻度のため、既定は無期限集計）。 */
  days?: number;
  guildIds?: readonly string[];
}

export interface MbtiTypeCount {
  resultType: string;
  total: number;
}

export interface MbtiGuildBreakdown {
  guildId: string;
  total: number;
  topType: string | null;
}

export interface MbtiAxisAverage {
  axis: MbtiAxis;
  /** 正方向の文字(E/S/T/J)寄りの強さ。0〜100、50が中立。 */
  averagePercent: number;
}

export interface MbtiQuestionAnswerBreakdown {
  questionIndex: number;
  axis: MbtiAxis;
  total: number;
  counts: Record<MbtiLikertAnswer, number>;
}

export interface MbtiUsageAnalytics {
  generatedAt: string;
  totalCompletions: number;
  typeDistribution: MbtiTypeCount[];
  guildBreakdown: MbtiGuildBreakdown[];
  axisAverages: MbtiAxisAverage[];
  questionAnswers: MbtiQuestionAnswerBreakdown[];
}

function normalizeGuildIdsFilter(guildIds: readonly string[] | undefined): string[] | undefined {
  if (guildIds === undefined) return undefined;
  return [
    ...new Set(guildIds.map((id) => id.trim().slice(0, MAX_GUILD_ID_LENGTH)).filter(Boolean)),
  ];
}

function guildScopeSql(column: Prisma.Sql, guildIds: readonly string[] | undefined): Prisma.Sql {
  const normalized = normalizeGuildIdsFilter(guildIds);
  if (normalized === undefined) return Prisma.sql``;
  if (normalized.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${column} IN (${Prisma.join(normalized)})`;
}

function daysSinceSql(column: Prisma.Sql, now: Date, days: number | undefined): Prisma.Sql {
  if (days === undefined) return Prisma.sql``;
  const normalizedDays = Math.min(MAX_ANALYTICS_DAYS, Math.max(1, Math.floor(days)));
  const since = new Date(now.getTime() - normalizedDays * DAY_MS);
  return Prisma.sql`AND ${column} >= ${since}`;
}

export function axisPercentFromAverageScore(axis: MbtiAxis, averageScore: number): number {
  const maxScore = MBTI_AXIS_QUESTION_COUNTS[axis] * 2;
  if (maxScore <= 0) return 50;
  const percent = 50 + (averageScore / maxScore) * 50;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

export async function getMbtiUsageAnalytics(
  prisma: PrismaClient,
  options: MbtiUsageAnalyticsOptions = {},
): Promise<MbtiUsageAnalytics> {
  const now = options.now ?? new Date();
  const guildScope = guildScopeSql(Prisma.sql`"guild_id"`, options.guildIds);
  const daysScope = daysSinceSql(Prisma.sql`"completed_at"`, now, options.days);
  const answerDaysScope = daysSinceSql(Prisma.sql`"answered_at"`, now, options.days);

  const [totalRows, typeRows, guildRows, axisRows, answerRows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS "total"
      FROM "mbti_quiz_result_events"
      WHERE TRUE ${guildScope} ${daysScope}
    `,
    prisma.$queryRaw<MbtiTypeCount[]>`
      SELECT "result_type" AS "resultType", COUNT(*)::int AS "total"
      FROM "mbti_quiz_result_events"
      WHERE TRUE ${guildScope} ${daysScope}
      GROUP BY 1
      ORDER BY "total" DESC, "resultType" ASC
    `,
    prisma.$queryRaw<Array<{ guildId: string; total: number; topType: string | null }>>`
      SELECT
        "guild_id" AS "guildId",
        COUNT(*)::int AS "total",
        (
          SELECT "result_type"
          FROM "mbti_quiz_result_events" AS "inner"
          WHERE "inner"."guild_id" = "outer"."guild_id" ${daysScope}
          GROUP BY "result_type"
          ORDER BY COUNT(*) DESC, "result_type" ASC
          LIMIT 1
        ) AS "topType"
      FROM "mbti_quiz_result_events" AS "outer"
      WHERE TRUE ${guildScope} ${daysScope}
      GROUP BY "guild_id"
      ORDER BY "total" DESC, "guildId" ASC
    `,
    prisma.$queryRaw<Array<{ eiAvg: number; snAvg: number; tfAvg: number; jpAvg: number }>>`
      SELECT
        COALESCE(AVG("ei_score"), 0)::float AS "eiAvg",
        COALESCE(AVG("sn_score"), 0)::float AS "snAvg",
        COALESCE(AVG("tf_score"), 0)::float AS "tfAvg",
        COALESCE(AVG("jp_score"), 0)::float AS "jpAvg"
      FROM "mbti_quiz_result_events"
      WHERE TRUE ${guildScope} ${daysScope}
    `,
    prisma.$queryRaw<
      Array<{ questionIndex: number; axis: MbtiAxis; answer: MbtiLikertAnswer; total: number }>
    >`
      SELECT
        "question_index" AS "questionIndex",
        "axis" AS "axis",
        "answer" AS "answer",
        COUNT(*)::int AS "total"
      FROM "mbti_question_answer_events"
      WHERE TRUE ${guildScope} ${answerDaysScope}
      GROUP BY 1, 2, 3
      ORDER BY 1 ASC
    `,
  ]);

  const questionMap = new Map<number, MbtiQuestionAnswerBreakdown>();
  for (const row of answerRows) {
    const existing = questionMap.get(row.questionIndex);
    if (existing) {
      existing.counts[row.answer] = row.total;
      existing.total += row.total;
    } else {
      const counts = Object.fromEntries(
        MBTI_LIKERT_ANSWERS.map((answer) => [answer, answer === row.answer ? row.total : 0]),
      ) as Record<MbtiLikertAnswer, number>;
      questionMap.set(row.questionIndex, {
        questionIndex: row.questionIndex,
        axis: row.axis,
        total: row.total,
        counts,
      });
    }
  }

  const axisAveragesRow = axisRows[0] ?? { eiAvg: 0, snAvg: 0, tfAvg: 0, jpAvg: 0 };
  const axisAverages: MbtiAxisAverage[] = [
    { axis: 'EI', averagePercent: axisPercentFromAverageScore('EI', axisAveragesRow.eiAvg) },
    { axis: 'SN', averagePercent: axisPercentFromAverageScore('SN', axisAveragesRow.snAvg) },
    { axis: 'TF', averagePercent: axisPercentFromAverageScore('TF', axisAveragesRow.tfAvg) },
    { axis: 'JP', averagePercent: axisPercentFromAverageScore('JP', axisAveragesRow.jpAvg) },
  ];

  return {
    generatedAt: now.toISOString(),
    totalCompletions: totalRows[0]?.total ?? 0,
    typeDistribution: typeRows,
    guildBreakdown: guildRows,
    axisAverages,
    questionAnswers: [...questionMap.values()].sort((a, b) => a.questionIndex - b.questionIndex),
  };
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
