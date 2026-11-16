import type { PluginManifest } from '@herta/shared';

const gameChoices = [
  { name: '原神', value: 'genshin' },
  { name: '崩壊：スターレイル', value: 'starrail' },
  { name: 'ゼンレスゾーンゼロ', value: 'zzz' },
  { name: 'アークナイツ：エンドフィールド', value: 'endfield' },
  { name: '鳴潮', value: 'wuthering' },
  { name: 'NTE', value: 'nte' },
];

export const gameAccountsManifest: PluginManifest = {
  id: 'game-accounts',
  name: 'ゲームアカウント連携',
  version: '1.0.0',
  description:
    'Discordからivrm-webのゲームアカウントへUIDを登録・解除し、Enkaショーケースの聖遺物スコアやHoYoLABの探索度を確認できます。登録内容はWebのマイページと同期します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [],
  dependencies: [],
  events: ['interactionCreate'],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', title: 'ゲームアカウント連携を有効にする', default: true },
    },
    required: ['enabled'],
  },
  commands: [
    {
      name: 'game',
      description: 'ivrm-webのゲームアカウント連携（UID登録・聖遺物スコア・探索度）',
      subcommands: [
        {
          name: 'link',
          description: 'ゲームのUIDを登録します（Webのマイページと同期）',
          options: [
            {
              name: 'game',
              description: 'ゲームタイトル',
              type: 'string',
              required: true,
              choices: gameChoices,
            },
            {
              name: 'uid',
              description: 'ゲーム内のUID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'unlink',
          description: 'ゲームのUID登録を解除します（確認ボタンつき）',
          options: [
            {
              name: 'game',
              description: 'ゲームタイトル',
              type: 'string',
              required: true,
              choices: gameChoices,
            },
          ],
        },
        {
          name: 'list',
          description: '登録済みのゲームアカウントと最終同期時刻を表示します',
        },
        {
          name: 'score',
          description: 'ショーケースの聖遺物・遺物スコアを表示します',
          options: [
            {
              name: 'game',
              description: 'ゲームタイトル',
              type: 'string',
              required: true,
              choices: gameChoices,
            },
          ],
        },
        {
          name: 'progress',
          description: 'HoYoLABの戦績（探索度・宝箱数・高難易度コンテンツ）を表示します',
          options: [
            {
              name: 'game',
              description: 'ゲームタイトル',
              type: 'string',
              required: true,
              choices: gameChoices,
            },
          ],
        },
      ],
    },
  ],
};
