import { describe, expect, it } from 'vitest';
import { resolveForumPostTitle } from './daily-content.js';

describe('resolveForumPostTitle', () => {
  it('明示タイトルは100文字に収めてそのまま利用する', () => {
    expect(resolveForumPostTitle(' お知らせ ', new Date('2026-08-10T00:00:00Z'), 'UTC')).toBe(
      'お知らせ',
    );
    expect(resolveForumPostTitle('a'.repeat(120), new Date(), 'UTC')).toHaveLength(100);
  });

  it('タイトル未設定時はスケジュールTimezoneのカレンダー日付を利用する', () => {
    const scheduledFor = new Date('2026-08-10T06:30:00Z');

    expect(resolveForumPostTitle('', scheduledFor, 'Asia/Tokyo')).toContain('2026/08/10');
    expect(resolveForumPostTitle('', scheduledFor, 'America/Los_Angeles')).toContain('2026/08/09');
  });
});
