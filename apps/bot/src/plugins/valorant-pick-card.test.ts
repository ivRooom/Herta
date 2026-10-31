import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { renderValorantPickCard } from './valorant-pick-card.js';
import { renderValorantHudSvg } from './valorant-pick-card-hud.js';

afterEach(() => vi.unstubAllGlobals());

describe('VALORANT pick card', () => {
  it('renders 1 to 5 players as bounded PNG without upstream images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('assets unavailable')));
    for (const count of [1, 2, 3, 4, 5]) {
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
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
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
      entries: [
        { agentName: 'Unknown', displayName: '<script>&\"', playerLabel: '<svg/onload=alert(1)>' },
      ],
    });
    expect((await sharp(image).metadata()).format).toBe('png');
  });
  it('builds a dramatic solo hero and responsive squad layouts', () => {
    const input = (count: number) => ({
      mode: 'TACTICAL' as const,
      mapName: 'アセント',
      planLabel: 'ミッド制圧',
      entries: Array.from({ length: count }, (_, index) => ({
        agentName: 'Jett',
        displayName: 'ジェット',
        playerLabel: 'PLAYER ' + (index + 1),
      })),
    });
    const hero = renderValorantHudSvg(input(1), [Buffer.from('portrait')], ['デュエリスト']);
    expect(hero).toContain('HERO PICK');
    expect(hero).toContain('data:image/png;base64,');
    expect(hero).toContain('SELECTED AGENT');
    expect(hero).toContain('抽選完了');
    const squad = renderValorantHudSvg(
      input(5),
      Array(5).fill(null),
      Array(5).fill('デュエリスト'),
    );
    expect(squad).toContain('SQUAD');
    expect(squad.match(/PICK COMPLETE/g)).toHaveLength(1);
    expect(squad.match(/PLAYER [1-5]/g)).toHaveLength(5);
    expect(squad).not.toContain('data:image/png;base64,');
  });

  it('escapes all dynamic HUD labels and bounds overlong player names', () => {
    const malicious = '<svg/onload="alert(1)">&'.repeat(4);
    const markup = renderValorantHudSvg(
      {
        mode: 'RANDOM',
        mapName: '<script>',
        planLabel: malicious,
        entries: [{ agentName: 'Fade', displayName: '<img src=x>', playerLabel: malicious }],
      },
      [null],
      ['<script>'],
    );
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img src=x>');
    expect(markup).not.toContain('<svg/onload');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('&lt;img src=x&gt;');
    expect(markup).toContain('&lt;svg/onload=');
    expect(markup.length).toBeLessThan(13_000);
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
