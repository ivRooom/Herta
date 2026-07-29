import { describe, expect, it } from 'vitest';
import { createLfgMessageNonce } from './presentation.js';

const postId = '11111111-1111-4111-8111-111111111111';

describe('LFG message nonce', () => {
  it('同じ募集versionで安定した25文字以内のnonceを返す', () => {
    const first = createLfgMessageNonce(postId, 12);
    const second = createLfgMessageNonce(postId, 12);
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(25);
  });

  it('versionが変わるとnonceも変わる', () => {
    expect(createLfgMessageNonce(postId, 12)).not.toBe(createLfgMessageNonce(postId, 13));
  });

  it('不正なpost IDとversionも安全な文字列へ正規化する', () => {
    expect(createLfgMessageNonce('invalid', Number.NaN)).toMatch(/^lfg[0-9a-f0]+$/);
  });
});
