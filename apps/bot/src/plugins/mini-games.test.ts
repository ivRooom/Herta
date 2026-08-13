import { describe, expect, it } from 'vitest';
import { miniGamesManifest } from '@herta/plugin-catalog';
import { createCoinFlipGif } from './mini-games-coinflip-animation.js';
import {
  formatCoinFlipResult,
  normalizeMiniGamesConfig,
  parseMiniGameCustomId,
} from './mini-games.js';

describe('Mini Games Plugin', () => {
  it('設定を安全な範囲へ正規化する', () => {
    expect(normalizeMiniGamesConfig(undefined)).toEqual({
      enabled: true,
      statsEnabled: true,
      coinflipAnimation: true,
      sessionTimeoutSeconds: 90,
      highLowMaxRounds: 10,
      blackjackDealerHitsSoft17: false,
    });
    expect(
      normalizeMiniGamesConfig({
        enabled: false,
        statsEnabled: false,
        coinflipAnimation: false,
        sessionTimeoutSeconds: 999,
        highLowMaxRounds: 1,
        blackjackDealerHitsSoft17: true,
      }),
    ).toEqual({
      enabled: false,
      statsEnabled: false,
      coinflipAnimation: false,
      sessionTimeoutSeconds: 300,
      highLowMaxRounds: 3,
      blackjackDealerHitsSoft17: true,
    });
  });

  it('Coin Flip結果と予想の当落を表示する', () => {
    expect(formatCoinFlipResult('heads', 'heads')).toContain('🎉 **的中！**');
    expect(formatCoinFlipResult('tails', 'heads')).toContain('💥 **はずれ！**');
    const noChoice = formatCoinFlipResult('tails');
    expect(noChoice).toContain('裏 / Tails');
    expect(noChoice).not.toContain('的中');
    expect(noChoice).not.toContain('はずれ');
  });

  it('Coin Flip GIFを外部HTTPなしで同梱する', () => {
    const gif = createCoinFlipGif();
    expect(gif.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
    expect(gif.byteLength).toBeGreaterThan(1_000);
    expect(gif.byteLength).toBeLessThan(10_000);
  });

  it('Mini Games用Custom IDだけを受理する', () => {
    const id = '0123456789abcdef0123456789abcdef';
    expect(parseMiniGameCustomId(`herta:mini-games:v1:highlow:${id}:higher`)).toEqual({
      type: 'highlow',
      sessionId: id,
      action: 'higher',
    });
    expect(parseMiniGameCustomId(`herta:mini-games:v1:blackjack:${id}:hit`)).toEqual({
      type: 'blackjack',
      sessionId: id,
      action: 'hit',
    });
    expect(parseMiniGameCustomId(`herta:mini-games:v1:blackjack:not-a-uuid:hit`)).toBeNull();
    expect(parseMiniGameCustomId(`herta:poll:v1:blackjack:${id}:hit`)).toBeNull();
  });

  it('Manifestに3ゲーム・戦績コマンド・interactionCreateを登録する', () => {
    expect(miniGamesManifest.commands.map((command) => command.name)).toEqual([
      'coinflip',
      'highlow',
      'blackjack',
      'gamestats',
      'dice',
      'chinchiro',
      'gameleaderboard',
    ]);
    expect(miniGamesManifest.events).toContain('interactionCreate');
  });
});
