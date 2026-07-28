import { describe, expect, it } from 'vitest';
import {
  DAILY_CONTENT_DEFAULTS,
  DailyContentValidationError,
  isValidIanaTimezone,
  normalizeDailyContentConfig,
  normalizeDailyContentInput,
} from './config.js';

describe('Daily Content config', () => {
  it('既定値を正規化する', () => {
    expect(normalizeDailyContentConfig({})).toEqual(DAILY_CONTENT_DEFAULTS);
  });

  it('IANA timezoneを検証する', () => {
    expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Invalid/Timezone')).toBe(false);
  });

  it('配信入力を正規化する', () => {
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
    });
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

  it('ユーザーメンションは明示許可時だけ受け付ける', () => {
    const input = {
      channelId: '123456789012345678',
      content: '<@123456789012345678> お知らせです',
      scheduleTime: '09:00',
    };
    expect(() => normalizeDailyContentInput(input, normalizeDailyContentConfig({}))).toThrow(
      'ユーザーメンションはPlugin設定で許可されていません',
    );
    expect(
      normalizeDailyContentInput(
        input,
        normalizeDailyContentConfig({ allowUserMentions: true }),
      ).content,
    ).toBe(input.content);
  });
});
