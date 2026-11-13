import { describe, expect, it } from 'vitest';
import { formatStartedAtJa, renderVersionCard, type VersionCardModel } from './version-card.js';

const model: VersionCardModel = {
  shortSha: 'bc0fd5e',
  commitSha: 'bc0fd5e95cf7e567a0147fde0cb2f1379db7b10d',
  environmentLabel: '本番',
  startedAtLabel: '2026/11/13（金）16:27',
  uptimeLabel: '0日 0時間 9分',
  nodeVersion: 'v22.23.4',
};

describe('Version Card', () => {
  it('PNGとして描画できる', async () => {
    const png = await renderVersionCard(model);
    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('ビルド未記録でも描画できる', async () => {
    const png = await renderVersionCard({ ...model, shortSha: null, commitSha: null });
    expect(png.length).toBeGreaterThan(1000);
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('formatStartedAtJa', () => {
  it('JST で整形する', () => {
    // 2026-11-13T07:27:00Z = 16:27 JST（金曜日）
    expect(formatStartedAtJa(new Date('2026-11-13T07:27:00.000Z'))).toBe('2026/11/13（金）16:27');
  });
});
