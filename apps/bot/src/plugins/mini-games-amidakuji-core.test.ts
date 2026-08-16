import { describe, expect, it } from 'vitest';
import {
  generateAmidakujiLadder,
  parseAmidakujiResultLabels,
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

  it('accepts custom result labels separated by comma, Japanese comma, or newline', () => {
    expect(parseAmidakujiResultLabels('当たり,ハズレ', 2)).toEqual(['当たり', 'ハズレ']);
    expect(parseAmidakujiResultLabels('Minecraft、VALORANT、APEX', 3)).toEqual([
      'Minecraft',
      'VALORANT',
      'APEX',
    ]);
    expect(parseAmidakujiResultLabels('A\nB\nC', 3)).toEqual(['A', 'B', 'C']);
  });

  it('uses numbered defaults and rejects invalid custom label counts or oversized labels', () => {
    expect(parseAmidakujiResultLabels(null, 3)).toEqual(['1番', '2番', '3番']);
    expect(parseAmidakujiResultLabels('当たり', 2)).toBeNull();
    expect(parseAmidakujiResultLabels(`当たり,${'x'.repeat(51)}`, 2)).toBeNull();
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
