import { describe, expect, it } from 'vitest';
import { buildAfkNotice, formatAfkListPages, normalizeAfkConfig } from './afk.js';
import type { AfkStatusRecord } from './afk-repository.js';

describe('AFK v1', () => {
  it('Studio設定を安全な範囲へ正規化する', () => {
    expect(normalizeAfkConfig(undefined)).toEqual({
      enabled: true,
      ephemeralResponses: true,
      defaultReason: '離席中',
      maxReasonLength: 200,
      autoClearOnMessage: true,
      notifyOnMention: true,
      notificationCooldownSeconds: 15,
      maxMentionNotices: 5,
      maxListEntries: 25,
    });
    expect(
      normalizeAfkConfig({
        maxReasonLength: 5,
        notificationCooldownSeconds: 999,
        maxMentionNotices: 99,
        maxListEntries: 1,
      }),
    ).toMatchObject({
      maxReasonLength: 20,
      notificationCooldownSeconds: 300,
      maxMentionNotices: 10,
      maxListEntries: 5,
    });
  });

  it('AFK通知に理由と開始時刻を含める', () => {
    const notice = buildAfkNotice([makeRecord()]);
    expect(notice).toContain('<@123>');
    expect(notice).toContain('昼休み');
    expect(notice).toContain('<t:');
  });

  it('AFK一覧をDiscord文字数上限以下へ分割する', () => {
    const records = Array.from({ length: 50 }, (_, index) =>
      makeRecord({
        userId: String(1000 + index),
        reason: `理由${index + 1}-${'x'.repeat(80)}`,
      }),
    );
    const pages = formatAfkListPages(records);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
  });
});

function makeRecord(overrides: Partial<AfkStatusRecord> = {}): AfkStatusRecord {
  return {
    guildId: '999',
    userId: '123',
    reason: '昼休み',
    startedAt: new Date('2026-08-11T08:00:00.000Z'),
    ...overrides,
  };
}
