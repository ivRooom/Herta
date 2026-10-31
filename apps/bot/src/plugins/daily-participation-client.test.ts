import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  participationStatus,
  participationAnswer,
  participationClaim,
  participationStatusSchema,
} from './daily-participation-client.js';
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/daily-participation.v2.fixture.json', import.meta.url),
    'utf8',
  ),
);
const guild = fixture.status.guildId,
  user = fixture.status.discordUserId;
function configure() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T01:00:00Z'));
  vi.stubEnv('IVRM_WEB_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('HERTA_POINTS_SECRET', 'synthetic-only');
  vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', guild);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it('accepts pinned status and rejects secret/provisional fields and malformed dates', async () => {
  configure();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(fixture.status)),
  );
  expect((await participationStatus(guild, user)).questions[0]!.id).toBe(fixture.publicQuestion.id);
  for (const patch of [
    { todayJst: '2026-02-30' },
    { bonusClaimed: false },
    { questions: [{ ...fixture.publicQuestion, correctOptionId: 'a' }] },
    { questions: [{ ...fixture.publicQuestion, options: [] }] },
  ])
    expect(participationStatusSchema.safeParse({ ...fixture.status, ...patch }).success).toBe(
      false,
    );
});
it('signs v2 exact bytes and binds the canonical answer key', async () => {
  configure();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, options: RequestInit) => {
      const h = options.headers as Record<string, string>,
        body = String(options.body);
      expect(JSON.parse(body)).toEqual(fixture.answerRequest);
      expect(h['X-IVRM-Signature']).toBe(
        createHmac('sha256', 'synthetic-only')
          .update(`${h['X-IVRM-Timestamp']}.${h['X-IVRM-Event-Id']}.POST.${input.pathname}.${body}`)
          .digest('hex'),
      );
      return Response.json(fixture.answerResponse);
    }),
  );
  expect((await participationAnswer(guild, user, fixture.publicQuestion.id, 'a', null)).mode).toBe(
    'created',
  );
});
it('rejects wrong subject/question/date and accepts Unicode answer receipt', async () => {
  configure();
  for (const patch of [
    { discordUserId: 'other' },
    { response: { ...fixture.answerResponse.response, questionId: 'foreign' } },
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...fixture.answerResponse, ...patch })),
    );
    await expect(
      participationAnswer(guild, user, fixture.publicQuestion.id, 'a', null),
    ).rejects.toThrow();
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...fixture.answerResponse,
        response: { ...fixture.answerResponse.response, optionId: null, text: '🎮'.repeat(1000) },
      }),
    ),
  );
  expect(
    (await participationAnswer(guild, user, fixture.publicQuestion.id, null, '🎮')).response.text,
  ).toHaveLength(2000);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...fixture.claimResponse,
        receipt: { ...fixture.claimResponse.receipt, claimDateJst: '2026-10-30' },
      }),
    ),
  );
  await expect(
    participationClaim(guild, user, '2026-10-31', '323456789012345678'),
  ).rejects.toThrow();
});
