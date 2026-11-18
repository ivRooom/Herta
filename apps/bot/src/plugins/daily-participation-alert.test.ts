import { PermissionFlagsBits } from 'discord.js';
import { expect, it, vi } from 'vitest';
import { dailyDeliveryAlertSender } from './daily-participation-alert.js';

const ALERT_CHANNEL_ID = '523456789012345678';

function setup(options: { alertChannelId?: string; sendMessages?: boolean; fetchFails?: boolean }) {
  const fallbackSend = vi.fn(async (_options: unknown) => ({ id: 'fallback-message' }));
  const alertSend = vi.fn(async (_options: unknown) => ({ id: 'alert-message' }));
  const alertChannel = {
    isTextBased: () => true,
    isThread: () => false,
    send: alertSend,
    permissionsFor: () => ({
      // Only SendMessages is granted: the ops channel is post-only for the
      // bot (no ViewChannel), and the alert must still be delivered.
      has: (permission: unknown) =>
        options.sendMessages !== false && permission === PermissionFlagsBits.SendMessages,
    }),
  };
  const guild = {
    channels: {
      fetch: options.fetchFails
        ? vi.fn(async () => {
            throw new Error('synthetic fetch failure');
          })
        : vi.fn(async () => alertChannel),
    },
  };
  const fallback = { send: fallbackSend };
  return { guild, fallback, fallbackSend, alertSend, alertChannel };
}

const asGuild = (value: unknown) => value as Parameters<typeof dailyDeliveryAlertSender>[0];
const asMember = (value: unknown) => value as Parameters<typeof dailyDeliveryAlertSender>[1];

it('sends to the configured alert channel without requiring ViewChannel', async () => {
  const { guild, fallback, fallbackSend, alertSend } = setup({
    alertChannelId: ALERT_CHANNEL_ID,
  });
  const send = await dailyDeliveryAlertSender(
    asGuild(guild),
    asMember({}),
    ALERT_CHANNEL_ID,
    fallback,
  );
  await send('⚠️ test alert');
  expect(alertSend).toHaveBeenCalledOnce();
  expect(alertSend.mock.calls[0]![0]).toEqual({
    content: '⚠️ test alert',
    allowedMentions: { parse: [] },
  });
  expect(fallbackSend).not.toHaveBeenCalled();
});

it('falls back to the announcement channel when no alert channel is configured', async () => {
  const { guild, fallback, fallbackSend, alertSend } = setup({});
  const send = await dailyDeliveryAlertSender(asGuild(guild), asMember({}), undefined, fallback);
  await send('⚠️ test alert');
  expect(fallbackSend).toHaveBeenCalledOnce();
  expect(alertSend).not.toHaveBeenCalled();
  expect(guild.channels.fetch).not.toHaveBeenCalled();
});

it('falls back when the alert channel cannot be fetched', async () => {
  const { guild, fallback, fallbackSend, alertSend } = setup({
    alertChannelId: ALERT_CHANNEL_ID,
    fetchFails: true,
  });
  const send = await dailyDeliveryAlertSender(
    asGuild(guild),
    asMember({}),
    ALERT_CHANNEL_ID,
    fallback,
  );
  await send('⚠️ test alert');
  expect(fallbackSend).toHaveBeenCalledOnce();
  expect(alertSend).not.toHaveBeenCalled();
});

it('falls back when the bot cannot send in the alert channel', async () => {
  const { guild, fallback, fallbackSend, alertSend } = setup({
    alertChannelId: ALERT_CHANNEL_ID,
    sendMessages: false,
  });
  const send = await dailyDeliveryAlertSender(
    asGuild(guild),
    asMember({}),
    ALERT_CHANNEL_ID,
    fallback,
  );
  await send('⚠️ test alert');
  expect(fallbackSend).toHaveBeenCalledOnce();
  expect(alertSend).not.toHaveBeenCalled();
});
