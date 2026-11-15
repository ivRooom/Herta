import { describe, expect, it } from 'vitest';
import {
  GAME_CHOICES,
  formatGameAccountsError,
  formatJstDateTime,
  formatLinkSuccess,
  formatListMessage,
  formatRolls,
  formatScoreMessage,
  formatUnlinkSuccess,
  formatUnsupportedScoreMessage,
  gameName,
  isShowcaseSupported,
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

describe('formatListMessage', () => {
  it('guides to registration when nothing is linked', () => {
    const result: ListResult = { status: 'ok', action: 'list', accounts: [] };
    expect(formatListMessage(result)).toContain('登録済みのゲームアカウントはありません');
  });
  it('shows UID and last sync per game, with unsupported titles marked', () => {
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
    const message = formatListMessage(result);
    expect(message).toContain('原神：UID 812468719（最終同期：2026/11/15 23:43 (JST)）');
    expect(message).toContain('崩壊：スターレイル：UID 800123456（最終同期：未取得）');
    expect(message).toContain('鳴潮：UID 123456789（ショーケース未対応）');
  });
});

describe('formatScoreMessage', () => {
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
  it('shows totals, per-piece CV breakdowns and score-less characters', () => {
    const message = formatScoreMessage(base);
    expect(message).toContain('原神 の聖遺物スコア（UID 812468719）');
    expect(message).toContain('取得：2026/11/15 23:43 (JST)');
    expect(message).toContain('クロリンデ Lv.80 — スコア 160.8');
    expect(message).toContain('1. CV 34.9（会心率×3・会心ダメージ×3・元素チャージ効率×1）');
    expect(message).toContain('2. CV 28.0（会心率×2・会心ダメージ×2）');
    expect(message).toContain('綺良々 Lv.70 — スコアなし');
    expect(message).toContain('キャラクターID 10000091 Lv.60 — スコアなし');
  });
  it('explains when no snapshot exists yet', () => {
    const message = formatScoreMessage({ ...base, hasSnapshot: false, characters: [] });
    expect(message).toContain('ショーケースはまだ取得できていません');
    expect(message).toContain('状態：ok');
  });
});

describe('link / unlink / error messages', () => {
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
  it('reports a fetched showcase after linking', () => {
    const message = formatLinkSuccess(linkBase);
    expect(message).toContain('原神 のUID（812468719）を登録しました');
    expect(message).toContain('ショーケースを取得しました（2026/11/15 23:43 (JST)）');
  });
  it('reports a pending showcase and UID-only titles honestly', () => {
    expect(
      formatLinkSuccess({
        ...linkBase,
        showcase: { status: 'pending', stale: false, fetchedAt: null },
      }),
    ).toContain('ショーケースはまだ取得できていません（状態：pending）');
    expect(
      formatLinkSuccess({
        ...linkBase,
        account: { ...linkBase.account, gameCode: 'nte' },
      }),
    ).toContain('UIDの登録のみ行いました');
  });
  it('confirms unlink and names the game', () => {
    expect(formatUnlinkSuccess('starrail')).toContain('崩壊：スターレイル のUID登録を解除しました');
  });
  it('guides unlinked members to the Web portal first', () => {
    const message = formatGameAccountsError({ status: 'not-linked' });
    expect(message).toContain('会員連携が見つかりません');
    expect(message).toContain('https://member.ivrm.jp/profile');
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
  it('explains unsupported games for score', () => {
    expect(formatUnsupportedScoreMessage('wuthering')).toContain(
      '鳴潮 はショーケース取得に未対応のため、スコアを表示できません',
    );
  });
});
