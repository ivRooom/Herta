import { describe, expect, it } from 'vitest';
import {
  buildEventMessage,
  formatEventListPages,
  normalizeEventRsvpConfig,
  parseEventStart,
} from './event-rsvp.js';

describe('Event / RSVP v1', () => {
  it('設定を安全な既定値と範囲へ正規化する', () => {
    expect(normalizeEventRsvpConfig(undefined)).toMatchObject({
      enabled: true,
      timezone: 'Asia/Tokyo',
      defaultCapacity: 0,
      maxCapacity: 100,
      allowMaybe: true,
      allowWaitlist: true,
      reminderMinutesBefore: 60,
      maxActivePerUser: 5,
    });
    expect(normalizeEventRsvpConfig({ maxCapacity: 20, defaultCapacity: 99 })).toMatchObject({
      maxCapacity: 20,
      defaultCapacity: 20,
    });
  });

  it('Asia/Tokyoのローカル日時をUTC Dateへ変換する', () => {
    const date = parseEventStart('2030-01-02 20:30', 'Asia/Tokyo', Date.UTC(2029, 0, 1));
    expect(date?.toISOString()).toBe('2030-01-02T11:30:00.000Z');
  });

  it('受付中EventにRSVP Buttonと参加状況を表示する', () => {
    const message = buildEventMessage({
      id: '00000000-0000-4000-8000-000000000001',
      guildId: '1',
      creatorId: '2',
      channelId: '3',
      messageId: '4',
      title: 'ゲーム会',
      description: 'みんなで遊ぶ',
      location: 'VC1',
      timezone: 'Asia/Tokyo',
      startsAt: new Date('2030-01-02T11:30:00Z'),
      registrationClosesAt: new Date('2030-01-02T11:30:00Z'),
      capacity: 10,
      status: 'open',
      allowMaybe: true,
      allowWaitlist: true,
      reminderMinutes: 60,
      reminderSentAt: null,
      finalizedAt: null,
      goingCount: 4,
      maybeCount: 2,
      declinedCount: 1,
      waitlistCount: 0,
    });
    expect(message.content).toContain('ゲーム会');
    expect(message.content).toContain('4/10人');
    expect(message.components[0]).toBeDefined();
    expect(message.allowedMentions).toEqual({ parse: [] });
  });

  it('終了EventではButtonを除去する', () => {
    const message = buildEventMessage({
      id: '00000000-0000-4000-8000-000000000001',
      guildId: '1',
      creatorId: '2',
      channelId: '3',
      messageId: '4',
      title: '終了',
      description: null,
      location: null,
      timezone: 'Asia/Tokyo',
      startsAt: new Date('2030-01-02T11:30:00Z'),
      registrationClosesAt: new Date('2030-01-02T10:30:00Z'),
      capacity: null,
      status: 'closed',
      allowMaybe: true,
      allowWaitlist: true,
      reminderMinutes: 60,
      reminderSentAt: null,
      finalizedAt: null,
      goingCount: 4,
      maybeCount: 0,
      declinedCount: 0,
      waitlistCount: 0,
    });
    expect(message.components).toEqual([]);
    expect(message.content).toContain('締切済み');
  });

  it('Event一覧をDiscord文字数上限内でページ分割する', () => {
    const records = Array.from({ length: 80 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Event ${index} ${'x'.repeat(30)}`,
      startsAt: new Date('2030-01-02T11:30:00Z'),
      status: 'open' as const,
      goingCount: index,
      capacity: 100,
    }));
    const pages = formatEventListPages(records);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
  });
});
