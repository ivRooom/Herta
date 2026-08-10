import { describe, expect, it } from 'vitest';
import {
  birthdayRolePlugin,
  findNextBirthdays,
  formatBirthdayListPages,
  formatLocalDate,
  getDaysUntilBirthday,
  getLocalDateParts,
  isLeapYear,
  isValidBirthday,
  normalizeBirthdayRoleConfig,
  resolveEffectiveBirthday,
} from './birthday-role.js';

describe('birthdayRolePlugin', () => {
  it('/birthdayの5サブコマンドを公開する', () => {
    expect(birthdayRolePlugin.manifest.commands[0]?.name).toBe('birthday');
    expect(birthdayRolePlugin.manifest.commands[0]?.subcommands?.map((item) => item.name)).toEqual([
      'set',
      'remove',
      'me',
      'next',
      'list',
    ]);
  });
});

describe('normalizeBirthdayRoleConfig', () => {
  it('安全な既定値を補完する', () => {
    expect(normalizeBirthdayRoleConfig({})).toEqual({
      enabled: true,
      ephemeralResponses: true,
      assignRole: true,
      birthdayRoleId: null,
      sendAnnouncement: true,
      announcementChannelId: null,
      announcementMessage: '🎂 {user} お誕生日おめでとう！',
      leapDayPolicy: 'february-28',
    });
  });

  it('Discord IDとメッセージを正規化する', () => {
    expect(
      normalizeBirthdayRoleConfig({
        birthdayRoleId: ' 123 ',
        announcementChannelId: 'invalid',
        announcementMessage: '  Happy {user}!  ',
        leapDayPolicy: 'march-1',
      }),
    ).toMatchObject({
      birthdayRoleId: '123',
      announcementChannelId: null,
      announcementMessage: 'Happy {user}!',
      leapDayPolicy: 'march-1',
    });
  });
});

describe('birthday validation', () => {
  it('存在する月日だけを許可し2月29日は登録できる', () => {
    expect(isValidBirthday(1, 1)).toBe(true);
    expect(isValidBirthday(2, 29)).toBe(true);
    expect(isValidBirthday(2, 30)).toBe(false);
    expect(isValidBirthday(4, 31)).toBe(false);
    expect(isValidBirthday(13, 1)).toBe(false);
  });

  it('グレゴリオ暦のうるう年を判定する', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('非うるう年の2月29日ポリシーを適用する', () => {
    expect(resolveEffectiveBirthday(2, 29, 2026, 'february-28')).toEqual({ month: 2, day: 28 });
    expect(resolveEffectiveBirthday(2, 29, 2026, 'march-1')).toEqual({ month: 3, day: 1 });
    expect(resolveEffectiveBirthday(2, 29, 2026, 'skip')).toBeNull();
    expect(resolveEffectiveBirthday(2, 29, 2028, 'skip')).toEqual({ month: 2, day: 29 });
  });
});

describe('timezone and next birthday', () => {
  it('Guild timezoneでローカル日付を解決する', () => {
    const instant = new Date('2026-08-10T15:30:00.000Z');
    const tokyo = getLocalDateParts(instant, 'Asia/Tokyo');
    const losAngeles = getLocalDateParts(instant, 'America/Los_Angeles');

    expect(tokyo).toEqual({ year: 2026, month: 8, day: 11 });
    expect(losAngeles).toEqual({ year: 2026, month: 8, day: 10 });
    expect(formatLocalDate(tokyo)).toBe('2026-08-11');
  });

  it('年末をまたいで次の誕生日までの日数を計算する', () => {
    expect(
      getDaysUntilBirthday(
        { userId: '1', month: 1, day: 1 },
        { year: 2026, month: 12, day: 31 },
        'february-28',
      ),
    ).toBe(1);
  });

  it('同じ最短日のメンバーをまとめて返す', () => {
    const next = findNextBirthdays(
      [
        { userId: '100', month: 8, day: 12 },
        { userId: '200', month: 8, day: 12 },
        { userId: '300', month: 9, day: 1 },
      ],
      { year: 2026, month: 8, day: 10 },
      'february-28',
    );

    expect(next?.days).toBe(2);
    expect(next?.registrations.map((entry) => entry.userId)).toEqual(['100', '200']);
  });
});

describe('formatBirthdayListPages', () => {
  it('月日順に並べる', () => {
    const pages = formatBirthdayListPages([
      { userId: '300', month: 12, day: 1 },
      { userId: '100', month: 1, day: 2 },
      { userId: '200', month: 1, day: 1 },
    ]);
    const text = pages.join('\n');

    expect(text.indexOf('01/01')).toBeLessThan(text.indexOf('01/02'));
    expect(text.indexOf('01/02')).toBeLessThan(text.indexOf('12/01'));
  });

  it('大量登録を1900文字以内でページ分割し全ユーザーを保持する', () => {
    const registrations = Array.from({ length: 180 }, (_, index) => ({
      userId: (100000000000000000n + BigInt(index)).toString(),
      month: (index % 12) + 1,
      day: (index % 28) + 1,
    }));
    const pages = formatBirthdayListPages(registrations);
    const combined = pages.join('\n');
    const mentions = combined.match(/<@\d+>/g) ?? [];

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
    expect(mentions).toHaveLength(180);
  });
});
