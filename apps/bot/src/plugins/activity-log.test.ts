import { describe, expect, it } from 'vitest';
import { normalizeActivityLogConfig } from './activity-log.js';

describe('normalizeActivityLogConfig', () => {
  it('既定値はenabled:falseで記録対象は全てtrue', () => {
    expect(normalizeActivityLogConfig(undefined)).toEqual({
      enabled: false,
      trackVoice: true,
      trackMessages: true,
      trackEmoji: true,
      excludedChannelIds: [],
      excludedRoleIds: [],
      moderationAlertsEnabled: false,
      alertChannelId: null,
      messageBurstThreshold: 8,
      messageBurstWindowSeconds: 10,
      deleteBurstThreshold: 5,
      deleteBurstWindowSeconds: 30,
    });
  });

  it('enabledはtrueを明示しない限りfalseになる(オプトイン)', () => {
    expect(normalizeActivityLogConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeActivityLogConfig({ enabled: 'true' }).enabled).toBe(false);
    expect(normalizeActivityLogConfig({}).enabled).toBe(false);
  });

  it('不正なIDは除外し、上限50件・重複排除する', () => {
    const config = normalizeActivityLogConfig({
      excludedChannelIds: ['123', '123', 'bad', ...Array.from({ length: 60 }, (_, i) => `${i}`)],
      excludedRoleIds: ['456', 'bad'],
    });
    expect(config.excludedChannelIds).toHaveLength(50);
    expect(config.excludedChannelIds).toContain('123');
    expect(config.excludedChannelIds).not.toContain('bad');
    expect(config.excludedRoleIds).toEqual(['456']);
  });

  it('trackVoice/trackMessages/trackEmojiを個別にfalseへできる', () => {
    const config = normalizeActivityLogConfig({
      trackVoice: false,
      trackMessages: false,
      trackEmoji: false,
    });
    expect(config.trackVoice).toBe(false);
    expect(config.trackMessages).toBe(false);
    expect(config.trackEmoji).toBe(false);
  });

  it('moderationAlertsEnabledはtrueを明示しない限りfalseになる(オプトイン)', () => {
    expect(
      normalizeActivityLogConfig({ moderationAlertsEnabled: true }).moderationAlertsEnabled,
    ).toBe(true);
    expect(normalizeActivityLogConfig({}).moderationAlertsEnabled).toBe(false);
  });

  it('alertChannelIdは数字のみ許可し、それ以外はnullになる', () => {
    expect(normalizeActivityLogConfig({ alertChannelId: '123456' }).alertChannelId).toBe('123456');
    expect(
      normalizeActivityLogConfig({ alertChannelId: 'not-a-channel' }).alertChannelId,
    ).toBeNull();
    expect(normalizeActivityLogConfig({ alertChannelId: null }).alertChannelId).toBeNull();
  });

  it('burstしきい値・時間幅は範囲外なら既定値へ、範囲内ならその値へclampする', () => {
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 1 }).messageBurstThreshold).toBe(3);
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 999 }).messageBurstThreshold).toBe(
      50,
    );
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 20 }).messageBurstThreshold).toBe(
      20,
    );
    expect(normalizeActivityLogConfig({ messageBurstThreshold: 'bad' }).messageBurstThreshold).toBe(
      8,
    );
    expect(
      normalizeActivityLogConfig({ deleteBurstWindowSeconds: 1 }).deleteBurstWindowSeconds,
    ).toBe(5);
  });
});
