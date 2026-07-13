import { describe, expect, it, vi } from 'vitest';
import type { EnabledPlugin } from '@herta/plugin-catalog';
import { InMemoryGuildPluginCache } from './cache.js';

const value = [] as EnabledPlugin[];

describe('InMemoryGuildPluginCache', () => {
  it('TTL期限切れの値を返さない', () => {
    vi.useFakeTimers();
    const cache = new InMemoryGuildPluginCache({ ttlMs: 1000 });
    cache.set('guild', value);
    expect(cache.get('guild')).toBe(value);
    vi.advanceTimersByTime(1001);
    expect(cache.get('guild')).toBeUndefined();
    vi.useRealTimers();
  });
});
