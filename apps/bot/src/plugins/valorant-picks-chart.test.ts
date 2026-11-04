import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderValorantPicksChart } from './valorant-picks-chart.js';

describe('VALORANT picks chart', () => {
  it('renders a bounded PNG with the intended dimensions', async () => {
    const image = await renderValorantPicksChart({
      scopeLabel: 'あなた本人',
      draws: 3,
      truncated: false,
      agents: [
        { label: 'ジェット', count: 2 },
        { label: 'オーメン', count: 1 },
      ],
      roles: [{ label: 'デュエリスト', count: 2 }],
    });
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(image.length).toBeLessThan(8 * 1024 * 1024);
    const meta = await sharp(image).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(800);
  });

  it('supports zero samples and safely escaped chart labels', async () => {
    const image = await renderValorantPicksChart({
      scopeLabel: 'Guild全体',
      draws: 0,
      truncated: true,
      agents: [{ label: 'X <script> &', count: 1 }],
      roles: [],
    });
    expect((await sharp(image).metadata()).format).toBe('png');
  });
});
