import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODERATION_CONFIG,
  MAX_BAN_DELETE_MESSAGE_SECONDS,
  MAX_MODERATION_REASON_LENGTH,
  MAX_TIMEOUT_MINUTES,
  ModerationValidationError,
  normalizeDeleteMessageSeconds,
  normalizeModerationConfig,
  normalizeModerationReason,
  normalizeTimeoutMinutes,
} from './config.js';

describe('Moderation config', () => {
  it('空設定へ安全な既定値を適用する', () => {
    expect(normalizeModerationConfig({})).toEqual(DEFAULT_MODERATION_CONFIG);
  });

  it('数値境界とDiscord ID配列を正規化する', () => {
    expect(
      normalizeModerationConfig({
        maxReasonLength: 99999,
        caseRetentionDays: 1,
        logChannelId: ' 123 ',
        allowedModeratorRoleIds: [' 456 ', '456', 'invalid', 789],
      }),
    ).toMatchObject({
      maxReasonLength: MAX_MODERATION_REASON_LENGTH,
      caseRetentionDays: 30,
      logChannelId: '123',
      allowedModeratorRoleIds: ['456'],
    });
  });
});

describe('Moderation input validation', () => {
  it('理由の必須設定と最大長を検証する', () => {
    expect(() =>
      normalizeModerationReason('', { requireReason: true, maxReasonLength: 100 }),
    ).toThrow(ModerationValidationError);
    expect(() =>
      normalizeModerationReason('1234', { requireReason: true, maxReasonLength: 3 }),
    ).toThrow('理由は3文字以内で入力してください');
    expect(
      normalizeModerationReason('', { requireReason: false, maxReasonLength: 100 }),
    ).toBeNull();
  });

  it('タイムアウト時間をDiscord上限内に制限する', () => {
    expect(normalizeTimeoutMinutes(1)).toBe(1);
    expect(normalizeTimeoutMinutes(MAX_TIMEOUT_MINUTES)).toBe(MAX_TIMEOUT_MINUTES);
    expect(() => normalizeTimeoutMinutes(0)).toThrow(ModerationValidationError);
    expect(() => normalizeTimeoutMinutes(MAX_TIMEOUT_MINUTES + 1)).toThrow(
      ModerationValidationError,
    );
  });

  it('BAN時のメッセージ削除秒数を7日以内に制限する', () => {
    expect(normalizeDeleteMessageSeconds(null)).toBe(0);
    expect(normalizeDeleteMessageSeconds(MAX_BAN_DELETE_MESSAGE_SECONDS)).toBe(
      MAX_BAN_DELETE_MESSAGE_SECONDS,
    );
    expect(() => normalizeDeleteMessageSeconds(-1)).toThrow(ModerationValidationError);
    expect(() => normalizeDeleteMessageSeconds(MAX_BAN_DELETE_MESSAGE_SECONDS + 1)).toThrow(
      ModerationValidationError,
    );
  });
});
