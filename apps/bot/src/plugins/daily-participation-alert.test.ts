import { PermissionFlagsBits } from 'discord.js';
import { expect, it, vi } from 'vitest';
import {
  DailyDeliveryFailureTracker,
  dailyDeliveryAlertFooter,
  dailyDeliveryAlertId,
  dailyDeliveryAlertMessage,
  dailyDeliveryAlertSender,
} from './daily-participation-alert.js';

const ALERT_CHANNEL_ID = '523456789012345678';

function setup(options: {
  alertChannelId?: string;
  sendMessages?: boolean;
  embedLinks?: boolean;
  fetchFails?: boolean;
}) {
  const fallbackSend = vi.fn(async (_options: unknown) => ({ id: 'fallback-message' }));
  const alertSend = vi.fn(async (_options: unknown) => ({ id: 'alert-message' }));
  const alertChannel = {
    isTextBased: () => true,
    isThread: () => false,
    send: alertSend,
    permissionsFor: () => ({
      // ViewChannel is never granted: the ops channel is post-only for the
      // bot, and the alert must still be delivered.
      has: (permission: unknown) =>
        options.sendMessages !== false &&
        (permission === PermissionFlagsBits.SendMessages ||
          (options.embedLinks === true && permission === PermissionFlagsBits.EmbedLinks)),
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

const T0 = Date.UTC(2026, 10, 18, 16, 18); // 2026-11-19 01:18 JST
const MESSAGE = dailyDeliveryAlertMessage(
  'results',
  { id: '20261119-0118-R', firstFailureAt: T0, lastAlertAt: 0 },
  T0 + 600_000,
);

it('sends an embed to the configured alert channel when embeds are allowed', async () => {
  const { guild, fallback, fallbackSend, alertSend } = setup({
    alertChannelId: ALERT_CHANNEL_ID,
    embedLinks: true,
  });
  const send = await dailyDeliveryAlertSender(
    asGuild(guild),
    asMember({}),
    ALERT_CHANNEL_ID,
    fallback,
  );
  await send(MESSAGE);
  expect(alertSend).toHaveBeenCalledOnce();
  expect(alertSend.mock.calls[0]![0]).toEqual({
    embeds: [MESSAGE.embed],
    allowedMentions: { parse: [] },
  });
  expect(fallbackSend).not.toHaveBeenCalled();
});

it('sends plain text to the alert channel when embeds are not allowed there', async () => {
  const { guild, fallback, fallbackSend, alertSend } = setup({
    alertChannelId: ALERT_CHANNEL_ID,
  });
  const send = await dailyDeliveryAlertSender(
    asGuild(guild),
    asMember({}),
    ALERT_CHANNEL_ID,
    fallback,
  );
  await send(MESSAGE);
  expect(alertSend).toHaveBeenCalledOnce();
  expect(alertSend.mock.calls[0]![0]).toEqual({
    content: MESSAGE.text,
    allowedMentions: { parse: [] },
  });
  expect(fallbackSend).not.toHaveBeenCalled();
});

it('falls back to the announcement channel when no alert channel is configured', async () => {
  const { guild, fallback, fallbackSend, alertSend } = setup({});
  const send = await dailyDeliveryAlertSender(asGuild(guild), asMember({}), undefined, fallback);
  await send(MESSAGE);
  expect(fallbackSend).toHaveBeenCalledOnce();
  expect(fallbackSend.mock.calls[0]![0]).toEqual({
    embeds: [MESSAGE.embed],
    allowedMentions: { parse: [] },
  });
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
  await send(MESSAGE);
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
  await send(MESSAGE);
  expect(fallbackSend).toHaveBeenCalledOnce();
  expect(alertSend).not.toHaveBeenCalled();
});

it('alert message renders a structured embed and the equivalent plain text', () => {
  expect(MESSAGE.embed.title).toContain('集計・結果配信が遅延しています');
  expect(MESSAGE.embed.description).toContain('管理画面の集計状態を確認してください');
  expect(MESSAGE.embed.fields).toEqual([
    { name: 'アラートID', value: '20261119-0118-R', inline: true },
    { name: '状態', value: '初回通知', inline: true },
    { name: '発生', value: '01:18', inline: true },
    { name: '経過', value: '10分', inline: true },
  ]);
  expect(MESSAGE.embed.timestamp).toBe(new Date(T0).toISOString());
  expect(MESSAGE.text).toBe(
    '⚠️ 日次問題の集計・結果配信が遅延しています。管理者は管理画面の集計状態を確認してください。確定済みの受取・回答は保持されています。\n' +
      'アラートID: 20261119-0118-R（初回通知） / 発生 01:18 / 経過 10分',
  );
});

it('alert id is derived from the JST start of the failure streak', () => {
  const started = Date.UTC(2026, 10, 18, 16, 18); // 2026-11-19 01:18 JST
  expect(dailyDeliveryAlertId('results', started)).toBe('20261119-0118-R');
  expect(dailyDeliveryAlertId('corrections', started)).toBe('20261119-0118-C');
  expect(dailyDeliveryAlertId('rescue', started)).toBe('20261119-0118-S');
});

it('tracker stays silent until failures persist for ten minutes', () => {
  const tracker = new DailyDeliveryFailureTracker('results');
  const t0 = Date.UTC(2026, 10, 19, 0, 0, 0);
  expect(tracker.recordFailure(t0)).toBeNull();
  expect(tracker.recordFailure(t0 + 599_000)).toBeNull();
  const incident = tracker.recordFailure(t0 + 600_000);
  expect(incident?.id).toBe('20261119-0900-R');
  expect(incident?.firstFailureAt).toBe(t0);
});

it('tracker keeps returning the incident until the alert is recorded as sent', () => {
  const tracker = new DailyDeliveryFailureTracker('rescue');
  const t0 = Date.UTC(2026, 10, 19, 0, 0, 0);
  tracker.recordFailure(t0);
  const due = tracker.recordFailure(t0 + 600_000);
  expect(due).not.toBeNull();
  expect(tracker.recordFailure(t0 + 660_000)?.id).toBe(due?.id);
});

it('tracker repeats the same incident every three hours while failures continue', () => {
  const tracker = new DailyDeliveryFailureTracker('corrections');
  const t0 = Date.UTC(2026, 10, 19, 0, 0, 0);
  tracker.recordFailure(t0);
  const first = tracker.recordFailure(t0 + 600_000);
  expect(first).not.toBeNull();
  tracker.recordAlertSent(t0 + 600_000);
  expect(tracker.recordFailure(t0 + 600_000 + 10_799_000)).toBeNull();
  const repeat = tracker.recordFailure(t0 + 600_000 + 10_800_000);
  expect(repeat?.id).toBe(first?.id);
  expect(dailyDeliveryAlertFooter(repeat!, t0 + 600_000 + 10_800_000)).toContain('継続通知');
  expect(dailyDeliveryAlertFooter(repeat!, t0 + 600_000 + 10_800_000)).toContain('経過 3時間10分');
});

it('a success ends the incident and the next streak gets a new id', () => {
  const tracker = new DailyDeliveryFailureTracker('results');
  const t0 = Date.UTC(2026, 10, 19, 0, 0, 0);
  tracker.recordFailure(t0);
  const first = tracker.recordFailure(t0 + 600_000);
  tracker.recordSuccess();
  const t1 = t0 + 20_000_000;
  expect(tracker.recordFailure(t1)).toBeNull();
  const next = tracker.recordFailure(t1 + 600_000);
  expect(next?.id).not.toBe(first?.id);
});

it('footer shows the id, first/repeat phase, start time, and elapsed time', () => {
  const t0 = Date.UTC(2026, 10, 18, 16, 18); // 01:18 JST
  const incident = { id: '20261119-0118-R', firstFailureAt: t0, lastAlertAt: 0 };
  expect(dailyDeliveryAlertFooter(incident, t0 + 600_000)).toBe(
    'アラートID: 20261119-0118-R（初回通知） / 発生 01:18 / 経過 10分',
  );
});
