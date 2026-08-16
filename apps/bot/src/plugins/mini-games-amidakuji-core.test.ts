import { describe, expect, it } from 'vitest';
import {
  generateAmidakujiLadder,
  renderAmidakujiPng,
  traceAmidakuji,
} from './mini-games-amidakuji-core.js';

describe('Amidakuji', () => {
  it('creates a permutation of all result slots', () => {
    let index = 0;
    const values = [0.1, 0.9, 0.2, 0.8, 0.7, 0.15, 0.95];
    const ladder = generateAmidakujiLadder(6, () => values[index++ % values.length]!);

    expect(ladder.results).toHaveLength(6);
    expect([...ladder.results].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    for (let start = 0; start < ladder.slots; start += 1) {
      expect(traceAmidakuji(ladder.slots, ladder.rows, ladder.bars, start)).toBe(
        ladder.results[start],
      );
    }
  });

  it('rejects unsupported member counts', () => {
    expect(() => generateAmidakujiLadder(1)).toThrow(RangeError);
    expect(() => generateAmidakujiLadder(11)).toThrow(RangeError);
  });

  it('renders valid PNG files for hidden and revealed boards', () => {
    const ladder = generateAmidakujiLadder(4, () => 0.2);
    const hidden = renderAmidakujiPng(ladder, true);
    const revealed = renderAmidakujiPng(ladder, false);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    expect(hidden.subarray(0, 8)).toEqual(signature);
    expect(revealed.subarray(0, 8)).toEqual(signature);
    expect(hidden.length).toBeGreaterThan(1_000);
    expect(revealed.length).toBeGreaterThan(1_000);
    expect(hidden.equals(revealed)).toBe(false);
  });
});
