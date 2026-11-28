import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { HoyolabEndgameEntry, HoyolabProgressSnapshot } from './game-accounts-ivrm.js';
import {
  STARRAIL_PROGRESS_CARD_FILE_NAME,
  STARRAIL_PROGRESS_CARD_HEIGHT,
  STARRAIL_PROGRESS_CARD_WIDTH,
  buildStarRailProgressCardModel,
  buildStarRailProgressCardSvg,
  renderStarRailProgressCard,
  type StarRailProgressCardInput,
} from './game-progress-starrail-card.js';

/** The approved mock's sample values, as the API snapshot serves them. */
const mockSnapshot: HoyolabProgressSnapshot = {
  gameCode: 'starrail',
  uid: '800123456',
  player: { nickname: 'いゔる。', level: 70 },
  stats: {
    activeDays: 950,
    achievements: 812,
    characters: 58,
    chests: 1150,
  },
  explorations: [],
  endgame: [
    {
      kind: 'memory_of_chaos',
      scheduleId: 1,
      maxFloor: '12-3',
      totalStars: 36,
      totalScore: null,
      hasData: true,
    },
    {
      kind: 'pure_fiction',
      scheduleId: 1,
      maxFloor: null,
      totalStars: null,
      totalScore: 38500,
      hasData: true,
    },
    {
      kind: 'apocalyptic_shadow',
      scheduleId: 1,
      maxFloor: null,
      totalStars: null,
      totalScore: 4200,
      hasData: true,
    },
  ],
};

const mockInput: StarRailProgressCardInput = {
  snapshot: mockSnapshot,
  uid: '800123456',
  fetchedAtLabel: '2026/11/28 11:00 (JST)',
};

function inputWith(overrides: Partial<HoyolabProgressSnapshot>): StarRailProgressCardInput {
  return {
    snapshot: { ...mockSnapshot, ...overrides },
    uid: '800123456',
    fetchedAtLabel: '2026/11/28 11:00 (JST)',
  };
}

describe('Star Rail progress card model (#1079)', () => {
  it('builds the header line and the four summary tiles from the snapshot', () => {
    const model = buildStarRailProgressCardModel(mockInput);
    expect(model.playerLine).toBe('いゔる。 ・ 開拓レベル 70 ・ UID 800123456');
    expect(model.level).toBe(70);
    expect(model.tiles).toEqual([
      { label: '活動日数', value: '950日' },
      { label: 'アチーブメント', value: '812' },
      { label: '獲得キャラクター', value: '58体' },
      { label: '宝箱', value: '1,150' },
    ]);
    const svg = buildStarRailProgressCardSvg(model, null);
    expect(svg).toContain('崩壊：スターレイルの戦績');
    expect(svg).toContain('取得 2026/11/28 11:00 (JST)');
  });

  it('maps the three endgame modes to cards in fixed order', () => {
    const model = buildStarRailProgressCardModel(mockInput);
    expect(model.endgame.map((card) => card.kind)).toEqual([
      'memory_of_chaos',
      'pure_fiction',
      'apocalyptic_shadow',
    ]);
    const [chaos, fiction, shadow] = model.endgame;
    expect(chaos).toMatchObject({
      name: '混沌の記憶',
      label: '到達フロア',
      value: '12-3',
      hasData: true,
      stars: 36,
      starRatio: 1,
    });
    expect(fiction).toMatchObject({ name: '虚構叙事', value: '38,500', hasData: true });
    expect(shadow).toMatchObject({ name: '末日の幻影', value: '4,200', hasData: true });
    const svg = buildStarRailProgressCardSvg(model, null);
    expect(svg).toContain('★ 36');
    expect(svg).toContain('38,500');
    expect(STARRAIL_PROGRESS_CARD_WIDTH).toBe(1600);
    expect(STARRAIL_PROGRESS_CARD_HEIGHT).toBe(900);
    expect(STARRAIL_PROGRESS_CARD_FILE_NAME).toBe('starrail-progress-card.png');
  });

  it('scales the Memory of Chaos star bar against the 36-star maximum', () => {
    const entry: HoyolabEndgameEntry = {
      kind: 'memory_of_chaos',
      scheduleId: 1,
      maxFloor: '10-3',
      totalStars: 18,
      totalScore: null,
      hasData: true,
    };
    const model = buildStarRailProgressCardModel(inputWith({ endgame: [entry] }));
    expect(model.endgame[0]?.starRatio).toBe(0.5);
    const svg = buildStarRailProgressCardSvg(model, null);
    // The bar track is 482 - 48 = 434 wide; half of it is filled at 18 stars.
    expect(svg).toContain('width="217"');
  });

  it('omits missing stats instead of zero-filling them', () => {
    const partial = buildStarRailProgressCardModel(inputWith({ stats: { chests: 10 } }));
    expect(partial.tiles).toEqual([{ label: '宝箱', value: '10' }]);
    const empty = buildStarRailProgressCardModel(inputWith({ stats: {} }));
    expect(empty.tiles).toEqual([]);
    const svg = buildStarRailProgressCardSvg(empty, null);
    expect(svg).not.toContain('活動日数');
    expect(svg).toContain('崩壊：スターレイルの戦績');
  });

  it('escapes member-controlled text', () => {
    const model = buildStarRailProgressCardModel(
      inputWith({ player: { nickname: '<script>', level: null } }),
    );
    expect(model.level).toBeNull();
    const svg = buildStarRailProgressCardSvg(model, null);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

describe('Star Rail progress card no-data endgame (#1079)', () => {
  it('renders hasData=false modes as grayed 未挑戦 cards', () => {
    const noData: HoyolabEndgameEntry[] = mockSnapshot.endgame.map((entry) => ({
      ...entry,
      hasData: false,
    }));
    const model = buildStarRailProgressCardModel(inputWith({ endgame: noData }));
    for (const card of model.endgame) {
      expect(card.hasData).toBe(false);
      expect(card.value).toBe('未挑戦');
      expect(card.accent).toBe('#5a6274');
      expect(card.stars).toBeNull();
      expect(card.starRatio).toBeNull();
    }
    const svg = buildStarRailProgressCardSvg(model, null);
    expect(svg.match(/未挑戦/g)).toHaveLength(3);
    expect(svg).not.toContain('12-3');
    expect(svg).not.toContain('★');
  });

  it('treats a missing endgame entry the same as hasData=false', () => {
    const model = buildStarRailProgressCardModel(inputWith({ endgame: [] }));
    expect(model.endgame).toHaveLength(3);
    for (const card of model.endgame) {
      expect(card.hasData).toBe(false);
      expect(card.value).toBe('未挑戦');
    }
    const svg = buildStarRailProgressCardSvg(model, null);
    expect(svg.match(/未挑戦/g)).toHaveLength(3);
    // The attempted modes keep their data next to the untouched ones.
    const mixed = buildStarRailProgressCardModel(mockInput);
    expect(mixed.endgame.filter((card) => card.hasData)).toHaveLength(3);
  });
});

describe('Star Rail progress card render (#1079)', () => {
  it('renders a bounded PNG with the intended dimensions', async () => {
    const png = await renderStarRailProgressCard(mockInput);
    const metadata = await sharp(png).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(STARRAIL_PROGRESS_CARD_WIDTH);
    expect(metadata.height).toBe(STARRAIL_PROGRESS_CARD_HEIGHT);
  }, 30_000);
});

describe('Star Rail progress card background painting (#1079)', () => {
  // Same regression guard as the Genshin card (#1036): the renderer
  // embeds the WebP asset as a data URI, but librsvg cannot rasterize
  // WebP data URIs and silently drops the image, so the loader
  // re-encodes the asset as JPEG first. This test renders with the
  // committed asset in place (apps/bot/assets/game-progress/
  // starrail-astral-express.webp, added through the GitHub Web upload
  // because the MCP write tools cannot carry binaries) and checks the
  // actual pixels, not just the layout.
  it('paints the background photo instead of the flat fill', async () => {
    const png = await renderStarRailProgressCard(mockInput);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    // Sample the top strip (y=6): above the frame and every panel, only
    // the background image and the vertical shade gradient cover it. The
    // gradient is x-invariant, so a painted photo yields many distinct
    // colors along the strip, while a dropped image leaves exactly one
    // (the gradient over the flat #0d1020 fill).
    const colors = new Set<string>();
    for (let x = 20; x < info.width - 20; x += 10) {
      const i = (6 * info.width + x) * info.channels;
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    expect(colors.size).toBeGreaterThan(10);
  }, 30_000);
});
