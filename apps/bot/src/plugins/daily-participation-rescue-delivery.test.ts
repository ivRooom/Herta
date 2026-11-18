import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Collection } from 'discord.js';
import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./daily-bonus-wallet.js', () => ({ request: mock.request }));
import { scanRescueAnnouncements } from './daily-participation-rescue.js';
const f = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/daily-participation.v2.fixture.json', import.meta.url),
    'utf8',
  ),
);
const roleId = '123456789012345678';
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
            embeds: [{ footer: { text: `daily-rescue:${f.rescueDelivery.questionId}` } }],
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
      config: { enabled: true, channelId: '423456789012345678', notificationRoleId: roleId },
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
    deliveries: [{ ...f.rescueDelivery, status }],
  };
}
it('announces a rescue question once with only the notification role mentioned', async () => {
  const { ctx, channel, sent } = context('guild-rescue-send');
  mock.request.mockResolvedValueOnce(envelope(ctx, 'sending')).mockResolvedValueOnce({
    status: 'ok',
    questionId: f.rescueDelivery.questionId,
    messageId: sent.id,
  });
  await scanRescueAnnouncements(ctx as unknown as Parameters<typeof scanRescueAnnouncements>[0]);
  expect(channel.send).toHaveBeenCalledOnce();
  const options = channel.send.mock.calls[0]![0] as {
    content?: string;
    allowedMentions: unknown;
    enforceNonce: boolean;
    nonce: string;
    embeds: { toJSON: () => { footer?: { text: string } } }[];
    components: { toJSON: () => { components: { url?: string }[] } }[];
  };
  expect(options.content).toBe(`<@&${roleId}>`);
  expect(options.allowedMentions).toEqual({
    parse: [],
    roles: [roleId],
    users: [],
    repliedUser: false,
  });
  expect(options.enforceNonce).toBe(true);
  expect(options.nonce).toBe(
    createHash('sha256')
      .update(`daily-rescue:${ctx.guildId}:${f.rescueDelivery.questionId}`)
      .digest('hex')
      .slice(0, 25),
  );
  expect(options.embeds[0]!.toJSON().footer?.text).toBe(
    `daily-rescue:${f.rescueDelivery.questionId}`,
  );
  expect(options.components[0]!.toJSON().components[0]!.url).toBe(
    'https://member.ivrm.jp/participation',
  );
  expect(mock.request).toHaveBeenCalledTimes(2);
  expect(mock.request.mock.calls[1]![2]).toBe('/v2/participation/herta/rescue/ack');
  expect(mock.request.mock.calls[1]![3]).toEqual({
    questionId: f.rescueDelivery.questionId,
    deliveryToken: f.rescueDelivery.deliveryToken,
    messageId: sent.id,
  });
  expect(ctx.logger.warn).not.toHaveBeenCalledWith('Daily rescue acknowledgement unconfirmed');
});
it('lost ACK resumes from durable uncertain state and never resends the announcement', async () => {
  const { ctx, channel, sent } = context('guild-rescue-restart');
  mock.request
    .mockResolvedValueOnce(envelope(ctx, 'sending'))
    .mockRejectedValueOnce(new Error('synthetic lost ACK'));
  await scanRescueAnnouncements(ctx as unknown as Parameters<typeof scanRescueAnnouncements>[0]);
  mock.request.mockResolvedValueOnce(envelope(ctx, 'uncertain')).mockResolvedValueOnce({
    status: 'ok',
    questionId: f.rescueDelivery.questionId,
    messageId: sent.id,
  });
  await scanRescueAnnouncements(ctx as unknown as Parameters<typeof scanRescueAnnouncements>[0]);
  expect(channel.send).toHaveBeenCalledOnce();
  expect(channel.messages.fetch).toHaveBeenCalledOnce();
});
it('uncertain announcement without exactly one matching message is not acknowledged', async () => {
  const { ctx, channel } = context('guild-rescue-none', 0);
  mock.request.mockResolvedValueOnce(envelope(ctx, 'uncertain'));
  await scanRescueAnnouncements(ctx as unknown as Parameters<typeof scanRescueAnnouncements>[0]);
  expect(channel.send).not.toHaveBeenCalled();
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(ctx.logger.warn).toHaveBeenCalledWith('Daily rescue announcement requires reconciliation');
});
it('does not poll or warn for intentionally unsupported guilds', async () => {
  const { ctx, channel } = context('unsupported-guild-rescue');
  vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', 'configured-guild');
  for (let i = 0; i < 4; i++)
    await scanRescueAnnouncements(ctx as unknown as Parameters<typeof scanRescueAnnouncements>[0]);
  expect(mock.request).not.toHaveBeenCalled();
  expect(channel.send).not.toHaveBeenCalled();
});
it('routes the delay alert to the configured alert channel after repeated failures', async () => {
  const guild = 'guild-rescue-alert-route';
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
      notificationRoleId: roleId,
      alertChannelId: '523456789012345678',
    },
    logger: { warn: vi.fn() },
  };
  mock.request.mockRejectedValue(new Error('synthetic API outage'));
  const t0 = Date.UTC(2026, 10, 19, 1, 0, 0);
  let now = t0;
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const scan = () =>
      scanRescueAnnouncements(ctx as unknown as Parameters<typeof scanRescueAnnouncements>[0]);
    await scan();
    now = t0 + 300_000;
    await scan();
    expect(alertSend).not.toHaveBeenCalled();
    now = t0 + 600_000;
    await scan();
  } finally {
    nowSpy.mockRestore();
  }
  expect(alertSend).toHaveBeenCalledOnce();
  const content = (alertSend.mock.calls[0]![0] as { content: string }).content;
  expect(content).toContain('遅延しています');
  expect(content).toContain('アラートID: 20261119-1000-S');
  expect(content).toContain('初回通知');
  expect(announcementSend).not.toHaveBeenCalled();
});
