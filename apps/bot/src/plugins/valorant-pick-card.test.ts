import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { renderValorantPickCard } from './valorant-pick-card.js';

afterEach(() => vi.unstubAllGlobals());

describe('VALORANT pick card', () => {
  it('renders 1, 3 and 5 players as bounded PNG without upstream images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('assets unavailable')));
    for (const count of [1, 3, 5]) {
      const png = await renderValorantPickCard({
        mode: 'TACTICAL',
        mapName: 'アセント',
        planLabel: 'ミッド制圧',
        entries: Array.from({ length: count }, (_, index) => ({
          agentName: 'Jett',
          displayName: 'ジェット',
          playerLabel: '参加者' + (index + 1),
        })),
      });
      const info = await sharp(png).metadata();
      expect(info.format).toBe('png');
      expect(info.width).toBe(1200);
      expect(info.height).toBe(680);
      expect(png.byteLength).toBeLessThan(8 * 1024 * 1024);
    }
  });
  it('escapes potentially unsafe player and agent display text before rendering', async () => {
    const image = await renderValorantPickCard({
      mode: 'RANDOM',
      mapName: '指定なし',
      entries: [{ agentName: 'Unknown', displayName: '<script>&\"', playerLabel: '<svg/onload=alert(1)>' }],
    });
    expect((await sharp(image).metadata()).format).toBe('png');
  });
  it('rejects empty and too-large teams', async () => {
    await expect(
      renderValorantPickCard({ mode: 'RANDOM', mapName: 'なし', entries: [] }),
    ).rejects.toThrow(RangeError);
    await expect(
      renderValorantPickCard({
        mode: 'RANDOM',
        mapName: 'なし',
        entries: Array.from({ length: 6 }, (_, index) => ({
          agentName: 'Jett',
          displayName: 'ジェット',
          playerLabel: String(index),
        })),
      }),
    ).rejects.toThrow(RangeError);
  });
});
