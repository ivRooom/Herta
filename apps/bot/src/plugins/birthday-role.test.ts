import { describe, expect, it } from 'vitest';
import type { IvrmBirthdaySettings } from './birthday-ivrm.js';
import {
  applyIvrmBirthdaySettings,
  birthdayRolePlugin,
  calculateBirthdayAge,
  countServerBirthdaysSinceJoin,
  findNextBirthdays,
  formatBirthdayListPages,
  formatLocalDate,
  getDaysUntilBirthday,
  getLocalDateParts,
  isLeapYear,
  isValidBirthday,
  isValidBirthYear,
  normalizeBirthdayRoleConfig,
  renderBirthdayAnnouncement,
  resolveEffectiveBirthday,
  toBirthdayRegistrationLike,
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

  it('month・dayと任意のyear入力範囲を公開する', () => {
    const setCommand = birthdayRolePlugin.manifest.commands[0]?.subcommands?.find(
      (item) => item.name === 'set',
    );
    const month = setCommand?.options?.find((item) => item.name === 'month');
    const day = setCommand?.options?.find((item) => item.name === 'day');
    const year = setCommand?.options?.find((item) => item.name === 'year');

    expect(month).toMatchObject({ minValue: 1, maxValue: 12 });
    expect(day).toMatchObject({ minValue: 1, maxValue: 31 });
    expect(year).toMatchObject({
      required: false,
      minValue: 1900,
      maxValue: 2100,
    });
  });
});

describe('normalizeBirthdayRoleConfig', () => {
  it('既存設定を壊さずBirthday Cardの安全な既定値を補完する', () => {
    expect(normalizeBirthdayRoleConfig({})).toMatchObject({
      enabled: true,
      ephemeralResponses: true,
      allowSelfRegistration: true,
      assignRole: true,
      birthdayRoleId: null,
      sendAnnouncement: true,
      announcementChannelId: null,
      announcementMessage: '🎂 {user} {ageText}お誕生日おめでとう！',
      leapDayPolicy: 'february-28',
      birthdayCardEnabled: false,
      birthdayCardPreset: 'herta-lavender-tea',
      birthdayCardShowName: true,
      birthdayCardShowAvatar: true,
      birthdayCardShowBirthday: true,
      birthdayCardShowAge: true,
    });
  });

  it('ivrm-web連携フラグは既定OFFで、明示した時だけONになる', () => {
    expect(normalizeBirthdayRoleConfig({}).useIvrmApiSource).toBe(false);
    expect(normalizeBirthdayRoleConfig({ useIvrmApiSource: true }).useIvrmApiSource).toBe(true);
    expect(normalizeBirthdayRoleConfig({ useIvrmApiSource: 'true' }).useIvrmApiSource).toBe(false);
  });

  it('Discord ID・自己登録設定・メッセージを正規化する', () => {
    expect(
      normalizeBirthdayRoleConfig({
        allowSelfRegistration: false,
        birthdayRoleId: ' 123 ',
        announcementChannelId: 'invalid',
        announcementMessage: '  Happy {user}!  ',
        leapDayPolicy: 'march-1',
      }),
    ).toMatchObject({
      allowSelfRegistration: false,
      birthdayRoleId: '123',
      announcementChannelId: null,
      announcementMessage: 'Happy {user}!',
      leapDayPolicy: 'march-1',
    });
  });
});

describe('birthday announcement', () => {
  it('user・month・day・age・serverBirthdayNumber変数を展開する', () => {
    expect(
      renderBirthdayAnnouncement(
        '🎂 {user} {month}月{day}日 {ageText}おめでとう！参加後{serverBirthdayNumber}回目',
        {
          userId: '123456789012345678',
          month: 8,
          day: 14,
          birthYear: 2000,
        },
        { age: 26, serverBirthdayNumber: 3 },
      ),
    ).toBe('🎂 <@123456789012345678> 8月14日 26歳のおめでとう！参加後3回目');
  });

  it('生年未登録なら年齢変数を空文字にする', () => {
    expect(
      renderBirthdayAnnouncement('🎂 {user} {ageText}お誕生日おめでとう！', {
        userId: '123456789012345678',
        month: 8,
        day: 14,
      }),
    ).toBe('🎂 <@123456789012345678> お誕生日おめでとう！');
  });
});

describe('ivrm-web連携の設定適用 (#961 S5a)', () => {
  const apiSettings: IvrmBirthdaySettings = {
    enabled: true,
    announcementChannelId: '123456789012345678',
    birthdayRoleId: '223456789012345678',
    announcementMessage: '🎂 {user} お誕生日おめでとう！',
    leapDayPolicy: 'march-1',
    pointsAmount: 300,
    card: {
      enabled: true,
      preset: 'herta-night-board',
      backgroundUrl: 'https://example.invalid/bg.png',
      showName: false,
      showAvatar: true,
      showBirthday: false,
    },
  };

  it('配信系設定はAPI値で上書きし、年齢表示は常時OFFにする', () => {
    const local = normalizeBirthdayRoleConfig({
      announcementChannelId: '999999999999999999',
      birthdayRoleId: '888888888888888888',
      announcementMessage: 'local {user}',
      leapDayPolicy: 'skip',
      birthdayCardEnabled: false,
      birthdayCardShowAge: true,
    });
    const applied = applyIvrmBirthdaySettings(local, apiSettings);
    expect(applied).toMatchObject({
      announcementChannelId: '123456789012345678',
      birthdayRoleId: '223456789012345678',
      announcementMessage: '🎂 {user} お誕生日おめでとう！',
      leapDayPolicy: 'march-1',
      birthdayCardEnabled: true,
      birthdayCardPreset: 'herta-night-board',
      birthdayCardShowName: false,
      birthdayCardShowAvatar: true,
      birthdayCardShowBirthday: false,
      birthdayCardShowAge: false,
    });
  });

  it('プラグイン側トグルとStudio所有のレイアウトはローカル値を維持する', () => {
    const local = normalizeBirthdayRoleConfig({
      assignRole: false,
      sendAnnouncement: false,
      birthdayCardAvatarX: 12,
      birthdayCardBackgroundSource: 'custom',
    });
    const applied = applyIvrmBirthdaySettings(local, apiSettings);
    expect(applied.assignRole).toBe(false);
    expect(applied.sendAnnouncement).toBe(false);
    expect(applied.birthdayCardAvatarX).toBe(12);
    expect(applied.birthdayCardBackgroundSource).toBe('custom');
    expect(applied.useIvrmApiSource).toBe(local.useIvrmApiSource);
  });

  it('API対象者を登録形式へ変換し、生年は常にnullにする', () => {
    const converted = toBirthdayRegistrationLike({
      memberId: 'member-a',
      discordUserId: '123456789012345678',
      displayName: 'A',
      month: 11,
      day: 22,
    });
    expect(converted).toEqual({
      userId: '123456789012345678',
      month: 11,
      day: 22,
      birthYear: null,
      displayName: 'A',
    });
    // 年齢変数は空になる（カード・文面とも名前＋月日のみ）
    expect(
      renderBirthdayAnnouncement('🎂 {user} {ageText}お誕生日おめでとう！', converted, {
        age: calculateBirthdayAge(converted.birthYear, 2026),
        serverBirthdayNumber: 2,
      }),
    ).toBe('🎂 <@123456789012345678> お誕生日おめでとう！');
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

  it('生年は1900年から現在年までを許可する', () => {
    expect(isValidBirthYear(1900, 2026)).toBe(true);
    expect(isValidBirthYear(2026, 2026)).toBe(true);
    expect(isValidBirthYear(1899, 2026)).toBe(false);
    expect(isValidBirthYear(2027, 2026)).toBe(false);
    expect(calculateBirthdayAge(2000, 2026)).toBe(26);
    expect(calculateBirthdayAge(null, 2026)).toBeNull();
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

  it('サーバー参加後の何回目の誕生日かを数える', () => {
    expect(
      countServerBirthdaysSinceJoin(
        { year: 2024, month: 9, day: 1 },
        { userId: '1', month: 8, day: 19 },
        2026,
        'february-28',
      ),
    ).toBe(2);
    expect(
      countServerBirthdaysSinceJoin(
        { year: 2024, month: 1, day: 1 },
        { userId: '1', month: 8, day: 19 },
        2026,
        'february-28',
      ),
    ).toBe(3);
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

  it('skipでも次のうるう年まで2月29日を探索する', () => {
    const days = getDaysUntilBirthday(
      { userId: '1', month: 2, day: 29 },
      { year: 2026, month: 3, day: 1 },
      'skip',
    );

    expect(days).not.toBeNull();
    expect(days).toBeGreaterThan(700);
  });

  it('2100年を飛ばして次の有効な2月29日を探索する', () => {
    const days = getDaysUntilBirthday(
      { userId: '1', month: 2, day: 29 },
      { year: 2099, month: 3, day: 1 },
      'skip',
    );

    expect(days).not.toBeNull();
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
  it('月日順に並べ、生年は公開一覧へ出さない', () => {
    const pages = formatBirthdayListPages([
      { userId: '300', month: 12, day: 1, birthYear: 2000 },
      { userId: '100', month: 1, day: 2, birthYear: 1999 },
      { userId: '200', month: 1, day: 1 },
    ]);
    const text = pages.join('\n');

    expect(text.indexOf('01/01')).toBeLessThan(text.indexOf('01/02'));
    expect(text.indexOf('01/02')).toBeLessThan(text.indexOf('12/01'));
    expect(text).not.toContain('1999');
    expect(text).not.toContain('2000');
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
