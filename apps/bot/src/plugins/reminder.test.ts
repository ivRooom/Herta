import { describe, expect, it } from 'vitest';
import { reminderManifest } from '@herta/plugin-catalog';
import { formatReminderList, normalizeReminderConfig } from './reminder.js';
import type { ReminderRecord } from './reminder-repository.js';

describe('Reminder v1', () => {
  it('manifestにset/list/cancelを公開する', () => {
    const command = reminderManifest.commands[0]!;
    expect(command.name).toBe('remind');
    expect(command.subcommands?.map((entry) => entry.name)).toEqual(['set', 'list', 'cancel']);
  });

  it('configを安全な既定値へ正規化する', () => {
    expect(normalizeReminderConfig(undefined)).toEqual({
      enabled: true,
      ephemeralResponses: true,
      maxActivePerUser: 20,
    });
    expect(normalizeReminderConfig({ maxActivePerUser: 999 })).toMatchObject({
      maxActivePerUser: 50,
    });
    expect(normalizeReminderConfig({ maxActivePerUser: 0 })).toMatchObject({
      maxActivePerUser: 1,
    });
  });

  it('一覧へID・時刻・配信先・本文previewを含める', () => {
    const reminder: ReminderRecord = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '123',
      channelId: '456',
      delivery: 'channel',
      message: 'テスト リマインダー',
      remindAt: new Date('2026-08-11T01:00:00.000Z'),
      status: 'pending',
      attempts: 0,
    };
    const result = formatReminderList([reminder]);
    expect(result).toContain(reminder.id);
    expect(result).toContain('チャンネル');
    expect(result).toContain('テスト リマインダー');
    expect(result).toContain('<t:');
  });

  it('空一覧を明示する', () => {
    expect(formatReminderList([])).toBe('未配信のリマインダーはありません。');
  });
});
