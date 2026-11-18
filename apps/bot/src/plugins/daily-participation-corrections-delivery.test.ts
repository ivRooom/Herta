import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Collection } from 'discord.js';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./daily-bonus-wallet.js', () => ({ request: mock.request }));
import { scanCorrectionDeliveries } from './daily-participation-corrections.js';
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
function context(guild: string, matches = 1) {
  vi.stubEnv('DAILY_PARTICIPATION_ENABLED', 'true');
  vi.stubEnv('DAILY_BONUS_ENABLED', 'true');
  vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', guild);
  const sent = { id: '323456789012345678' },
    send = vi.fn(async (_options: unknown) => sent),
    history = new Collection(
      Array.from({ length: matches }, (_, i) => {
        const id = `32345678901234567${i}`;
        return [
          id,
          {
            id,
            author: { id: '223456789012345678' },
            embeds: [{ footer: { text: `daily-correction:${f.correctionDelivery.correctionId}` } }],
          },
        ] as const;
      }),
    );
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
function envelope(ctx: { guildId: string; client: { user: { id: string } } }, status: string) {
  return {
    status: 'ok',
    guildId: ctx.guildId,
    discordUserId: ctx.client.user.id,
    deliveries: [{ ...f.correctionDelivery, status }],
  };
}
it('sends a correction once without a mention and confirms the ACK echo', async () => {
  const { ctx, channel, sent } = context('guild-correction-send');
  mock.request.mockResolvedValueOnce(envelope(ctx, 'sending')).mockResolvedValueOnce({
    status: 'ok',
    correctionId: f.correctionDelivery.correctionId,
    messageId: sent.id,
  });
  await scanCorrectionDeliveries(ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0]);
  expect(channel.send).toHaveBeenCalledOnce();
  const options = channel.send.mock.calls[0]![0] as {
    content?: string;
    allowedMentions: unknown;
    enforceNonce: boolean;
    nonce: string;
    embeds: { toJSON: () => { footer?: { text: string } } }[];
  };
  expect(options.content).toBeUndefined();
  expect(options.allowedMentions).toEqual({ parse: [] });
  expect(options.enforceNonce).toBe(true);
  expect(options.nonce).toBe(
    createHash('sha256')
      .update(`daily-correction:${ctx.guildId}:${f.correctionDelivery.correctionId}`)
      .digest('hex')
      .slice(0, 25),
  );
  expect(options.embeds[0]!.toJSON().footer?.text).toBe(
    `daily-correction:${f.correctionDelivery.correctionId}`,
  );
  expect(mock.request).toHaveBeenCalledTimes(2);
  expect(mock.request.mock.calls[1]![2]).toBe('/v2/participation/herta/corrections/ack');
  expect(mock.request.mock.calls[1]![3]).toEqual({
    correctionId: f.correctionDelivery.correctionId,
    deliveryToken: f.correctionDelivery.deliveryToken,
    messageId: sent.id,
  });
  expect(ctx.logger.warn).not.toHaveBeenCalledWith('Daily correction acknowledgement unconfirmed');
});
it('lost ACK resumes from durable uncertain state and never resends the correction', async () => {
  const { ctx, channel, sent } = context('guild-correction-restart');
  mock.request
    .mockResolvedValueOnce(envelope(ctx, 'sending'))
    .mockRejectedValueOnce(new Error('synthetic lost ACK'));
  await scanCorrectionDeliveries(ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0]);
  mock.request.mockResolvedValueOnce(envelope(ctx, 'uncertain')).mockResolvedValueOnce({
    status: 'ok',
    correctionId: f.correctionDelivery.correctionId,
    messageId: sent.id,
  });
  await scanCorrectionDeliveries(ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0]);
  expect(channel.send).toHaveBeenCalledOnce();
  expect(channel.messages.fetch).toHaveBeenCalledOnce();
});
it('ACK echo mismatch stays unconfirmed and is retried through reconciliation', async () => {
  const { ctx, channel, sent } = context('guild-correction-mismatch');
  mock.request.mockResolvedValueOnce(envelope(ctx, 'sending')).mockResolvedValueOnce({
    status: 'ok',
    correctionId: f.correctionDelivery.correctionId,
    messageId: '999999999999999999',
  });
  await scanCorrectionDeliveries(ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0]);
  expect(ctx.logger.warn).toHaveBeenCalledWith('Daily correction acknowledgement unconfirmed');
  mock.request.mockResolvedValueOnce(envelope(ctx, 'uncertain')).mockResolvedValueOnce({
    status: 'ok',
    correctionId: f.correctionDelivery.correctionId,
    messageId: sent.id,
  });
  await scanCorrectionDeliveries(ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0]);
  expect(channel.send).toHaveBeenCalledOnce();
  expect(mock.request).toHaveBeenCalledTimes(4);
});
it('uncertain delivery without exactly one matching message is not acknowledged', async () => {
  for (const [guild, matches] of [
    ['guild-correction-none', 0],
    ['guild-correction-many', 2],
  ] as const) {
    const { ctx, channel } = context(guild, matches);
    mock.request.mockResolvedValueOnce(envelope(ctx, 'uncertain'));
    await scanCorrectionDeliveries(
      ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0],
    );
    expect(channel.send).not.toHaveBeenCalled();
    expect(mock.request).toHaveBeenCalledTimes(1);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'Daily correction notification requires reconciliation',
    );
    mock.request.mockReset();
  }
});
it('does not poll or warn for intentionally unsupported guilds', async () => {
  const { ctx, channel } = context('unsupported-guild-corrections');
  vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', 'configured-guild');
  for (let i = 0; i < 4; i++)
    await scanCorrectionDeliveries(
      ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0],
    );
  expect(mock.request).not.toHaveBeenCalled();
  expect(channel.send).not.toHaveBeenCalled();
});
it('routes the delay alert to the configured alert channel after repeated failures', async () => {
  const guild = 'guild-corrections-alert-route';
  vi.stubEnv('DAILY_PARTICIPATION_ENABLED', 'true');
  vi.stubEnv('DAILY_BONUS_ENABLED', 'true');
  vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', guild);
  const announcementSend = vi.fn(async (_options: unknown) => ({ id: '323456789012345678' })),
    alertSend = vi.fn(async (_options: unknown) => ({ id: '423456789012345678' })),
    base = {
      isTextBased: () => true,
      isThread: () => false,
      permissionsFor: () => ({ has: () => true }),
      messages: { fetch: vi.fn(async () => new Collection()) },
    },
    announcement = { ...base, send: announcementSend },
    alertChannel = { ...base, send: alertSend };
  const ctx = {
    guildId: guild,
    client: {
      user: { id: '223456789012345678' },
      guilds: {
        fetch: async () => ({
          channels: {
            fetch: async (id: string) =>
              id === '523456789012345678' ? alertChannel : announcement,
          },
          members: { fetchMe: async () => ({}) },
        }),
      },
    },
    config: {
      enabled: true,
      channelId: '423456789012345678',
      alertChannelId: '523456789012345678',
    },
    logger: { warn: vi.fn() },
  };
  mock.request.mockRejectedValue(new Error('synthetic API outage'));
  for (let i = 0; i < 3; i++)
    await scanCorrectionDeliveries(
      ctx as unknown as Parameters<typeof scanCorrectionDeliveries>[0],
    );
  expect(alertSend).toHaveBeenCalledOnce();
  expect((alertSend.mock.calls[0]![0] as { content: string }).content).toContain('遅延しています');
  expect(announcementSend).not.toHaveBeenCalled();
});
