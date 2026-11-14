import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import {
  clearDailySupportNotificationLog,
  dailySupportActionRow,
  dailySupportConfigured,
  dailySupportDedupeKey,
  dailySupportFailureClass,
  dailySupportNotificationContent,
  dailySupportNotifyCustomId,
  isDailySupportInteraction,
  parseDailySupportNotifyCustomId,
  releaseDailySupportNotification,
  sendDailySupportNotification,
  tryReserveDailySupportNotification,
  DAILY_SUPPORT_DEDUPE_WINDOW_MS,
  type DailySupportConfig,
  type DailySupportReference,
} from './daily-support.js';

const claimRef: DailySupportReference = {
  kind: 'claim',
  failureClass: 'service_unavailable',
  target: '2026-11-14',
};
const answerRef: DailySupportReference = {
  kind: 'answer',
  failureClass: 'unexpected',
  target: 'quiz_abc-123',
};
const configured = { supportChannelId: '123456789012345678', supportRoleId: '234567890123456789' };

describe('daily support failure classification', () => {
  it.each([
    ['unavailable', 'service_unavailable'],
    ['unlinked', 'account_unlinked'],
    ['profile_required', null],
    ['account_initialization_required', null],
    ['confirmed', null],
    ['ready', null],
    ['quiz', null],
  ])('maps wallet status %s to %s', (status, expected) => {
    expect(dailySupportFailureClass(status)).toBe(expected);
  });
});

describe('daily support notify custom id', () => {
  it.each([claimRef, answerRef])('round-trips %o', (ref) => {
    const customId = dailySupportNotifyCustomId(ref);
    expect(isDailySupportInteraction(customId)).toBe(true);
    expect(parseDailySupportNotifyCustomId(customId)).toEqual(ref);
  });

  it.each([
    'daily-support:notify:claim:service_unavailable:not-a-date',
    'daily-support:notify:claim:unknown_class:2026-11-14',
    'daily-support:notify:fortune:unexpected:2026-11-14',
    'daily-support:notify:answer:unexpected:',
    'daily-support:notify:answer:unexpected:has space',
    'daily-bonus:2026-11-14',
    'daily-participation:questions:2026-11-14',
  ])('rejects %s', (customId) => {
    expect(parseDailySupportNotifyCustomId(customId)).toBeNull();
  });
});

describe('daily support action row', () => {
  it('shows notify and portal buttons when configured', () => {
    const row = dailySupportActionRow(claimRef, configured).toJSON();
    expect(row.components).toHaveLength(2);
    const components = row.components as unknown as Record<string, unknown>[];
    const notify = components[0]!;
    const link = components[1]!;
    expect(notify.custom_id).toBe(dailySupportNotifyCustomId(claimRef));
    expect(notify.label).toBe('🛠 運営に知らせる');
    expect(notify.disabled).toBeFalsy();
    expect(link.url).toBe('https://member.ivrm.jp/login-bonus');
    expect(link.label).toBe('Memberポータルで試す');
  });

  it('links answers to the participation page', () => {
    const row = dailySupportActionRow(answerRef, configured).toJSON();
    const link = row.components[1] as unknown as Record<string, unknown> | undefined;
    expect(link?.url).toBe('https://member.ivrm.jp/participation');
  });

  it('disables the notify button once reported', () => {
    const row = dailySupportActionRow(claimRef, configured, true).toJSON();
    const notify = row.components[0] as unknown as Record<string, unknown> | undefined;
    expect(notify?.disabled).toBe(true);
    expect(notify?.label).toBe('🛠 運営に知らせました');
  });

  it.each([
    [{}, 'unconfigured'],
    [{ supportChannelId: '' }, 'empty channel'],
    [{ supportChannelId: 'not-a-channel' }, 'invalid channel'],
  ] as [DailySupportConfig, string][])('shows only the portal link when %s (%s)', (config) => {
    expect(dailySupportConfigured(config)).toBe(false);
    const row = dailySupportActionRow(claimRef, config).toJSON();
    expect(row.components).toHaveLength(1);
    const link = row.components[0] as unknown as Record<string, unknown> | undefined;
    expect(link?.url).toBe('https://member.ivrm.jp/login-bonus');
  });
});

describe('daily support notification dedupe', () => {
  beforeEach(() => clearDailySupportNotificationLog());

  it('allows the first report and blocks repeats within the window', () => {
    const key = dailySupportDedupeKey('guild', 'user', claimRef);
    const start = 1_000_000;
    expect(tryReserveDailySupportNotification(key, start)).toBe(true);
    expect(tryReserveDailySupportNotification(key, start + 1000)).toBe(false);
    expect(tryReserveDailySupportNotification(key, start + DAILY_SUPPORT_DEDUPE_WINDOW_MS)).toBe(
      true,
    );
  });

  it('keys dedupe by member, kind and target', () => {
    const start = 2_000_000;
    expect(
      tryReserveDailySupportNotification(dailySupportDedupeKey('guild', 'user', claimRef), start),
    ).toBe(true);
    expect(
      tryReserveDailySupportNotification(dailySupportDedupeKey('guild', 'other', claimRef), start),
    ).toBe(true);
    expect(
      tryReserveDailySupportNotification(dailySupportDedupeKey('guild', 'user', answerRef), start),
    ).toBe(true);
  });

  it('releases the slot when sending failed', () => {
    const key = dailySupportDedupeKey('guild', 'user', claimRef);
    expect(tryReserveDailySupportNotification(key, 3000)).toBe(true);
    releaseDailySupportNotification(key);
    expect(tryReserveDailySupportNotification(key, 3001)).toBe(true);
  });
});

describe('daily support notification content', () => {
  it('carries only member, time and failure kind', () => {
    const content = dailySupportNotificationContent({
      userId: '345678901234567890',
      userDisplayName: 'テスト太郎',
      ref: claimRef,
      now: new Date('2026-11-14T05:54:00+09:00'),
    });
    expect(content).toContain('デイリーボーナス受取');
    expect(content).toContain('サービスに接続できない、または応答が異常でした');
    expect(content).toContain('テスト太郎');
    expect(content).toContain('345678901234567890');
    expect(content).toContain('2026-11-14 05:54 JST');
    // The member is identified by id text only, never pinged.
    expect(content).not.toContain('<@');
    expect(content).not.toMatch(/error|stack|token|secret/i);
  });
});

describe('daily support notification sending', () => {
  function fakeClient(send: ReturnType<typeof vi.fn>, fetchable = true) {
    return {
      channels: {
        fetch: vi.fn(async () =>
          fetchable
            ? { isTextBased: () => true, isThread: () => false, send }
            : { isTextBased: () => false, isThread: () => false, send },
        ),
      },
    } as unknown as Client;
  }

  it('does nothing when unconfigured', async () => {
    const send = vi.fn();
    const sent = await sendDailySupportNotification(
      { guildId: 'guild', client: fakeClient(send), config: {} },
      { userId: 'u', userDisplayName: 'n', ref: claimRef },
    );
    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('mentions only the support role', async () => {
    const send = vi.fn(async (_payload: unknown) => ({}));
    const sent = await sendDailySupportNotification(
      { guildId: 'guild', client: fakeClient(send), config: configured },
      {
        userId: 'u',
        userDisplayName: 'n',
        ref: claimRef,
        now: new Date('2026-11-14T05:54:00+09:00'),
      },
    );
    expect(sent).toBe(true);
    const payload = send.mock.calls[0]![0] as {
      content: string;
      allowedMentions: { parse: string[]; roles?: string[]; users?: string[] };
    };
    expect(payload.content.startsWith('<@&234567890123456789> ')).toBe(true);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.allowedMentions.roles).toEqual(['234567890123456789']);
    expect(payload.allowedMentions.users).toEqual([]);
  });

  it('posts without a mention when no role is configured', async () => {
    const send = vi.fn(async (_payload: unknown) => ({}));
    const sent = await sendDailySupportNotification(
      {
        guildId: 'guild',
        client: fakeClient(send),
        config: { supportChannelId: configured.supportChannelId },
      },
      { userId: 'u', userDisplayName: 'n', ref: claimRef },
    );
    expect(sent).toBe(true);
    const payload = send.mock.calls[0]![0] as { content: string };
    expect(payload.content).not.toContain('<@&');
  });

  it('fails safe when the channel cannot be used', async () => {
    const send = vi.fn();
    const sent = await sendDailySupportNotification(
      { guildId: 'guild', client: fakeClient(send, false), config: configured },
      { userId: 'u', userDisplayName: 'n', ref: claimRef },
    );
    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
