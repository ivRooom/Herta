import { z } from 'zod';
import { request } from './daily-bonus-wallet.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const points = z.number().int().min(0).max(100000);
const safePoints = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const instant = z.string().datetime();
const text = (max: number) => z.string().refine((s) => Array.from(s).length <= max);
const jstDate = z
  .string()
  .regex(/^\d{4}-\d\d-\d\d$/)
  .refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const media = z
  .object({
    id,
    kind: z.enum(['image', 'audio']),
    mimeType: z.enum([
      'image/png',
      'image/jpeg',
      'image/webp',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
    ]),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => new URL(value).protocol === 'https:'),
    byteSize: z.number().int().min(1).max(10485760),
    durationMs: z.number().int().min(1).max(30000).nullable(),
    rights: z.enum(['original', 'licensed', 'public_domain']),
  })
  .strict();
export const publicDailyQuestion = z
  .object({
    id,
    dateJst: jstDate,
    slot: z.enum(['daily', 'bonus']),
    categoryId: id,
    themeId: id,
    format: z.enum(['choice2', 'choice3', 'choice4', 'image_choice', 'audio_choice', 'free_text']),
    scoring: z.enum(['instant', 'poll', 'majority', 'minority', 'human_review']),
    prompt: text(1000).refine((s) => s.trim().length > 0),
    options: z
      .array(
        z
          .object({
            id,
            label: text(80).refine((s) => s.trim().length > 0),
            mediaId: id.nullable(),
          })
          .strict(),
      )
      .max(4),
    media: z.array(media).max(5),
    closesAt: instant,
    requiresClaim: z.boolean(),
    maxTextLength: z.number().int().min(1).max(1000),
  })
  .strict()
  .refine((q) => {
    const count = { choice2: 2, choice3: 3, choice4: 4, free_text: 0 }[
      q.format as 'choice2' | 'choice3' | 'choice4' | 'free_text'
    ];
    return (
      (count === undefined ? q.options.length >= 2 : q.options.length === count) &&
      new Set(q.options.map((o) => o.id)).size === q.options.length &&
      new Set(q.media.map((m) => m.id)).size === q.media.length &&
      q.options.every((o) => o.mediaId === null || q.media.some((m) => m.id === o.mediaId))
    );
  });
const responseSchema = z
  .object({
    questionId: id,
    optionId: id.nullable(),
    text: text(1000).nullable(),
    state: z.enum(['pending', 'graded', 'void']),
    isCorrect: z.boolean().nullable(),
    rewardPoints: points,
    submittedAt: instant,
    origin: z.enum(['web', 'discord', 'legacy_v1']),
  })
  .strict();
const receiptSchema = z
  .object({
    claimDateJst: jstDate,
    rewardPoints: safePoints,
    streakDay: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    rollPoints: safePoints,
    quizBonusPoints: safePoints,
    channel: z.enum(['web', 'discord']),
    streakReward: z
      .object({ points, streakDay: z.number().int().min(1) })
      .strict()
      .nullable(),
    firstClaimReward: z
      .object({ points, rank: z.number().int().min(1), scope: z.literal('global') })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((r) => r.rollPoints + r.quizBonusPoints === r.rewardPoints);
export const participationStatusSchema = z
  .object({
    status: z.literal('ok'),
    guildId: z.string(),
    discordUserId: z.string(),
    todayJst: jstDate,
    bonusClaimed: z.boolean(),
    bonusReceipt: receiptSchema.nullable(),
    questions: z.array(publicDailyQuestion).max(2),
    responses: z.array(responseSchema).max(2),
  })
  .strict()
  .refine(
    (s) =>
      s.bonusClaimed === (s.bonusReceipt !== null) &&
      (!s.bonusReceipt || s.bonusReceipt.claimDateJst === s.todayJst) &&
      s.questions.every((q) => q.dateJst === s.todayJst) &&
      new Set(s.questions.map((q) => q.slot)).size === s.questions.length,
  );
export type ParticipationStatus = z.infer<typeof participationStatusSchema>;
export type ParticipationQuestion = z.infer<typeof publicDailyQuestion>;
export async function participationStatus(
  guild: string,
  user: string,
): Promise<ParticipationStatus> {
  const raw = await request(guild, user, '/v2/participation/herta/status');
  if (raw?.setupRequired) throw new Error(String(raw.setupRequired));
  const parsed = participationStatusSchema.parse(raw);
  if (parsed.todayJst !== new Date(Date.now() + 32400000).toISOString().slice(0, 10))
    throw new Error('expired');
  return parsed;
}
export async function participationClaim(
  guild: string,
  user: string,
  date: string,
  messageId: string,
) {
  const raw = await request(guild, user, '/v2/participation/herta/claim', {
    claimDateJst: date,
    announcementMessageId: messageId,
    idempotencyKey: `daily-login:${guild}:${user}:${date}`,
  });
  if (raw?.setupRequired) throw new Error(String(raw.setupRequired));
  const parsed = z
    .object({
      status: z.literal('ok'),
      guildId: z.string(),
      discordUserId: z.string(),
      mode: z.enum(['created', 'already_claimed']),
      receipt: receiptSchema,
      balance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .strict()
    .parse(raw);
  if (parsed.receipt.claimDateJst !== date) throw new Error('expired');
  return parsed;
}
export async function participationAnswer(
  guild: string,
  user: string,
  questionId: string,
  optionId: string | null,
  text: string | null,
) {
  const raw = await request(guild, user, '/v2/participation/herta/answer', {
    questionId,
    optionId,
    text,
    idempotencyKey: `question-answer:${user}:${questionId}`,
  });
  const parsed = z
    .object({
      status: z.literal('ok'),
      guildId: z.string(),
      discordUserId: z.string(),
      mode: z.enum(['created', 'already_answered']),
      response: responseSchema,
      balance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .strict()
    .parse(raw);
  if (parsed.response.questionId !== questionId) throw new Error('Invalid response question');
  return parsed;
}
