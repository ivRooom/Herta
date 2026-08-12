import { describe, expect, it } from 'vitest';
import {
  DAILY_CONTENT_DEFAULTS,
  DailyContentValidationError,
  isValidIanaTimezone,
  normalizeDailyContentConfig,
  normalizeDailyContentInput,
  normalizeMessageStudioEmbed,
} from './config.js';

describe('Announcement / Message Studio config', () => {
  it('既定値を正規化する', () => {
    expect(normalizeDailyContentConfig({})).toEqual(DAILY_CONTENT_DEFAULTS);
  });

  it('IANA timezoneを検証する', () => {
    expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Invalid/Timezone')).toBe(false);
  });

  it('既存Daily Content入力をdaily/textとして後方互換で正規化する', () => {
    const config = normalizeDailyContentConfig({ defaultTimezone: 'Asia/Tokyo' });
    expect(
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          title: ' 朝の案内 ',
          content: ' おはようございます ',
          scheduleTime: '08:30',
        },
        config,
      ),
    ).toEqual({
      channelId: '123456789012345678',
      title: '朝の案内',
      content: 'おはようございます',
      scheduleTime: '08:30',
      timezone: 'Asia/Tokyo',
      enabled: true,
      recurrenceType: 'daily',
      onceAt: null,
      weekdays: [],
      messageFormat: 'text',
      embed: null,
      publishAnnouncement: false,
    });
  });

  it('1回予約とEmbedを正規化する', () => {
    const config = normalizeDailyContentConfig({ allowAnnouncementCrosspost: true });
    const onceAt = new Date('2099-08-20T11:00:00Z');
    const normalized = normalizeDailyContentInput(
      {
        channelId: '123456789012345678',
        content: '',
        scheduleTime: '20:00',
        recurrenceType: 'once',
        onceAt,
        messageFormat: 'embed',
        embed: {
          title: ' メンテナンス ',
          description: '**20:00** から実施します',
          color: '5865f2',
          imageUrl: 'https://example.com/notice.png',
          footerText: ' Herta ',
        },
        publishAnnouncement: true,
      },
      config,
    );
    expect(normalized.recurrenceType).toBe('once');
    expect(normalized.onceAt).toEqual(onceAt);
    expect(normalized.messageFormat).toBe('embed');
    expect(normalized.embed).toMatchObject({
      title: 'メンテナンス',
      color: '#5865F2',
      imageUrl: 'https://example.com/notice.png',
      footerText: 'Herta',
    });
    expect(normalized.publishAnnouncement).toBe(true);
  });

  it('CrosspostはPlugin設定で許可されている場合だけ保存できる', () => {
    expect(() =>
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          content: 'Announcement',
          scheduleTime: '20:00',
          publishAnnouncement: true,
        },
        normalizeDailyContentConfig({}),
      ),
    ).toThrow('Announcement CrosspostはPlugin設定で許可されていません');
  });

  it('週次配信は曜日を重複除去して昇順にする', () => {
    const normalized = normalizeDailyContentInput(
      {
        channelId: '123456789012345678',
        content: 'Weekly update',
        scheduleTime: '18:00',
        recurrenceType: 'weekly',
        weekdays: [5, 1, 5, 3],
      },
      normalizeDailyContentConfig({}),
    );
    expect(normalized.weekdays).toEqual([1, 3, 5]);
  });

  it('週次配信で曜日がない場合は拒否する', () => {
    expect(() =>
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          content: 'Weekly update',
          scheduleTime: '18:00',
          recurrenceType: 'weekly',
          weekdays: [],
        },
        normalizeDailyContentConfig({}),
      ),
    ).toThrow('週次配信では曜日を1つ以上指定してください');
  });

  it('EmbedのHTTPS画像・文字数・色を検証する', () => {
    expect(() => normalizeMessageStudioEmbed({ imageUrl: 'http://example.com/a.png' })).toThrow(
      'Embed image URLはhttps://で始まるURLを指定してください',
    );
    expect(() => normalizeMessageStudioEmbed({ color: '#GG0000' })).toThrow(
      'Embed colorは#5865F2のような6桁HEXで指定してください',
    );
    expect(() => normalizeMessageStudioEmbed({ title: 'x'.repeat(257) })).toThrow(
      'Embed titleは256文字以内です',
    );
  });

  it.each(['24:00', '8:30', '12:60'])('不正な時刻%sを拒否する', (scheduleTime) => {
    const config = normalizeDailyContentConfig({});
    expect(() =>
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          content: 'content',
          scheduleTime,
        },
        config,
      ),
    ).toThrow(DailyContentValidationError);
  });

  it('危険なメンションを拒否する', () => {
    const config = normalizeDailyContentConfig({});
    expect(() =>
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          content: '@everyone お知らせです',
          scheduleTime: '09:00',
        },
        config,
      ),
    ).toThrow('@everyoneと@hereは使用できません');

    expect(() =>
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          content: '<@&123456789012345678> お知らせです',
          scheduleTime: '09:00',
        },
        config,
      ),
    ).toThrow('ロールメンションは使用できません');
  });

  it('ユーザーメンションは本文とEmbedとも明示許可時だけ受け付ける', () => {
    const input = {
      channelId: '123456789012345678',
      content: '<@123456789012345678> お知らせです',
      scheduleTime: '09:00',
    };
    expect(() => normalizeDailyContentInput(input, normalizeDailyContentConfig({}))).toThrow(
      'ユーザーメンションはPlugin設定で許可されていません',
    );
    expect(
      normalizeDailyContentInput(input, normalizeDailyContentConfig({ allowUserMentions: true }))
        .content,
    ).toBe(input.content);

    expect(() =>
      normalizeMessageStudioEmbed({ description: '<@123456789012345678> お知らせです' }),
    ).toThrow('ユーザーメンションはPlugin設定で許可されていません');
    expect(
      normalizeMessageStudioEmbed({ description: '<@123456789012345678> お知らせです' }, true)
        ?.description,
    ).toContain('<@123456789012345678>');
  });

  it('未知のrecurrenceTypeをdailyへ黙って変換せず拒否する', () => {
    expect(() =>
      normalizeDailyContentInput(
        {
          channelId: '123456789012345678',
          content: 'content',
          scheduleTime: '09:00',
          recurrenceType: 'monthly' as never,
        },
        normalizeDailyContentConfig({}),
      ),
    ).toThrow('recurrenceTypeはonce/daily/weeklyのいずれかを指定してください');
  });

  it('有効な1回予約は現在時刻より1分以上先だけ受け付ける', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const base = {
      channelId: '123456789012345678',
      content: 'content',
      scheduleTime: '09:00',
      recurrenceType: 'once' as const,
    };
    expect(() =>
      normalizeDailyContentInput(
        { ...base, onceAt: new Date('2030-01-01T00:00:30Z') },
        normalizeDailyContentConfig({}),
        now,
      ),
    ).toThrow('1回予約の日時は現在時刻より1分以上先を指定してください');
    expect(
      normalizeDailyContentInput(
        { ...base, onceAt: new Date('2030-01-01T00:02:00Z') },
        normalizeDailyContentConfig({}),
        now,
      ).onceAt,
    ).toEqual(new Date('2030-01-01T00:02:00Z'));
  });

  it('選択したmessageFormatに実際に配信できる内容が必要', () => {
    const config = normalizeDailyContentConfig({});
    const base = {
      channelId: '123456789012345678',
      scheduleTime: '09:00',
      recurrenceType: 'daily' as const,
    };

    expect(() =>
      normalizeDailyContentInput(
        {
          ...base,
          content: '',
          messageFormat: 'text',
          embed: { description: 'Embedだけ' },
        },
        config,
      ),
    ).toThrow('通常メッセージでは本文を入力してください');

    expect(() =>
      normalizeDailyContentInput(
        {
          ...base,
          content: '本文だけ',
          messageFormat: 'embed',
          embed: null,
        },
        config,
      ),
    ).toThrow('Embed形式ではEmbedの内容を入力してください');

    expect(
      normalizeDailyContentInput(
        {
          ...base,
          content: '本文',
          messageFormat: 'embed',
          embed: { description: 'Embed本文' },
        },
        config,
      ).messageFormat,
    ).toBe('embed');
  });
});
