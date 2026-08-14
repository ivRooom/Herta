import type { PluginManifest } from '@herta/shared';

export const miniGamesManifest: PluginManifest = {
  id: 'mini-games',
  name: 'Mini Games',
  version: '2.0.0',
  description: 'Coin Flip・High-Low・Blackjackを戦績付きでDiscord内で遊べるミニゲームPluginです',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [
    {
      id: 'mini-games.manage',
      name: 'Mini Games 管理',
      description: 'Mini Gamesの演出・セッション・ゲームルール設定を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Mini Gamesを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      statsEnabled: {
        type: 'boolean',
        title: 'ゲーム戦績を記録・表示する',
        default: true,
        'x-herta-ui': {
          section: '戦績',
          help: '既存のCommunity Activity基盤へプレイ数・勝利数・最高連勝などを記録します。',
        },
      },
      coinflipAnimation: {
        type: 'boolean',
        title: 'Coin FlipでGIFアニメーションを表示する',
        default: true,
        'x-herta-ui': {
          section: 'Coin Flip',
          help: '外部URLを使わず、Botに同梱した軽量GIFをDiscordへ添付します。',
        },
      },
      sessionTimeoutSeconds: {
        type: 'integer',
        title: '操作待ちタイムアウト（秒）',
        minimum: 30,
        maximum: 300,
        default: 90,
        'x-herta-ui': {
          section: 'セッション',
          help: 'High-Low / Blackjackで操作がないまま終了するまでの時間です。',
        },
      },
      highLowMaxRounds: {
        type: 'integer',
        title: 'High-Low 最大ラウンド数',
        minimum: 3,
        maximum: 25,
        default: 10,
        'x-herta-ui': {
          section: 'High-Low',
          help: 'この回数を連続正解するとパーフェクトクリアになります。',
        },
      },
      blackjackDealerHitsSoft17: {
        type: 'boolean',
        title: 'DealerはSoft 17でHitする',
        default: false,
        'x-herta-ui': {
          section: 'Blackjack',
          help: 'OFFではDealerはSoft 17でもStandします。',
        },
      },
    },
    required: [
      'enabled',
      'coinflipAnimation',
      'sessionTimeoutSeconds',
      'highLowMaxRounds',
      'blackjackDealerHitsSoft17',
    ],
  },
  events: ['interactionCreate'],
  commands: [
    {
      name: 'coinflip',
      description: 'アニメーション付きでコインを投げます',
      options: [
        {
          name: 'choice',
          description: '表・裏を予想する場合に選択します',
          type: 'string',
          choices: [
            { name: '表 / Heads', value: 'heads' },
            { name: '裏 / Tails', value: 'tails' },
          ],
        },
      ],
    },
    {
      name: 'highlow',
      description: '次のカードが高いか低いかを当てるHigh-Lowを開始します',
    },
    {
      name: 'blackjack',
      description: 'Dealerと1対1でBlackjackを開始します',
    },
    {
      name: 'gamestats',
      description: 'Mini Gamesの戦績・勝率・最高連勝を表示します',
      options: [
        {
          name: 'user',
          description: '確認するメンバー（未指定は自分）',
          type: 'user',
        },
      ],
    },
  ],
};
