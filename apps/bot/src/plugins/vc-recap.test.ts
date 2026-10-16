import { describe, expect, it } from 'vitest';
import { normalizeVcRecapConfig } from './vc-recap.js';

describe('normalizeVcRecapConfig', () => {
  it('既定値はenabled:false・excludedChannelIds:[]', () => {
    expect(normalizeVcRecapConfig(undefined)).toEqual({
      enabled: false,
      excludedChannelIds: [],
    });
  });

  it('enabledはtrueを明示しない限りfalseになる(オプトイン)', () => {
    expect(normalizeVcRecapConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeVcRecapConfig({ enabled: 'true' }).enabled).toBe(false);
  });

  it('不正なチャンネルIDは除外し、上限50件・重複排除する', () => {
    const config = normalizeVcRecapConfig({
      excludedChannelIds: ['123', '123', 'bad', ...Array.from({ length: 60 }, (_, i) => `${i}`)],
    });
    expect(config.excludedChannelIds).toHaveLength(50);
    expect(config.excludedChannelIds).toContain('123');
    expect(config.excludedChannelIds).not.toContain('bad');
  });
});
