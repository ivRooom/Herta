import type { PluginManifest } from '@herta/shared';

export const achievementsManifest: PluginManifest = {
  id: 'achievements',
  name: 'Achievements / Badges',
  version: '1.0.0',
  description: 'サーバー活動から実績を解除し、Badge Collectionと進捗を表示します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'achievements.use',
      name: 'Achievements利用',
      description: '自分やメンバーの実績・Badge・進捗を確認します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Achievementsを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralSync: {
        type: 'boolean',
        title: '同期結果を本人だけに表示する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      showLocked: {
        type: 'boolean',
        title: '未解除実績を一覧に表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      showProgress: {
        type: 'boolean',
        title: '未解除実績の進捗を表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      hideSecretUntilUnlocked: {
        type: 'boolean',
        title: 'Secret実績を解除まで隠す',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      pageSize: {
        type: 'integer',
        title: '一覧1ページの実績数',
        minimum: 5,
        maximum: 20,
        default: 10,
        'x-herta-ui': { section: '表示設定' },
      },
    },
    required: [
      'enabled',
      'ephemeralSync',
      'showLocked',
      'showProgress',
      'hideSecretUntilUnlocked',
      'pageSize',
    ],
  },
  events: [],
  commands: [
    {
      name: 'achievements',
      description: '実績・Badge Collectionと進捗を表示します',
      options: [
        {
          name: 'user',
          description: '確認するメンバー（未指定は自分）',
          type: 'user',
        },
      ],
    },
    {
      name: 'achievement',
      description: 'Achievementsを同期・確認します',
      subcommands: [
        {
          name: 'sync',
          description: '現在の活動データから実績解除状態を同期します',
        },
        {
          name: 'info',
          description: '実績の条件・現在進捗を表示します',
          options: [
            {
              name: 'id',
              description: 'Achievement ID',
              type: 'string',
              required: true,
            },
            {
              name: 'user',
              description: '確認するメンバー（未指定は自分）',
              type: 'user',
            },
          ],
        },
      ],
    },
  ],
};
