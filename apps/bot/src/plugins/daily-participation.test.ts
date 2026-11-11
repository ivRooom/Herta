import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  renderCard: vi.fn(),
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
vi.mock('./daily-question-card.js', () => ({ renderDailyQuestionCard: mocks.renderCard }));
import { handleDailyParticipation, isParticipationInteraction } from './daily-participation.js';
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
const yesterdayReviewFixture = {
  status: 'ok',
  guildId: f.status.guildId,
  discordUserId: f.status.discordUserId,
  dateJst: '2026-10-30',
  revealed: true,
  entries: [
    {
      question: { ...f.publicQuestion, dateJst: '2026-10-30' },
      userResponse: {
        optionId: 'b',
        text: null,
        state: 'graded',
        isCorrect: false,
        rewardPoints: 0,
        submittedAt: '2026-10-30T01:00:00.000Z',
        origin: 'discord',
      },
      correctOptionId: 'a',
      explanation: 'A が正解です。',
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
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
  mocks.yesterday.mockResolvedValue(yesterdayReviewFixture);
  mocks.renderCard.mockResolvedValue(Buffer.from('answered-card-png'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it('accepts only canonical legacy claim and question IDs as V2 migration entrypoints', () => {
  expect(isParticipationInteraction({ customId: 'daily-bonus:2026-10-31' })).toBe(true);
  expect(isParticipationInteraction({ customId: 'daily-bonus:questions:2026-10-31' })).toBe(true);
  expect(isParticipationInteraction({ customId: 'daily-bonus:fortune:2026-10-31' })).toBe(false);
  expect(
    isParticipationInteraction({
      customId: 'daily-bonus:answer:11111111-1111-4111-8111-111111111111:0',
    }),
  ).toBe(false);
  expect(isParticipationInteraction({ customId: 'daily-bonus:questions:invalid' })).toBe(false);
});
it('opens an old announcement question with V2 without claiming the login bonus', async () => {
  const i = interaction('daily-bonus:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.status).toHaveBeenCalledOnce();
  expect(i.followUp).toHaveBeenCalled();
});
it('rejects an old question button whose announcement does not match', async () => {
  mocks.announcement.mockResolvedValueOnce({
    message_id: '999999999999999999',
    channel_id: channel,
    role_id: role,
    status: 'sent',
  });
  const i = interaction('daily-bonus:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.status).not.toHaveBeenCalled();
  expect(i.followUp).not.toHaveBeenCalled();
});
it('already-received subject opens unanswered question without claiming again', async () => {
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(i.followUp).toHaveBeenCalledWith(
    expect.objectContaining({ flags: 64, components: expect.any(Array) }),
  );
});
it('unclaimed subject can open standalone question without invoking the login claim', async () => {
  mocks.status.mockResolvedValue({
    ...f.status,
    bonusClaimed: false,
    questions: [{ ...f.publicQuestion, requiresClaim: false }],
    responses: [],
  });
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.status).toHaveBeenCalledOnce();
  expect(i.followUp).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining('今日の問題'),
      components: expect.any(Array),
    }),
  );
});
it('explains the claim prerequisite without awarding login points', async () => {
  mocks.status.mockResolvedValue({
    ...f.status,
    bonusClaimed: false,
    questions: [{ ...f.publicQuestion, requiresClaim: true }],
    responses: [],
  });
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.createSession).not.toHaveBeenCalled();
  expect(i.followUp).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining('受取が必要です'),
      allowedMentions: { parse: [] },
    }),
  );
});

it('still offers an independent question alongside claim-required questions', async () => {
  mocks.status.mockResolvedValue({
    ...f.status,
    bonusClaimed: false,
    questions: [
      { ...f.publicQuestion, id: 'blocked-question', requiresClaim: true },
      { ...f.publicQuestion, requiresClaim: false },
    ],
    responses: [],
  });
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.createSession).toHaveBeenCalledOnce();
  expect(i.followUp).toHaveBeenCalledWith(
    expect.objectContaining({ components: expect.any(Array) }),
  );
  expect(i.followUp).not.toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('受取が必要です') }),
  );
});
const answeredStatus = {
  ...f.status,
  responses: [
    {
      questionId: f.publicQuestion.id,
      optionId: 'b',
      text: null,
      state: 'graded',
      isCorrect: false,
      rewardPoints: 10,
      submittedAt: '2026-10-31T00:30:00.000Z',
      origin: 'discord',
    },
  ],
};
it('renders the answered view as an image card when the card flag is on', async () => {
  vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
  mocks.status.mockResolvedValue(answeredStatus);
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.renderCard).toHaveBeenCalledWith(
    expect.objectContaining({
      result: expect.objectContaining({
        state: 'graded',
        isCorrect: false,
        selectedOptionIndex: 1,
        selectedText: null,
        rewardPoints: 10,
      }),
    }),
  );
  const sent = vi.mocked(i.followUp).mock.calls[0]![0] as {
    content: string;
    files?: { name: string }[];
    embeds?: { toJSON: () => { image?: { url: string }; description?: string } }[];
  };
  expect(sent.content).toBe('回答済み / 獲得 10pt');
  expect(sent.files).toHaveLength(1);
  expect(sent.files![0]!.name).toBe('daily-question-answered.png');
  expect(sent.embeds![0]!.toJSON().image?.url).toBe('attachment://daily-question-answered.png');
});
it('falls back to the prompt embed when the answered card fails to render', async () => {
  vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
  mocks.status.mockResolvedValue(answeredStatus);
  mocks.renderCard.mockRejectedValueOnce(new Error('synthetic render failure'));
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  const sent = vi.mocked(i.followUp).mock.calls[0]![0] as {
    content: string;
    files?: unknown;
    embeds?: { toJSON: () => { description?: string } }[];
  };
  expect(sent.content).toBe('回答済み / 獲得 10pt');
  expect(sent.files).toBeUndefined();
  expect(sent.embeds![0]!.toJSON().description).toBe(f.publicQuestion.prompt);
});
it('keeps the embed-only answered view when the card flag is off', async () => {
  mocks.status.mockResolvedValue(answeredStatus);
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.renderCard).not.toHaveBeenCalled();
  const sent = vi.mocked(i.followUp).mock.calls[0]![0] as {
    content: string;
    files?: unknown;
    embeds?: { toJSON: () => { description?: string } }[];
  };
  expect(sent.content).toBe('回答済み / 獲得 10pt');
  expect(sent.files).toBeUndefined();
  expect(sent.embeds![0]!.toJSON().description).toBe(f.publicQuestion.prompt);
});
it('keeps a maximum Unicode prompt in an embed within Discord content limits', async () => {
  const prompt = '🎮'.repeat(1000);
  mocks.status.mockResolvedValue({ ...f.status, questions: [{ ...f.publicQuestion, prompt }] });
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  const sent = vi.mocked(i.followUp).mock.calls[0]![0] as {
    content: string;
    embeds: { toJSON: () => { description: string } }[];
  };
  expect(sent.content.length).toBeLessThanOrEqual(2000);
  expect(sent.embeds[0]!.toJSON().description).toBe(prompt);
});
it('roll-only claim completes before question controls and uses canonical receipt', async () => {
  const i = interaction('daily-bonus:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).toHaveBeenCalledOnce();
  expect(mocks.record).toHaveBeenCalledOnce();
  expect(mocks.reply).toHaveBeenCalledOnce();
  expect(i.followUp).not.toHaveBeenCalled();
  expect(mocks.status).not.toHaveBeenCalled();
});
it('rejects foreign persisted session and runtime invalidation before mutating', async () => {
  mocks.getSession.mockResolvedValue(null);
  await handleDailyParticipation(
    context(),
    interaction('daily-participation:answer:11111111-1111-4111-8111-111111111111:0'),
  );
  expect(mocks.answer).not.toHaveBeenCalled();
  await handleDailyParticipation(context(), interaction('daily-bonus:2026-10-31'), () => false);
  expect(mocks.claim).not.toHaveBeenCalled();
});
it('rechecks role/deadline and routes exactly one server-side answer', async () => {
  mocks.getSession.mockResolvedValue({
    target_date: '2026-10-31',
    announcement_message_id: message,
    quiz_id: f.publicQuestion.id,
  });
  const id = 'daily-participation:answer:11111111-1111-4111-8111-111111111111:0';
  await handleDailyParticipation(context(), interaction(id));
  expect(mocks.answer).toHaveBeenCalledWith(
    f.status.guildId,
    f.status.discordUserId,
    f.publicQuestion.id,
    'a',
    null,
  );
  mocks.answer.mockClear();
  vi.setSystemTime(new Date('2026-10-31T15:00:00Z'));
  await handleDailyParticipation(context(), interaction(id));
  expect(mocks.answer).not.toHaveBeenCalled();
});
it('never loads questions or fortune after a confirmed login-only claim', async () => {
  mocks.status.mockRejectedValueOnce(new Error('synthetic question outage'));
  const i = interaction('daily-bonus:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).toHaveBeenCalledOnce();
  expect(mocks.reply).toHaveBeenCalledOnce();
  expect(mocks.record).toHaveBeenCalledOnce();
  expect(mocks.status).not.toHaveBeenCalled();
  expect(i.followUp).not.toHaveBeenCalled();
});
it('renders the yesterday review card with answer markers when revealed (#820)', async () => {
  vi.stubEnv('DAILY_QUESTION_CARD_ENABLED', 'true');
  const i = interaction('daily-participation:yesterday:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.yesterday).toHaveBeenCalledWith(f.status.guildId, f.status.discordUserId);
  expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.renderCard).toHaveBeenCalledWith(
    expect.objectContaining({
      heading: '昨日の問題',
      result: expect.objectContaining({
        selectedOptionIndex: 1,
        correctOptionIndex: 0,
        isCorrect: false,
      }),
    }),
  );
  const sent = vi.mocked(i.followUp).mock.calls[0]![0] as {
    content: string;
    files?: { name: string }[];
  };
  expect(sent.content).toContain('不正解でした。');
  expect(sent.content).toContain('💡 解説：A が正解です。');
  expect(sent.files).toHaveLength(1);
  expect(sent.files![0]!.name).toBe('daily-question-yesterday.png');
});
it('falls back to a marked embed for the yesterday review when the card flag is off (#820)', async () => {
  const i = interaction('daily-participation:yesterday:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.renderCard).not.toHaveBeenCalled();
  const sent = vi.mocked(i.followUp).mock.calls[0]![0] as {
    embeds: { toJSON: () => { fields?: { name: string }[] } }[];
  };
  const names = sent.embeds[0]!.toJSON().fields!.map((field) => field.name);
  expect(names).toEqual(['選択肢 1（正解）', '選択肢 2（あなたの回答）']);
});
it('reports when there were no questions yesterday (#820)', async () => {
  mocks.yesterday.mockResolvedValue({ ...yesterdayReviewFixture, entries: [] });
  const i = interaction('daily-participation:yesterday:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(i.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: '昨日の問題はありませんでした。' }),
  );
  expect(i.followUp).not.toHaveBeenCalled();
});
it('withholds the yesterday answers before the 09:00 reveal (#820)', async () => {
  mocks.yesterday.mockResolvedValue({ ...yesterdayReviewFixture, revealed: false });
  const i = interaction('daily-participation:yesterday:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(i.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: '答え合わせは 9:00 以降に確認できます。' }),
  );
  expect(i.followUp).not.toHaveBeenCalled();
});
it('reports a friendly error when the yesterday review cannot be fetched (#820)', async () => {
  mocks.yesterday.mockRejectedValueOnce(new Error('synthetic outage'));
  const i = interaction('daily-participation:yesterday:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(i.editReply).toHaveBeenCalledWith(
    expect.objectContaining({
      content: '昨日の問題を取得できませんでした。時間をおいて再試行してください。',
    }),
  );
  expect(i.followUp).not.toHaveBeenCalled();
});
