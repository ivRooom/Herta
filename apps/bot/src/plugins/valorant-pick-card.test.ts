import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { renderValorantPickCard } from './valorant-pick-card.js';
import { renderValorantHudSvg } from './valorant-pick-card-hud.js';

afterEach(() => vi.unstubAllGlobals());

describe('VALORANT pick card', () => {
  it('keeps the v5 poster hierarchy for solo and every lineup size', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const input = {
        mode: 'RANDOM' as const,
        mapName: 'アセント',
        entries: Array.from({ length: count }, (_, index) => ({
          agentName: 'Jett',
          displayName: 'ジェット',
          playerLabel: '参加者' + (index + 1),
        })),
      };
      const svg = renderValorantHudSvg(
        input,
        Array(count).fill(null),
        Array(count).fill('デュエリスト'),
      );
      expect(svg).toContain('AGENT REVEAL');
      expect(svg).toContain('Herta.');
      expect(svg).toContain('VALORANT');
      expect(svg).toContain('エージェント抽選');
      expect(svg).toContain('DISCORD BOT FOR GAMERS');
      expect(svg).toContain('url(#neon)');
      expect(svg).toContain('#ff659f');
      expect(svg).toContain('#b568ff');
      expect(svg).toContain('PICK COMPLETE');
      expect(svg).toContain('PARTICIPANTS');
      expect(svg).toContain('ジェット');
      expect(svg).not.toContain('<foreignObject');
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('<rect x="32" y="30" width="1136" height="125"');
      if (count === 1) {
        expect(svg).toContain('HERO PICK');
        expect(svg).toContain('url(#reading)');
        expect(svg).toContain('SELECTED AGENT');
      } else {
        expect(svg).toContain('SQUAD  //  LINEUP');
        expect(svg.match(/clipPath id="poster-art-/g)).toHaveLength(count);
        expect(svg.match(/参加者[1-5]/g)).toHaveLength(count);
      }
    }
  });

  it('keeps long solo player labels on a separate row from the role', () => {
    const svg = renderValorantHudSvg(
      {
        mode: 'RANDOM',
        mapName: '指定なし',
        entries: [{ agentName: 'Jett', displayName: 'ジェット', playerLabel: '界'.repeat(50) }],
      },
      [null],
      ['デュエリスト'],
    );
    expect(svg).toMatch(/<text x="134" y="544"[^>]*>デュエリスト<\/text>/);
    expect(svg).toMatch(/<text x="71" y="496"[^>]*>界{17}<\/text>/);
    expect(svg).not.toContain('界'.repeat(18));
  });

  it('rejects control/format characters in all visible dynamic labels', () => {
    const svg = renderValorantHudSvg(
      {
        mode: 'TACTICAL',
        mapName: 'アセント\u0000\u202e',
        planLabel: '構成\u0001\u200b',
        entries: [
          {
            agentName: 'Jett',
            displayName: 'ジェット\u0007',
            playerLabel: 'テスト\u0008\u202e',
          },
        ],
      },
      [null],
      ['デュエ\u0000リスト'],
    );
    for (const value of ['\u0000', '\u0001', '\u0007', '\u0008', '\u202e', '\u200b']) {
      expect(svg).not.toContain(value);
    }
    for (const value of ['アセント', '構成', 'テスト', 'ジェット', 'デュエリスト']) {
      expect(svg).toContain(value);
    }
  });

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
  it('renders a real solo portrait behind the participant and status HUD panels', async () => {
    const portrait = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 82, b: 108, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const svg = renderValorantHudSvg(
      {
        mode: 'RANDOM',
        mapName: '指定なし',
        entries: [{ agentName: 'Jett', displayName: 'ジェット', playerLabel: 'PLAYER 01' }],
      },
      [portrait],
      ['デュエリスト'],
    );
    const imageIndex = svg.indexOf('data:image/png;base64,');
    expect(imageIndex).toBeGreaterThan(0);
    expect(imageIndex).toBeLessThan(svg.indexOf('PARTICIPANTS'));
    expect(imageIndex).toBeLessThan(svg.indexOf('PICK COMPLETE'));
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const info = await sharp(png).metadata();
    expect(info.format).toBe('png');
    expect(info.width).toBe(1200);
    expect(info.height).toBe(680);
  });

  it('uses the cinematic reveal hierarchy across solo and five-person lineups', () => {
    const input = (count: number) => ({
      mode: 'RANDOM' as const,
      mapName: 'バインド',
      entries: Array.from({ length: count }, (_, index) => ({
        agentName: 'Jett',
        displayName: 'ジェット',
        playerLabel: '参加者' + (index + 1),
      })),
    });
    const hero = renderValorantHudSvg(input(1), [null], ['デュエリスト']);
    const lineup = renderValorantHudSvg(
      input(5),
      Array(5).fill(null),
      Array(5).fill('デュエリスト'),
    );
    for (const svg of [hero, lineup]) {
      expect(svg).toContain('AGENT REVEAL');
      expect(svg).toContain('PARTICIPANTS');
      expect(svg).toContain('PICK COMPLETE');
      expect(svg).toContain('抽選完了');
      expect(svg).toContain('1200');
      expect(svg).toContain('680');
      expect(svg).not.toContain('<foreignObject');
    }
    expect(hero).toContain('SELECTED AGENT');
    expect(hero).toContain('HERO PICK');
    expect(lineup).toContain('LINEUP');
    expect(lineup.match(/clipPath id="poster-art-/g)).toHaveLength(5);
    expect(lineup.match(/参加者[1-5]/g)).toHaveLength(5);
  });

  it('renders the real player-to-agent assignments and clipped art for squads', () => {
    for (const count of [2, 3, 4, 5]) {
      const input = {
        mode: 'RANDOM' as const,
        mapName: 'アセント',
        entries: Array.from({ length: count }, (_, index) => ({
          agentName: 'Jett',
          displayName: 'ジェット' + (index + 1),
          playerLabel: '参加者' + (index + 1),
        })),
      };
      const svg = renderValorantHudSvg(
        input,
        Array(count).fill(null),
        Array(count).fill('デュエリスト'),
      );
      expect(svg.match(/clipPath id="poster-art-/g)).toHaveLength(count);
      expect(svg.match(/PLAYER<\/text>/g)).toHaveLength(count);
      expect(svg).toContain('エージェント抽選');
      for (let i = 1; i <= count; i++) {
        expect(svg).toContain('参加者' + i);
        expect(svg).toContain('ジェット' + i);
      }
      expect(svg).not.toContain('ユーザー5');
    }
  });

  it('bounds very long Japanese player and agent names in the five-person assignment list', () => {
    const svg = renderValorantHudSvg(
      {
        mode: 'RANDOM',
        mapName: '長いマップ名を表示確認',
        entries: Array.from({ length: 5 }, () => ({
          agentName: 'LongAgentNameForFallback',
          displayName: '漢'.repeat(30),
          playerLabel: '界'.repeat(30),
        })),
      },
      Array(5).fill(null),
      Array(5).fill('デュエリスト'),
    );
    expect(svg).toContain('界'.repeat(10) + '</text>');
    expect(svg).not.toContain('界'.repeat(11));
    expect(svg).toContain('漢'.repeat(9) + '</text>');
    expect(svg).not.toContain('漢'.repeat(10));
    expect(svg).not.toContain('<script');
  });

  it('embeds separate art assets in the angled shard layer without drawing user names as attributes', async () => {
    const art = await sharp({
      create: {
        width: 12,
        height: 12,
        channels: 4,
        background: { r: 170, g: 45, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const svg = renderValorantHudSvg(
      {
        mode: 'TACTICAL',
        mapName: 'アセント',
        entries: Array.from({ length: 5 }, (_, index) => ({
          agentName: 'Jett',
          displayName: 'ジェット',
          playerLabel: '<参加者>' + index,
        })),
      },
      Array(5).fill(art),
      Array(5).fill('デュエリスト'),
    );
    expect(svg.match(/data:image\/png;base64,/g)).toHaveLength(5);
    expect(svg.match(/clipPath id="poster-art-/g)).toHaveLength(5);
    expect(svg).toContain('&lt;参加者&gt;');
    expect(svg).not.toContain('<参加者>');
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    expect(image.length).toBeLessThan(8 * 1024 * 1024);
    expect((await sharp(image).metadata()).width).toBe(1200);
  });

  it('renders an image fetched from allowlisted agent metadata without upstream network', async () => {
    vi.resetModules();
    const art = await sharp({
      create: {
        width: 12,
        height: 12,
        channels: 4,
        background: { r: 255, g: 70, b: 85, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const uuid = '00000000-0000-0000-0000-000000000001';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://valorant-api.com/v1/agents?isPlayableCharacter=true') {
        return new Response(
          JSON.stringify({
            data: [{ displayName: 'Jett', uuid, role: { displayName: 'Duelist' } }],
          }),
        );
      }
      if (url === 'https://media.valorant-api.com/agents/' + uuid + '/fullportrait.png') {
        return new Response(new Uint8Array(art));
      }
      throw new Error('unexpected destination');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { renderValorantPickCard: renderFresh } = await import('./valorant-pick-card.js');
    const png = await renderFresh({
      mode: 'RANDOM',
      mapName: '指定なし',
      entries: [{ agentName: 'Jett', displayName: 'ジェット', playerLabel: '参加者1' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(680);
    expect(png.byteLength).toBeLessThan(8 * 1024 * 1024);
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

  it('uses fixed neon decorations rather than external SVG resources or fake buttons', () => {
    const svg = renderValorantHudSvg(
      {
        mode: 'TACTICAL',
        mapName: '<script>アセント</script>',
        planLabel: 'ミッド＆ラッシュ',
        entries: [{ agentName: 'Jett', displayName: 'ジェット', playerLabel: '参加者<01>' }],
      },
      [null],
      ['デュエリスト'],
    );
    for (const marker of ['id="halo"', 'id="glow"', 'url(#reading)', 'DISCORD BOT FOR GAMERS']) {
      expect(svg).toContain(marker);
    }
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('参加者&lt;01&gt;');
    expect(svg).not.toMatch(/<foreignObject|<script|<button/i);
    expect(svg).not.toMatch(/(?:href|src)="https?:/i);
    expect(svg).not.toContain('再抽選する');
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
