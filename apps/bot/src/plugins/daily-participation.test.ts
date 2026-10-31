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
  reply: vi.fn(),
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
}));
vi.mock('./daily-bonus-reply.js', () => ({ replyDailyBonusResult: mocks.reply }));
import { handleDailyParticipation } from './daily-participation.js';
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
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it('already-received subject opens unanswered question without claiming again', async () => {
  const i = interaction('daily-participation:questions:2026-10-31');
  await handleDailyParticipation(context(), i);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(i.followUp).toHaveBeenCalledWith(
    expect.objectContaining({ flags: 64, components: expect.any(Array) }),
  );
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
  expect(i.followUp).toHaveBeenCalled();
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
