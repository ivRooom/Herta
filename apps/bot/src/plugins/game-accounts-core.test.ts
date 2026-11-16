import { describe, expect, it } from 'vitest';
import {
  EMBED_COLOR_ERROR,
  EMBED_COLOR_NEUTRAL,
  EMBED_COLOR_PRIMARY,
  EMBED_COLOR_SUCCESS,
  EMBED_COLOR_WARNING,
  GAME_CHOICES,
  MAX_EMBED_FIELDS,
  MAX_EMBED_FIELD_VALUE_CHARS,
  MAX_EMBED_TOTAL_CHARS,
  buildGameAccountsErrorEmbed,
  buildLinkSuccessEmbed,
  buildListEmbed,
  buildScoreEmbed,
  buildUnlinkCancelledEmbed,
  buildUnlinkConfirmEmbed,
  buildUnlinkSuccessEmbed,
  buildUnsupportedScoreEmbed,
  embedCharacterCount,
  formatGameAccountsError,
  formatJstDateTime,
  formatRolls,
  formatRollsShort,
  formatScoreBar,
  gameName,
  isShowcaseSupported,
  scoreLabel,
  scorePieceLabel,
  scoreRollLegend,
} from './game-accounts-core.js';
import type { IvrmGameAccountsResult } from './game-accounts-ivrm.js';

type ListResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'list' }>;
type ScoreResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'score' }>;
type LinkResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'link' }>;

const fetchedAt = '2026-11-15T14:43:29.060Z';

describe('game definitions', () => {
  it('covers the six supported titles with Japanese choice labels', () => {
    expect(GAME_CHOICES).toEqual([
      { name: '原神', value: 'genshin' },
      { name: '崩壊：スターレイル', value: 'starrail' },
      { name: 'ゼンレスゾーンゼロ', value: 'zzz' },
      { name: 'アークナイツ：エンドフィールド', value: 'endfield' },
      { name: '鳴潮', value: 'wuthering' },
      { name: 'NTE', value: 'nte' },
    ]);
    expect(gameName('genshin')).toBe('原神');
    expect(gameName('unknown-game')).toBe('unknown-game');
    expect(isShowcaseSupported('genshin')).toBe(true);
    expect(isShowcaseSupported('wuthering')).toBe(false);
    expect(isShowcaseSupported('nte')).toBe(false);
  });
  it('names the score per game in its own terms', () => {
    expect(scoreLabel('genshin')).toBe('聖遺物スコア');
    expect(scoreLabel('starrail')).toBe('遺物スコア');
    expect(scoreLabel('zzz')).toBe('ドライブディスクスコア');
  });
});

describe('formatJstDateTime', () => {
  it('renders JST and treats missing or invalid values as not fetched', () => {
    expect(formatJstDateTime(fetchedAt)).toBe('2026/11/15 23:43 (JST)');
    expect(formatJstDateTime(null)).toBe('未取得');
    expect(formatJstDateTime(undefined)).toBe('未取得');
    expect(formatJstDateTime('not-a-date')).toBe('未取得');
  });
});

describe('formatRolls', () => {
  it('labels stats in Japanese, sorts by count and hides zero counts', () => {
    expect(formatRolls({ critDmg: 3, critRate: 3, energyRecharge: 1, hpPercent: 0 })).toBe(
      '会心率×3・会心ダメージ×3・元素チャージ効率×1',
    );
    expect(formatRolls({})).toBe('有効ロールなし');
    expect(formatRolls({ customStat: 2 })).toBe('customStat×2');
  });
});

describe('formatRollsShort', () => {
  it('compresses stat labels without dropping roll kinds or counts', () => {
    expect(formatRollsShort({ critDmg: 3, critRate: 3, energyRecharge: 1, hpPercent: 0 })).toBe(
      '率×3・ダメ×3・チャージ×1',
    );
    expect(formatRollsShort({ atkPercent: 3, elementalMastery: 2, defPercent: 1, spd: 1 })).toBe(
      '攻撃%×3・熟知×2・防御%×1・速度×1',
    );
    expect(formatRollsShort({})).toBe('有効ロールなし');
    expect(formatRollsShort({ customStat: 2 })).toBe('customStat×2');
  });
  it('keeps the same ordering as the full-label form', () => {
    const rolls = { energyRecharge: 2, critDmg: 2, critRate: 3, hpPercent: 2 };
    expect(formatRollsShort(rolls)).toBe('率×3・ダメ×2・チャージ×2・HP%×2');
  });
});

describe('scorePieceLabel', () => {
  it('names Genshin pieces by slot in showcase order', () => {
    expect([0, 1, 2, 3, 4].map((index) => scorePieceLabel('genshin', index))).toEqual([
      '花',
      '羽',
      '砂',
      '杯',
      '冠',
    ]);
    expect(scorePieceLabel('genshin', 5)).toBe('部位6');
  });
  it('names Star Rail pieces by slot in showcase order', () => {
    expect([0, 1, 2, 3, 4, 5].map((index) => scorePieceLabel('starrail', index))).toEqual([
      '頭',
      '腕',
      '胴',
      '脚',
      '球',
      '縄',
    ]);
  });
  it('numbers ZZZ discs and Endfield equipment', () => {
    expect(scorePieceLabel('zzz', 0)).toBe('ディスク1');
    expect(scorePieceLabel('zzz', 5)).toBe('ディスク6');
    expect(scorePieceLabel('endfield', 0)).toBe('装備1');
    expect(scorePieceLabel('endfield', 3)).toBe('装備4');
    expect(scorePieceLabel('unknown-game', 1)).toBe('部位2');
  });
});

describe('formatScoreBar', () => {
  it('renders an empty bar at zero and a full bar at or above the scale max', () => {
    expect(formatScoreBar(0, 'genshin')).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(formatScoreBar(250, 'genshin')).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(formatScoreBar(999, 'genshin')).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(formatScoreBar(-10, 'genshin')).toBe('▱▱▱▱▱▱▱▱▱▱');
  });
  it('scales per game: six-piece games use a 300 max', () => {
    expect(formatScoreBar(160.8, 'genshin')).toBe('▰▰▰▰▰▰▱▱▱▱');
    expect(formatScoreBar(150, 'genshin')).toBe('▰▰▰▰▰▰▱▱▱▱');
    expect(formatScoreBar(150, 'starrail')).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(formatScoreBar(150, 'zzz')).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(formatScoreBar(100, 'endfield')).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(formatScoreBar(125, 'unknown-game')).toBe('▰▰▰▰▰▱▱▱▱▱');
  });
});

describe('scoreRollLegend', () => {
  it('explains the non-obvious short labels once per game', () => {
    expect(scoreRollLegend('genshin')).toContain('チャージ=元素チャージ効率');
    expect(scoreRollLegend('genshin')).toContain('熟知=元素熟知');
    expect(scoreRollLegend('starrail')).toBe('率=会心率・ダメ=会心ダメージ');
  });
});
describe('buildListEmbed', () => {
  it('guides to registration when nothing is linked', () => {
    const result: ListResult = { status: 'ok', action: 'list', accounts: [] };
    const embed = buildListEmbed(result);
    expect(embed.description).toContain('登録済みのゲームアカウントはありません');
    expect(embed.fields).toBeUndefined();
  });
  it('shows UID and last sync per game as fields, with unsupported titles marked', () => {
    const result: ListResult = {
      status: 'ok',
      action: 'list',
      accounts: [
        {
          gameCode: 'genshin',
          uid: '812468719',
          region: null,
          createdAt: fetchedAt,
          updatedAt: fetchedAt,
          showcaseStatus: 'ok',
          showcaseFetchedAt: fetchedAt,
        },
        {
          gameCode: 'starrail',
          uid: '800123456',
          region: null,
          createdAt: fetchedAt,
          updatedAt: fetchedAt,
          showcaseStatus: null,
          showcaseFetchedAt: null,
        },
        {
          gameCode: 'wuthering',
          uid: '123456789',
          region: null,
          createdAt: fetchedAt,
          updatedAt: fetchedAt,
          showcaseStatus: null,
          showcaseFetchedAt: null,
        },
      ],
    };
    const embed = buildListEmbed(result);
    expect(embed.title).toBe('🎮 登録済みのゲームアカウント');
    expect(embed.color).toBe(EMBED_COLOR_PRIMARY);
    expect(embed.fields).toHaveLength(3);
    expect(embed.fields?.[0]).toEqual({
      name: '原神',
      value: 'UID 812468719\n最終同期：2026/11/15 23:43 (JST)',
    });
    expect(embed.fields?.[1]?.value).toContain('最終同期：未取得');
    expect(embed.fields?.[2]?.value).toContain('ショーケース未対応');
  });
  it('keeps the total embed size within budget when UIDs are extremely long', () => {
    const longUid = '1'.repeat(1020);
    const result: ListResult = {
      status: 'ok',
      action: 'list',
      accounts: Array.from({ length: 6 }, (_, index) => ({
        gameCode: ['genshin', 'starrail', 'zzz', 'endfield', 'wuthering', 'nte'][index]!,
        uid: longUid,
        region: null,
        createdAt: fetchedAt,
        updatedAt: fetchedAt,
        showcaseStatus: null,
        showcaseFetchedAt: null,
      })),
    };
    const embed = buildListEmbed(result);
    expect(embedCharacterCount(embed)).toBeLessThanOrEqual(MAX_EMBED_TOTAL_CHARS);
    expect(embed.fields?.at(-1)?.name).toContain('ほか');
  });
});

describe('buildScoreEmbed', () => {
  const base: ScoreResult = {
    status: 'ok',
    action: 'score',
    gameCode: 'genshin',
    uid: '812468719',
    showcaseStatus: 'ok',
    fetchedAt,
    hasSnapshot: true,
    characters: [
      {
        id: '10000098',
        name: 'クロリンデ',
        level: 80,
        artifactScore: {
          total: 160.8,
          version: 1,
          perPiece: [
            { cv: 34.9, rolls: { critRate: 3, critDmg: 3, energyRecharge: 1 } },
            { cv: 28, rolls: { critRate: 2, critDmg: 2 } },
          ],
        },
      },
      { id: '10000061', name: '綺良々', level: 70, artifactScore: null },
      { id: '10000091', name: null, level: 60, artifactScore: null },
    ],
  };
  it('renders one field per character with a score bar and slot-named breakdowns', () => {
    const embed = buildScoreEmbed(base);
    expect(embed.title).toBe('🎮 原神の聖遺物スコア');
    expect(embed.color).toBe(EMBED_COLOR_PRIMARY);
    expect(embed.footer?.text).toBe(
      'UID 812468719 ・ 取得：2026/11/15 23:43 (JST) ・ 凡例：率=会心率・ダメ=会心ダメージ・チャージ=元素チャージ効率・熟知=元素熟知',
    );
    expect(embed.fields).toHaveLength(3);
    expect(embed.fields?.[0]?.name).toBe('クロリンデ Lv.80 ・ スコア 160.8');
    expect(embed.fields?.[0]?.value).toContain('▰▰▰▰▰▰▱▱▱▱');
    expect(embed.fields?.[0]?.value).toContain('花 CV 34.9（率×3・ダメ×3・チャージ×1）');
    expect(embed.fields?.[0]?.value).toContain('羽 CV 28.0（率×2・ダメ×2）');
    expect(embed.fields?.[1]).toEqual({ name: '綺良々 Lv.70', value: 'スコアなし' });
    expect(embed.fields?.[2]?.name).toBe('キャラクターID 10000091 Lv.60');
    expect(embedCharacterCount(embed)).toBeLessThanOrEqual(MAX_EMBED_TOTAL_CHARS);
  });
  it('names Star Rail pieces by slot and scales the bar to six pieces', () => {
    const embed = buildScoreEmbed({
      ...base,
      gameCode: 'starrail',
      characters: [
        {
          id: '1001',
          name: 'テストキャラ',
          level: 80,
          artifactScore: {
            total: 150,
            version: 1,
            perPiece: [
              { cv: 30, rolls: { critRate: 3, critDmg: 2 } },
              { cv: 25, rolls: { critDmg: 3 } },
              { cv: 20, rolls: { critRate: 2 } },
              { cv: 25, rolls: { critDmg: 2 } },
              { cv: 25, rolls: { critRate: 1 } },
              { cv: 25, rolls: { critDmg: 1 } },
            ],
          },
        },
      ],
    });
    const value = embed.fields?.[0]?.value ?? '';
    expect(value).toContain('▰▰▰▰▰▱▱▱▱▱');
    expect(value).toContain('頭 CV 30.0（率×3・ダメ×2）');
    expect(value).toContain('縄 CV 25.0（ダメ×1）');
    expect(embed.footer?.text).toContain('凡例：率=会心率・ダメ=会心ダメージ');
  });
  it('omits the legend when no character has a score', () => {
    const embed = buildScoreEmbed({
      ...base,
      characters: [{ id: '10000061', name: '綺良々', level: 70, artifactScore: null }],
    });
    expect(embed.footer?.text).toBe('UID 812468719 ・ 取得：2026/11/15 23:43 (JST)');
  });
  it('titles the embed with each game’s own score term', () => {
    expect(buildScoreEmbed({ ...base, gameCode: 'starrail' }).title).toBe(
      '🎮 崩壊：スターレイルの遺物スコア',
    );
    expect(buildScoreEmbed({ ...base, gameCode: 'zzz' }).title).toBe(
      '🎮 ゼンレスゾーンゼロのドライブディスクスコア',
    );
  });
  it('explains when no snapshot exists yet', () => {
    const embed = buildScoreEmbed({ ...base, hasSnapshot: false, characters: [] });
    expect(embed.description).toContain('ショーケースはまだ取得できていません');
    expect(embed.description).toContain('状態：ok');
    expect(embed.color).toBe(EMBED_COLOR_NEUTRAL);
    expect(embed.fields).toBeUndefined();
  });
});

describe('buildScoreEmbed limits', () => {
  function manyCharacters(count: number, piecesPerCharacter = 2): ScoreResult['characters'] {
    return Array.from({ length: count }, (_, index) => ({
      id: String(1000 + index),
      name: `キャラ${index}`,
      level: 80,
      artifactScore: {
        total: 100,
        version: 1,
        perPiece: Array.from({ length: piecesPerCharacter }, () => ({
          cv: 30,
          rolls: { critRate: 3, critDmg: 3, energyRecharge: 1 },
        })),
      },
    }));
  }
  it('caps fields at 25 and folds the rest into an omission field', () => {
    const embed = buildScoreEmbed({
      status: 'ok',
      action: 'score',
      gameCode: 'genshin',
      uid: '812468719',
      showcaseStatus: 'ok',
      fetchedAt,
      hasSnapshot: true,
      characters: manyCharacters(30),
    });
    expect(embed.fields).toHaveLength(MAX_EMBED_FIELDS);
    expect(embed.fields?.at(-1)?.name).toContain('ほか 6 件');
    expect(embedCharacterCount(embed)).toBeLessThanOrEqual(MAX_EMBED_TOTAL_CHARS);
  });
  it('truncates an over-long field value to 1024 chars', () => {
    const embed = buildScoreEmbed({
      status: 'ok',
      action: 'score',
      gameCode: 'genshin',
      uid: '812468719',
      showcaseStatus: 'ok',
      fetchedAt,
      hasSnapshot: true,
      characters: manyCharacters(1, 60),
    });
    const value = embed.fields?.[0]?.value ?? '';
    expect(value.length).toBeLessThanOrEqual(MAX_EMBED_FIELD_VALUE_CHARS);
    expect(value.endsWith('…')).toBe(true);
  });
  it('fits 30 pieces in one field now that the breakdown is compressed', () => {
    // 旧形式 (番号+正式名称) では 30 部位で 1024 字を超えて切り捨てられた。
    const embed = buildScoreEmbed({
      status: 'ok',
      action: 'score',
      gameCode: 'genshin',
      uid: '812468719',
      showcaseStatus: 'ok',
      fetchedAt,
      hasSnapshot: true,
      characters: manyCharacters(1, 30),
    });
    const value = embed.fields?.[0]?.value ?? '';
    expect(value.length).toBeLessThanOrEqual(MAX_EMBED_FIELD_VALUE_CHARS);
    expect(value.endsWith('…')).toBe(false);
    expect(value).toContain('花 CV 30.0（率×3・ダメ×3・チャージ×1）');
    expect(value).toContain('部位30 CV 30.0（率×3・ダメ×3・チャージ×1）');
  });
  it('keeps the whole embed within 6000 chars even with many long fields', () => {
    const embed = buildScoreEmbed({
      status: 'ok',
      action: 'score',
      gameCode: 'genshin',
      uid: '812468719',
      showcaseStatus: 'ok',
      fetchedAt,
      hasSnapshot: true,
      characters: manyCharacters(24, 30),
    });
    expect(embedCharacterCount(embed)).toBeLessThanOrEqual(MAX_EMBED_TOTAL_CHARS);
    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(MAX_EMBED_FIELD_VALUE_CHARS);
    }
    expect(embed.fields?.at(-1)?.name).toContain('ほか');
  });
});

describe('link / unlink / error embeds', () => {
  const linkBase: LinkResult = {
    status: 'ok',
    action: 'link',
    account: {
      gameCode: 'genshin',
      uid: '812468719',
      region: null,
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
    },
    showcase: { status: 'ok', stale: false, fetchedAt },
  };
  it('reports a fetched showcase after linking, in the success color', () => {
    const embed = buildLinkSuccessEmbed(linkBase);
    expect(embed.color).toBe(EMBED_COLOR_SUCCESS);
    expect(embed.title).toContain('原神 のUID（812468719）を登録しました');
    expect(embed.description).toContain('ショーケースを取得しました（2026/11/15 23:43 (JST)）');
  });
  it('reports a pending showcase and UID-only titles honestly', () => {
    expect(
      buildLinkSuccessEmbed({
        ...linkBase,
        showcase: { status: 'pending', stale: false, fetchedAt: null },
      }).description,
    ).toContain('ショーケースはまだ取得できていません（状態：pending）');
    expect(
      buildLinkSuccessEmbed({
        ...linkBase,
        account: { ...linkBase.account, gameCode: 'nte' },
      }).description,
    ).toContain('UIDの登録のみ行いました');
  });
  it('confirms unlink and names the game', () => {
    const embed = buildUnlinkSuccessEmbed('starrail');
    expect(embed.color).toBe(EMBED_COLOR_SUCCESS);
    expect(embed.title).toContain('崩壊：スターレイル のUID登録を解除しました');
  });
  it('asks for confirmation in the warning color and reports cancellation as neutral', () => {
    const confirm = buildUnlinkConfirmEmbed('genshin');
    expect(confirm.color).toBe(EMBED_COLOR_WARNING);
    expect(confirm.description).toContain('よろしいですか？');
    const cancelled = buildUnlinkCancelledEmbed('genshin');
    expect(cancelled.color).toBe(EMBED_COLOR_NEUTRAL);
    expect(cancelled.description).toContain('キャンセルしました');
  });
  it('keeps the current error wording, shown in the error color', () => {
    const embed = buildGameAccountsErrorEmbed({ status: 'not-linked' });
    expect(embed.color).toBe(EMBED_COLOR_ERROR);
    expect(embed.description).toContain('会員連携が見つかりません');
    expect(embed.description).toContain('https://member.ivrm.jp/profile');
    expect(embed.description).toBe(formatGameAccountsError({ status: 'not-linked' }));
  });
  it('maps every failure status to a distinct message', () => {
    expect(formatGameAccountsError({ status: 'not-found', error: 'game_not_found' })).toContain(
      '連携対象外',
    );
    expect(
      formatGameAccountsError({ status: 'not-found', error: 'game_account_not_found' }),
    ).toContain('/game link で登録してください');
    expect(
      formatGameAccountsError({ status: 'invalid-input', field: 'uid', message: '形式が違います' }),
    ).toBe('入力を確認してください（uid：形式が違います）');
    expect(formatGameAccountsError({ status: 'ineligible-guild' })).toContain('対象外');
    expect(formatGameAccountsError({ status: 'unconfigured' })).toContain('未設定');
    expect(formatGameAccountsError({ status: 'unavailable' })).toContain('接続できません');
  });
  it('explains unsupported games for score as a neutral embed', () => {
    const embed = buildUnsupportedScoreEmbed('wuthering');
    expect(embed.color).toBe(EMBED_COLOR_NEUTRAL);
    expect(embed.description).toContain(
      '鳴潮 はショーケース取得に未対応のため、スコアを表示できません',
    );
  });
});
