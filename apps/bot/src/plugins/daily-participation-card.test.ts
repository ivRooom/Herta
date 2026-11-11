import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  announcement: vi.fn(),
  record: vi.fn(),
  status: vi.fn(),
  claim: vi.fn(),
  answer: vi.fn(),
  yesterday: vi.fn(),
  reply: vi.fn(),
  media: vi.fn(),
}));
vi.mock('@herta/db', () => ({
  getDailyQuizSession: mocks.getSession,
  createDailyQuizSession: mocks.createSession,
  getDailyAnnouncement: mocks.announcement,
  recordDailyClaim: mocks.record,
}));
vi.mock('./daily-participation-client.js', () => ({
  participationStatus: mocks.status,
  participationClaim: mocks.claim,
  participationAnswer: mocks.answer,
  yesterdayReview: mocks.yesterday,
}));
vi.mock('./daily-bonus-reply.js', () => ({ replyDailyBonusResult: mocks.reply }));
vi.mock('./daily-bonus-wallet.js', () => ({ dailyServiceFetch: mocks.media }));
import { handleDailyParticipation, questionHeroImage } from './daily-participation.js';
const f = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/daily-participation.v2.fixture.json', import.meta.url),
    'utf8',
  ),
);
const message = '323456789012345678',
  role = '423456789012345678',
  channel = '523456789012345678';
function context() {
  return {
    guildId: f.status.guildId,
    prisma: {},
    client: { user: { id: 'bot' } },
    config: { enabled: true, notificationRoleId: role },
  } as unknown as Parameters<typeof handleDailyParticipation>[0];
}
function interaction(customId: string) {
  return {
    customId,
    user: { id: f.status.discordUserId },
    guildId: f.status.guildId,
    channelId: channel,
    message: { id: message },
    isButton: () => !customId.includes(':submit:'),
    isModalSubmit: () => customId.includes(':submit:'),
    guild: {
      members: { fetch: vi.fn(async () => ({ roles: { cache: new Map([[role, {}]]) } })) },
      channels: {
        fetch: vi.fn(async () => ({
          isTextBased: () => true,
          messages: { fetch: vi.fn(async () => ({ author: { id: 'bot' } })) },
        })),
      },
    },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
    reply: vi.fn(),
    showModal: vi.fn(),
    fields: { getTextInputValue: () => 'synthetic answer' },
  } as unknown as Parameters<typeof handleDailyParticipation>[1];
}
type Payload = {
  content?: string;
  embeds?: { toJSON: () => { description?: string; image?: { url: string } } }[];
  files?: { name: string; attachment: Buffer }[];
  components?: unknown[];
};
const questionPayloads = (i: ReturnType<typeof interaction>) =>
  (vi.mocked(i.followUp).mock.calls.map((c) => c[0]) as Payload[]).filter((p) => p.components);
const heroMedia = {
  id: 'heroimg',
  kind: 'image' as const,
  mimeType: 'image/webp' as const,
  url: 'https://example.invalid/hero.webp',
  byteSize: 4,
  durationMs: null,
  rights: 'original' as const,
};
const heroQuestion = {
  ...f.publicQuestion,
  format: 'choice4' as const,
  options: ['前田敦子', '渡辺麻友', '高橋みなみ', '大島優子'].map((label, index) => ({
    id: `o${index}`,
    label,
    mediaId: null,
  })),
  media: [heroMedia],
};
function mediaResponse(bytes: Buffer) {
  const headers = new Map<string, string>([
    ['X-IVRM-Media-Id', heroMedia.id],
    ['Content-Type', heroMedia.mimeType],
    ['Content-Length', String(bytes.length)],
    ['Cache-Control', 'private, no-store'],
  ]);
  let served = false;
  return {
    ok: true,
    headers: { get: (name: string) => headers.get(name) ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (served) return { done: true, value: undefined };
          served = true;
          return { done: false, value: new Uint8Array(bytes) };
        },
        cancel: async () => {},
      }),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T01:00:00Z'));
  vi.stubEnv('DAILY_PARTICIPATION_ENABLED', 'true');
  vi.stubEnv('DAILY_BONUS_ENABLED', 'true');
  mocks.announcement.mockResolvedValue({
    message_id: message,
    channel_id: channel,
    role_id: role,
    status: 'sent',
  });
  mocks.createSession.mockResolvedValue('11111111-1111-4111-8111-111111111111');
  mocks.status.mockResolvedValue(f.status);
  mocks.claim.mockResolvedValue(f.claimResponse);
  mocks.answer.mockResolvedValue(f.answerResponse);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('question hero image selection (#851)', () => {
  it('picks an unreferenced question image as the hero image', () => {
    expect(questionHeroImage(heroQuestion)?.id).toBe('heroimg');
  });
  it('does not treat option artwork or audio as the hero image', () => {
    const optionArt = {
      ...heroQuestion,
      options: heroQuestion.options.map((o: { mediaId: string | null }, i: number) =>
        i === 0 ? { ...o, mediaId: 'heroimg' } : o,
      ),
    };
    expect(questionHeroImage(optionArt)).toBeNull();
    expect(
      questionHeroImage({ ...heroQuestion, media: [{ ...heroMedia, kind: 'audio' as const }] }),
    ).toBeNull();
    expect(questionHeroImage(f.publicQuestion)).toBeNull();
  });
});

describe('question presentation (#851)', () => {
  it('renders the default PNG card for a legacy question without media', async () => {
    vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
    const i = interaction('daily-participation:questions:2026-10-31');
    await handleDailyParticipation(context(), i);
    const payloads = questionPayloads(i);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.files).toHaveLength(1);
    expect(payloads[0]!.files![0]!.name).toBe('herta-daily-question.png');
    // PNG magic bytes prove a rendered card was attached.
    expect(payloads[0]!.files![0]!.attachment.subarray(0, 2)).toEqual(Buffer.from([0x89, 0x50]));
    expect(payloads[0]!.content).toContain('今日の問題');
    expect(mocks.media).not.toHaveBeenCalled();
  });

  it('overrides the default card with the author-provided question image', async () => {
    vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
    mocks.status.mockResolvedValue({ ...f.status, questions: [heroQuestion], responses: [] });
    mocks.media.mockResolvedValue(mediaResponse(Buffer.from([1, 2, 3, 4])));
    const i = interaction('daily-participation:questions:2026-10-31');
    await handleDailyParticipation(context(), i);
    const payloads = questionPayloads(i);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.files![0]!.name).toBe('heroimg.webp');
    expect(payloads[0]!.files![0]!.attachment).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(payloads[0]!.embeds![0]!.toJSON().image?.url).toBe('attachment://heroimg.webp');
  });

  it('falls back to the default card when the question image cannot be fetched', async () => {
    vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
    mocks.status.mockResolvedValue({ ...f.status, questions: [heroQuestion], responses: [] });
    mocks.media.mockResolvedValue(null);
    const i = interaction('daily-participation:questions:2026-10-31');
    await handleDailyParticipation(context(), i);
    const payloads = questionPayloads(i);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.files![0]!.name).toBe('herta-daily-question.png');
    expect(payloads[0]!.components).toEqual(expect.any(Array));
  });

  it('keeps the Embed presentation while the card flag is off', async () => {
    const i = interaction('daily-participation:questions:2026-10-31');
    await handleDailyParticipation(context(), i);
    const payloads = questionPayloads(i);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.files).toBeUndefined();
    expect(payloads[0]!.embeds![0]!.toJSON().description).toBe(f.publicQuestion.prompt);
  });
});

const yesterdayHeroReview = {
  status: 'ok',
  guildId: f.status.guildId,
  discordUserId: f.status.discordUserId,
  dateJst: '2026-10-30',
  revealed: true,
  entries: [
    {
      question: { ...heroQuestion, dateJst: '2026-10-30' },
      userResponse: {
        optionId: 'o3',
        text: null,
        state: 'graded',
        isCorrect: true,
        rewardPoints: 10,
        submittedAt: '2026-10-30T01:00:00.000Z',
        origin: 'discord',
      },
      correctOptionId: 'o3',
      explanation: null,
    },
  ],
};
const allPayloads = (i: ReturnType<typeof interaction>) =>
  vi.mocked(i.followUp).mock.calls.map((c) => c[0]) as Payload[];
const reviewPayload = (i: ReturnType<typeof interaction>) =>
  allPayloads(i).find((p) => p.files?.some((file) => file.name === 'daily-question-yesterday.png'));

describe('yesterday review question media (#820)', () => {
  it('attaches the question hero image to the review card follow-up', async () => {
    vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
    mocks.yesterday.mockResolvedValue(yesterdayHeroReview);
    mocks.media.mockResolvedValue(mediaResponse(Buffer.from([1, 2, 3, 4])));
    const i = interaction('daily-participation:yesterday:2026-10-31');
    await handleDailyParticipation(context(), i);
    expect(mocks.media).toHaveBeenCalledWith(
      f.status.guildId,
      f.status.discordUserId,
      '/v2/participation/herta/media',
      { mediaId: 'heroimg' },
    );
    const payload = reviewPayload(i);
    expect(payload).toBeDefined();
    expect(payload!.content).toContain('正解でした！');
    expect(payload!.files!.map((file) => file.name)).toEqual([
      'daily-question-yesterday.png',
      'heroimg.webp',
    ]);
    expect(payload!.files![1]!.attachment).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(payload!.embeds).toHaveLength(2);
    expect(payload!.embeds![1]!.toJSON().image?.url).toBe('attachment://heroimg.webp');
  });

  it('shows the hero image on the embed fallback when the card flag is off', async () => {
    mocks.yesterday.mockResolvedValue(yesterdayHeroReview);
    mocks.media.mockResolvedValue(mediaResponse(Buffer.from([1, 2, 3, 4])));
    const i = interaction('daily-participation:yesterday:2026-10-31');
    await handleDailyParticipation(context(), i);
    const payload = allPayloads(i).find((p) => p.embeds?.[0]?.toJSON().description);
    expect(payload).toBeDefined();
    expect(payload!.content).toContain('正解でした！');
    expect(payload!.files!.map((file) => file.name)).toEqual(['heroimg.webp']);
    expect(payload!.embeds![0]!.toJSON().image?.url).toBe('attachment://heroimg.webp');
  });

  it('still returns the review when the question media cannot be fetched', async () => {
    vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
    mocks.yesterday.mockResolvedValue(yesterdayHeroReview);
    mocks.media.mockResolvedValue(null);
    const i = interaction('daily-participation:yesterday:2026-10-31');
    await handleDailyParticipation(context(), i);
    const payload = reviewPayload(i);
    expect(payload).toBeDefined();
    expect(payload!.content).toContain('正解でした！');
    expect(payload!.files!.map((file) => file.name)).toEqual(['daily-question-yesterday.png']);
    expect(payload!.embeds).toHaveLength(1);
  });
});
