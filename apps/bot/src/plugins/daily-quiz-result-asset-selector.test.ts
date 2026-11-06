import { describe, expect, it } from 'vitest';
import {
  selectDailyQuizResultAsset,
  type DailyQuizResultAssetPool,
} from './daily-quiz-result-asset-selector.js';

const pool: DailyQuizResultAssetPool = {
  revision: 'rev-1',
  correctAssets: [
    { assetId: 'correct-a', alt: '正解 A', enabled: true },
    { assetId: 'correct-b', alt: '正解 B', enabled: true },
    { assetId: 'correct-hidden', alt: '非表示', enabled: false },
  ],
  incorrectAssets: [
    { assetId: 'incorrect-a', alt: '不正解 A', enabled: true },
    { assetId: 'incorrect-b', alt: '不正解 B', enabled: true },
  ],
};

const pick = (result: 'correct' | 'incorrect', id: string) =>
  selectDailyQuizResultAsset(pool, result, id);

describe('selectDailyQuizResultAsset', () => {
  it('returns the same image for a finalized receipt and revision', () => {
    const first = pick('correct', 'receipt-123');
    expect(first).not.toBeNull();
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(pick('correct', 'receipt-123')).toEqual(first);
    }
  });

  it('never mixes outcomes or displays disabled assets', () => {
    for (let index = 0; index < 100; index++) {
      const id = `receipt-${index}`;
      expect(['correct-a', 'correct-b']).toContain(pick('correct', id)?.assetId);
      expect(['incorrect-a', 'incorrect-b']).toContain(pick('incorrect', id)?.assetId);
    }
  });

  it('selects different active images across independent receipts', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index++) {
      const asset = pick('correct', `receipt-${index}`);
      if (asset) seen.add(asset.assetId);
    }
    expect(seen).toEqual(new Set(['correct-a', 'correct-b']));
  });

  it('does not give duplicated asset IDs more probability', () => {
    const duplicate: DailyQuizResultAssetPool = {
      ...pool,
      correctAssets: [pool.correctAssets[0]!, pool.correctAssets[0]!, pool.correctAssets[1]!],
    };
    const unique: DailyQuizResultAssetPool = {
      ...pool,
      correctAssets: [pool.correctAssets[0]!, pool.correctAssets[1]!],
    };
    for (let index = 0; index < 20; index++) {
      const id = `receipt-${index}`;
      const a = selectDailyQuizResultAsset(duplicate, 'correct', id);
      const b = selectDailyQuizResultAsset(unique, 'correct', id);
      expect(a).toEqual(b);
    }
  });

  it('returns null without active assets or stable IDs', () => {
    const empty: DailyQuizResultAssetPool = { ...pool, correctAssets: [] };
    const noRevision: DailyQuizResultAssetPool = { ...pool, revision: '' };
    expect(selectDailyQuizResultAsset(empty, 'correct', 'receipt-1')).toBeNull();
    expect(pick('correct', '')).toBeNull();
    expect(selectDailyQuizResultAsset(noRevision, 'correct', 'receipt-1')).toBeNull();
  });

  it('never mutates the settings', () => {
    const before = JSON.stringify(pool);
    pick('correct', 'receipt-1');
    expect(JSON.stringify(pool)).toBe(before);
  });
});
