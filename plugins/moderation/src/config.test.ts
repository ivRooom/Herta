import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODERATION_CONFIG,
  MAX_AUTOMATIC_DUPLICATE_MINIMUM_LENGTH,
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

  it('連投・重複投稿の集計範囲と最低文字数を安全に正規化する', () => {
    expect(DEFAULT_MODERATION_CONFIG.autoBurstScope).toBe('guild');
    expect(DEFAULT_MODERATION_CONFIG.autoDuplicateScope).toBe('guild');
    expect(DEFAULT_MODERATION_CONFIG.autoDuplicateMinimumLength).toBe(1);

    expect(
      normalizeModerationConfig({
        autoBurstScope: 'channel',
        autoDuplicateScope: 'channel',
        autoDuplicateMinimumLength: MAX_AUTOMATIC_DUPLICATE_MINIMUM_LENGTH + 100,
      }),
    ).toMatchObject({
      autoBurstScope: 'channel',
      autoDuplicateScope: 'channel',
      autoDuplicateMinimumLength: MAX_AUTOMATIC_DUPLICATE_MINIMUM_LENGTH,
    });

    expect(
      normalizeModerationConfig({
        autoBurstScope: 'invalid',
        autoDuplicateScope: null,
        autoDuplicateMinimumLength: 0,
      }),
    ).toMatchObject({
      autoBurstScope: 'guild',
      autoDuplicateScope: 'guild',
      autoDuplicateMinimumLength: 1,
    });
  });

  it('正検知自動ケース化を既定OFFにし、有効なルールセレクタだけを残す', () => {
    expect(DEFAULT_MODERATION_CONFIG.autoCaseOnConfirmedEnabled).toBe(false);
    expect(DEFAULT_MODERATION_CONFIG.autoCaseOnConfirmedRules).toEqual([]);

    expect(
      normalizeModerationConfig({
        autoCaseOnConfirmedEnabled: true,
        autoCaseOnConfirmedRules: [
          ' word_contains:0 ',
          'word_contains:0',
          'word_regex:12',
          'invite_link',
          'word_exact:-1',
          'word_contains',
          'unknown_rule',
          123,
        ],
      }),
    ).toMatchObject({
      autoCaseOnConfirmedEnabled: true,
      autoCaseOnConfirmedRules: ['word_contains:0', 'word_regex:12', 'invite_link'],
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
