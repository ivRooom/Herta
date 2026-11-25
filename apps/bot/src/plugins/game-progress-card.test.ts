import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { HoyolabExploration, HoyolabProgressSnapshot } from './game-accounts-ivrm.js';
import {
  GENSHIN_PROGRESS_CARD_FILE_NAME,
  GENSHIN_PROGRESS_CARD_HEIGHT,
  GENSHIN_PROGRESS_CARD_WIDTH,
  buildGenshinProgressCardModel,
  buildGenshinProgressCardSvg,
  renderGenshinProgressCard,
  type GenshinProgressCardInput,
} from './game-progress-card.js';

function area(name: string, percent: number | null, id: number): HoyolabExploration {
  return { id, name, percent, level: null, offerings: [] };
}

/** The values from Kanata's 2026-11-25 screenshot, as the API snapshot serves them. */
const screenshotSnapshot: HoyolabProgressSnapshot = {
  gameCode: 'genshin',
  uid: '812468719',
  player: { nickname: 'いゔる。', level: 56 },
  stats: {
    activeDays: 321,
    achievements: 582,
    characters: 60,
    waypoints: 567,
    domains: 60,
    totalChests: 1421,
    commonChests: 660,
    exquisiteChests: 532,
    preciousChests: 151,
    luxuriousChests: 61,
    magicChests: 17,
  },
  explorations: [
    area('スネージナヤ', 2, 1),
    area('風止みの山', 33.8, 2),
    area('ナド・クライ', 6, 3),
    area('ナタ', 9, 4),
    area('沈玉の谷・上谷', 18.3, 5),
    area('沈玉の谷・南峰', 17.4, 6),
    area('フォンテーヌ', 18, 7),
    area('スメール', 22, 8),
    area('層岩巨淵・地下鉱区', 42.5, 9),
    area('層岩巨淵', 38, 10),
    area('淵下宮', 31.3, 11),
    area('稲妻', 32, 12),
    area('ドラゴンスパイン', 31, 13),
    area('璃月', 42.9, 14),
    area('モンド', 100, 15),
    area('空の神殿', 0, 16),
    area('古の聖山', 0, 17),
    area('往日の海', 0, 18),
    area('来歆山', 0, 19),
    area('沈玉の谷', 0, 20),
  ],
  endgame: [
    {
      kind: 'spiral_abyss',
      scheduleId: 1,
      maxFloor: '0-0',
      totalStars: 0,
      totalScore: null,
      hasData: true,
    },
  ],
};

const screenshotInput: GenshinProgressCardInput = {
  snapshot: screenshotSnapshot,
  uid: '812468719',
  fetchedAtLabel: '2026/11/25 20:39 (JST)',
};

describe('Genshin progress card model (#1010)', () => {
  it('averages all measured areas for the donut (screenshot values give 22.2%)', () => {
    const model = buildGenshinProgressCardModel(screenshotInput);
    expect(model.measuredAreaCount).toBe(20);
    expect(model.overallPercent).toBeCloseTo(22.21, 2);
    const svg = buildGenshinProgressCardSvg(model, null);
    expect(svg).toContain('22.2%');
    expect(svg).toContain('全20エリア平均');
  });

  it('sorts bars high to low and folds the 0% areas into untouched chips', () => {
    const model = buildGenshinProgressCardModel(screenshotInput);
    expect(model.bars).toHaveLength(15);
    expect(model.bars[0]).toEqual({ name: 'モンド', percent: 100 });
    expect(model.bars.at(-1)).toEqual({ name: 'スネージナヤ', percent: 2 });
    const percents = model.bars.map((bar) => bar.percent);
    expect(percents).toEqual([...percents].sort((a, b) => b - a));
    expect(model.untouched).toEqual(['空の神殿', '古の聖山', '往日の海', '来歆山', '沈玉の谷']);
    expect(model.untouchedLabel).toBe('未着手（0%）');
    expect(model.omittedBarCount).toBe(0);
  });

  it('builds the six summary tiles from the snapshot stats', () => {
    const model = buildGenshinProgressCardModel(screenshotInput);
    expect(model.tiles).toEqual([
      { label: '活動日数', value: '321日' },
      { label: 'アチーブメント', value: '582' },
      { label: '所持キャラクター', value: '60体' },
      { label: 'ワープポイント', value: '567' },
      { label: '秘境', value: '60' },
      { label: '深境螺旋', value: '到達 0-0 ・ ★0' },
    ]);
    expect(model.playerLine).toBe('いゔる。 ・ 冒険ランク 56 ・ UID 812468719');
  });

  it('keeps the chest total and the five-way breakdown for the stacked bar', () => {
    const model = buildGenshinProgressCardModel(screenshotInput);
    expect(model.chestTotal).toBe(1421);
    expect(model.chestSegments.map((segment) => segment.count)).toEqual([660, 532, 151, 61, 17]);
    expect(model.chestSegments.reduce((sum, segment) => sum + segment.count, 0)).toBe(1421);
    const svg = buildGenshinProgressCardSvg(model, null);
    expect(svg).toContain('宝箱 合計 1,421');
  });

  it('keeps the right column inside the card so percentages never clip', () => {
    const svg = buildGenshinProgressCardSvg(buildGenshinProgressCardModel(screenshotInput), null);
    // Right column starts at x=808 with 720px-wide bars: the end-anchored
    // percent labels sit at x=1528, inside the 1600px canvas and its frame.
    expect(svg).toContain('x="1528"');
    expect(GENSHIN_PROGRESS_CARD_WIDTH).toBe(1600);
    expect(GENSHIN_PROGRESS_CARD_HEIGHT).toBe(900);
    expect(GENSHIN_PROGRESS_CARD_FILE_NAME).toBe('genshin-progress-card.png');
  });

  it('escapes member-controlled text and degrades missing stats to placeholders', () => {
    const model = buildGenshinProgressCardModel({
      snapshot: {
        gameCode: 'genshin',
        uid: '800000001',
        player: { nickname: '<script>', level: null },
        stats: {},
        explorations: [area('未計測エリア', null, 1)],
        endgame: [],
      },
      uid: '800000001',
      fetchedAtLabel: '未取得',
    });
    expect(model.overallPercent).toBeNull();
    expect(model.bars).toEqual([]);
    expect(model.untouched).toEqual(['未計測エリア']);
    expect(model.untouchedLabel).toBe('未着手・未計測');
    expect(model.tiles.every((tile) => tile.value === '—' || tile.value === '記録なし')).toBe(true);
    expect(model.chestTotal).toBeNull();
    const svg = buildGenshinProgressCardSvg(model, null);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('宝箱 データなし');
  });
});

describe('Genshin progress card layout guards (#1011 review fixes)', () => {
  /** Chip rects live on the bottom row at y=766; the chip column ends at x=792. */
  function chipRects(svg: string): { x: number; width: number }[] {
    return [...svg.matchAll(/<rect x="([\d.]+)" y="766" width="([\d.]+)" height="34"/g)].map(
      (match) => ({ x: Number(match[1]), width: Number(match[2]) }),
    );
  }

  /** Stacked chest segments live at y=776; the chest column spans x=808..1528. */
  function chestSegmentRects(svg: string): { x: number; width: number }[] {
    return [...svg.matchAll(/<rect x="([\d.]+)" y="776" width="([\d.]+)" height="18"/g)].map(
      (match) => ({ x: Number(match[1]), width: Number(match[2]) }),
    );
  }

  function inputWith(
    stats: HoyolabProgressSnapshot['stats'],
    explorations: HoyolabProgressSnapshot['explorations'],
  ): GenshinProgressCardInput {
    return {
      snapshot: {
        gameCode: 'genshin',
        uid: '800000001',
        player: { nickname: 'テスト', level: 50 },
        stats,
        explorations,
        endgame: [],
      },
      uid: '800000001',
      fetchedAtLabel: '2026/11/26 02:00 (JST)',
    };
  }

  it('applies the width budget to the first untouched chip too', () => {
    // A 30-char name estimates to 28 + 30*21 = 658px wide; starting after
    // the label at x=174 it would end at 832, past the 792 column limit
    // and into the chest column. It must fold into the "+N" indicator.
    const longName = 'あ'.repeat(30);
    const model = buildGenshinProgressCardModel(
      inputWith({}, [area('モンド', 100, 1), area(longName, 0, 2), area('空の神殿', 0, 3)]),
    );
    expect(model.untouched).toEqual([longName, '空の神殿']);
    const svg = buildGenshinProgressCardSvg(model, null);
    expect(svg).not.toContain(longName);
    expect(svg).toContain('+2');
    const rects = chipRects(svg);
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(792);
    }
  });

  it('keeps every screenshot chip inside the chip column', () => {
    const svg = buildGenshinProgressCardSvg(buildGenshinProgressCardModel(screenshotInput), null);
    const rects = chipRects(svg);
    expect(rects).toHaveLength(5);
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(792);
    }
  });

  it('shows the chest total even when the per-type breakdown is missing', () => {
    const model = buildGenshinProgressCardModel(
      inputWith({ totalChests: 2270 }, [area('モンド', 100, 1)]),
    );
    expect(model.chestTotal).toBe(2270);
    expect(model.chestSegments).toEqual([]);
    const svg = buildGenshinProgressCardSvg(model, null);
    expect(svg).toContain('宝箱 合計 2,270');
    expect(svg).not.toContain('宝箱 データなし');
    // No breakdown means no stacked bar is drawn.
    expect(chestSegmentRects(svg)).toEqual([]);
  });

  it('keeps the stacked bar inside its column when the breakdown exceeds the total', () => {
    const model = buildGenshinProgressCardModel(
      inputWith({ totalChests: 100, commonChests: 660, exquisiteChests: 532 }, [
        area('モンド', 100, 1),
      ]),
    );
    expect(model.chestTotal).toBe(100);
    expect(model.chestSegments.reduce((sum, segment) => sum + segment.count, 0)).toBe(1192);
    const svg = buildGenshinProgressCardSvg(model, null);
    expect(svg).toContain('宝箱 合計 100');
    const rects = chestSegmentRects(svg);
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(1528);
    }
  });
});

describe('Genshin progress card render (#1010)', () => {
  // The background binary (apps/bot/assets/game-progress/nodkrai-frostmoon-shrine.webp,
  // 2048x1152 WebP) is added to the branch through the GitHub Web upload,
  // because the MCP write tools store text verbatim and cannot carry
  // binaries. The renderer treats a missing asset as a plain dark card,
  // so this suite passes with or without it.
  it('renders a bounded PNG with the intended dimensions', async () => {
    const png = await renderGenshinProgressCard(screenshotInput);
    const metadata = await sharp(png).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(GENSHIN_PROGRESS_CARD_WIDTH);
    expect(metadata.height).toBe(GENSHIN_PROGRESS_CARD_HEIGHT);
  }, 30_000);
});
