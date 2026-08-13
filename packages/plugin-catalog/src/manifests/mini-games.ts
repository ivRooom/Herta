import type { PluginManifest } from '@herta/shared';

export const miniGamesManifest: PluginManifest = {
  id: 'mini-games',
  name: 'Mini Games',
  version: '3.0.0',
  description:
    'Coin Flip・High-Low・Blackjack・Dice・チンチロを戦績とArcadeランキング付きで遊べるPluginです',
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
      leaderboardEnabled: {
        type: 'boolean',
        title: 'Arcade Leaderboardを有効化する',
        default: true,
        'x-herta-ui': {
          section: '戦績',
          help: '総勝利・総プレイ・ゲーム別記録をサーバー内ランキングとして表示します。',
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
    {
      name: 'dice',
      description: '1〜10個のダイスを振ります',
      options: [
        {
          name: 'count',
          description: '振る個数（1〜10、既定1）',
          type: 'integer',
          minValue: 1,
          maxValue: 10,
        },
        {
          name: 'sides',
          description: 'ダイスの面数（2〜100、既定6）',
          type: 'integer',
          minValue: 2,
          maxValue: 100,
        },
      ],
    },
    {
      name: 'chinchiro',
      description: '親とチンチロで1勝負します',
    },
    {
      name: 'gameleaderboard',
      description: 'Mini GamesのArcadeランキングを表示します',
      options: [
        {
          name: 'metric',
          description: 'ランキング指標',
          type: 'string',
          choices: [
            { name: '総勝利', value: 'minigame_wins' },
            { name: '総プレイ', value: 'minigame_plays' },
            { name: 'Coin Flip 的中', value: 'coinflip_wins' },
            { name: 'High-Low 最高連勝', value: 'highlow_best_streak' },
            { name: 'Blackjack 勝利', value: 'blackjack_wins' },
            { name: 'チンチロ 勝利', value: 'chinchiro_wins' },
            { name: 'Dice 6の目', value: 'dice_sixes' },
          ],
        },
        {
          name: 'limit',
          description: '表示人数（5〜25、既定10）',
          type: 'integer',
          minValue: 5,
          maxValue: 25,
        },
      ],
    },
  ],
};
