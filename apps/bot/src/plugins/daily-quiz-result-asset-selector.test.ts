import { describe, expect, it } from 'vitest';
import {
  selectDailyQuizResultAsset,
  type DailyQuizResultAssetPool,
} from './daily-quiz-result-asset-selector.js';

const pool: DailyQuizResultAssetPool = {
  revision: 'rev-1',
  correctAssets: [
    { assetId: 'correct-a', alt: '正解カード A', enabled: true },
    { assetId: 'correct-b', alt: '正解カード B', enabled: true },
    { assetId: 'correct-hidden', alt: '非表示', enabled: false },
  ],
  incorrectAssets: [
    { assetId: 'incorrect-a', alt: '不正解カード A', enabled: true },
    { assetId: 'incorrect-b', alt: '不正解カード B', enabled: true },
  ],
};

describe('selectDailyQuizResultAsset', () => {
  it('keeps the selected image stable for the same finalized receipt', () => {
    const selected = selectDailyQuizResultAsset(pool, 'correct', 'receipt-123');
    expect(selected).not.toBeNull();
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(selectDailyQuizResultAsset(pool, 'correct', 'receipt-123')).toEqual(
        selected,
      );
    }
  });

  it('never chooses a disabled asset or the opposite outcome pool', () => {
    for (let index = 0; index < 100; index++) {
      const id = `receipt-${index}`;
      const correct = selectDailyQuizResultAsset(pool, 'correct', id);
      const incorrect = selectDailyQuizResultAsset(pool, 'incorrect', id);
      expect(['correct-a', 'correct-b']).toContain(correct?.assetId);
      expect(['incorrect-a', 'incorrect-b']).toContain(incorrect?.assetId);
    }
  });

  it('distributes many independent receipts over multiple eligible assets', () => {
    const ids = new Set(
      Array.from({ length: 200 }, (_, index) =>
        selectDailyQuizResultAsset(pool, 'correct', `receipt-${index}`)?.assetId,
      ),
    );
    expect(ids).toEqual(new Set(['correct-a', 'correct-b']));
  });

  it('does not give duplicated asset entries extra probability', () => {
    const withDuplicate = {
      ...pool,
      correctAssets: [
        pool.correctAssets[0]!,
        pool.correctAssets[0]!,
        pool.correctAssets[1]!,
      ],
    };
    const withoutDuplicate = {
      ...pool,
      correctAssets: [pool.correctAssets[0]!, pool.correctAssets[1]!],
    };
    for (let index = 0; index < 20; index++) {
      const receiptId = `receipt-${index}`;
      expect(
        selectDailyQuizResultAsset(withDuplicate, 'correct', receiptId),
      ).toEqual(
        selectDailyQuizResultAsset(withoutDuplicate, 'correct', receiptId),
      );
    }
  });

  it('fails closed when no active assets or stable IDs are available', () => {
    expect(
      selectDailyQuizResultAsset(
        { ...pool, correctAssets: [] },
        'correct',
        'receipt-1',
      ),
    ).toBeNull();
    expect(selectDailyQuizResultAsset(pool, 'correct', '')).toBeNull();
    expect(
      selectDailyQuizResultAsset(
        { ...pool, revision: '' },
        'correct',
        'receipt-1',
      ),
    ).toBeNull();
  });

  it('preserves the original inputs', () => {
    const before = JSON.stringify(pool);
    selectDailyQuizResultAsset(pool, 'correct', 'receipt-1');
    expect(JSON.stringify(pool)).toBe(before);
  });
});
