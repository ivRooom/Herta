import { readFileSync } from 'node:fs';
import { Collection } from 'discord.js';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./daily-bonus-wallet.js', () => ({ request: mock.request }));
import { scanParticipationResults } from './daily-participation-results.js';
const f = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/daily-participation.v2.fixture.json', import.meta.url),
    'utf8',
  ),
);
afterEach(() => {
  vi.unstubAllEnvs();
  mock.request.mockReset();
});
function context(guild: string) {
  vi.stubEnv('DAILY_PARTICIPATION_ENABLED', 'true');
  vi.stubEnv('DAILY_BONUS_ENABLED', 'true');
  const sent = { id: '323456789012345678' },
    send = vi.fn(async (_options: unknown) => sent),
    history = new Collection([
      [
        sent.id,
        {
          id: sent.id,
          author: { id: '223456789012345678' },
          embeds: [{ footer: { text: `daily-result:${f.anonymousResult.questionId}` } }],
        },
      ],
    ]);
  const channel = {
    isTextBased: () => true,
    isThread: () => false,
    send,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: vi.fn(async () => history) },
  };
  return {
    ctx: {
      guildId: guild,
      client: {
        user: { id: '223456789012345678' },
        guilds: {
          fetch: async () => ({
            channels: { fetch: async () => channel },
            members: { fetchMe: async () => ({}) },
          }),
        },
      },
      config: { enabled: true, channelId: '423456789012345678' },
      logger: { warn: vi.fn() },
    },
    channel,
    sent,
  };
}
it('lost ACK resumes from durable uncertain state and never resends the result', async () => {
  const { ctx, channel, sent } = context('guild-restart');
  const delivery = {
    questionId: f.anonymousResult.questionId,
    result: f.anonymousResult,
    deliveryToken: 'synthetic-delivery-token',
    status: 'sending',
  };
  const envelope = {
    status: 'ok',
    guildId: ctx.guildId,
    discordUserId: ctx.client.user.id,
    deliveries: [delivery],
  };
  mock.request
    .mockResolvedValueOnce(envelope)
    .mockRejectedValueOnce(new Error('synthetic lost ACK'));
  await scanParticipationResults(ctx as unknown as Parameters<typeof scanParticipationResults>[0]);
  mock.request
    .mockResolvedValueOnce({ ...envelope, deliveries: [{ ...delivery, status: 'uncertain' }] })
    .mockResolvedValueOnce({ status: 'ok', questionId: delivery.questionId, messageId: sent.id });
  await scanParticipationResults(ctx as unknown as Parameters<typeof scanParticipationResults>[0]);
  expect(channel.send).toHaveBeenCalledOnce();
  expect(channel.messages.fetch).toHaveBeenCalledOnce();
  expect(channel.send.mock.calls[0]![0]).toMatchObject({
    allowedMentions: { parse: [] },
    enforceNonce: true,
  });
});
