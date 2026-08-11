import type { PluginManifest } from '@herta/shared';

export const giveawayManifest: PluginManifest = {
  id: 'giveaway',
  name: 'Giveaway',
  version: '1.0.0',
  description: 'Button参加・自動抽選・再抽選に対応した永続Giveawayを提供します',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [
    {
      id: 'giveaway.use',
      name: 'Giveaway 利用',
      description: 'Giveawayの作成・確認・終了・再抽選と参加を行います',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Giveawayを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralResponses: {
        type: 'boolean',
        title: '管理コマンド結果を本人だけに表示する',
        default: true,
        'x-herta-ui': {
          section: '基本設定',
          help: 'Giveaway本体はチャンネルへ公開し、作成・終了などの確認だけを本人向けにします。',
        },
      },
      defaultDurationMinutes: {
        type: 'integer',
        title: '既定の開催時間（分）',
        minimum: 1,
        maximum: 10080,
        default: 1440,
        'x-herta-ui': {
          section: '時間設定',
          help: 'コマンドでdurationを省略した場合に使用します。既定は24時間です。',
        },
      },
      maxDurationMinutes: {
        type: 'integer',
        title: '開催時間の上限（分）',
        minimum: 1,
        maximum: 10080,
        default: 10080,
        'x-herta-ui': { section: '時間設定', help: '最大7日です。' },
      },
      defaultWinnerCount: {
        type: 'integer',
        title: '既定の当選人数',
        minimum: 1,
        maximum: 20,
        default: 1,
        'x-herta-ui': { section: '抽選設定' },
      },
      maxWinnerCount: {
        type: 'integer',
        title: '当選人数の上限',
        minimum: 1,
        maximum: 20,
        default: 10,
        'x-herta-ui': {
          section: '抽選設定',
          help: 'コマンドで指定できる当選人数を制限します。',
        },
      },
      allowCreatorEntry: {
        type: 'boolean',
        title: '主催者本人の参加を許可する',
        default: false,
        'x-herta-ui': { section: '参加条件' },
      },
      announceWinners: {
        type: 'boolean',
        title: '終了時に当選者をメンションして発表する',
        default: true,
        'x-herta-ui': {
          section: '終了処理',
          help: '無効でも抽選結果は保存され、/giveaway infoから確認できます。',
        },
      },
      maxActivePerUser: {
        type: 'integer',
        title: 'ユーザーごとの同時開催Giveaway上限',
        minimum: 1,
        maximum: 20,
        default: 3,
        'x-herta-ui': {
          section: '制限',
          help: '大量開催によるチャンネル占有を防ぐための上限です。',
        },
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'defaultDurationMinutes',
      'maxDurationMinutes',
      'defaultWinnerCount',
      'maxWinnerCount',
      'allowCreatorEntry',
      'announceWinners',
      'maxActivePerUser',
    ],
  },
  events: ['interactionCreate'],
  commands: [
    {
      name: 'giveaway',
      description: 'Giveawayを作成・確認・終了・再抽選します',
      subcommands: [
        {
          name: 'create',
          description: '新しいGiveawayを作成します',
          options: [
            {
              name: 'prize',
              description: '賞品・内容（1〜200文字）',
              type: 'string',
              required: true,
            },
            {
              name: 'duration',
              description: '開催時間（分）。省略時はStudio設定を使用',
              type: 'integer',
              minValue: 1,
              maxValue: 10080,
            },
            {
              name: 'winners',
              description: '当選人数。省略時はStudio設定を使用',
              type: 'integer',
              minValue: 1,
              maxValue: 20,
            },
          ],
        },
        {
          name: 'list',
          description: '自分が開催中・最近終了したGiveawayを一覧表示します',
        },
        {
          name: 'info',
          description: 'Giveawayの状態と抽選結果を確認します',
          options: [
            {
              name: 'id',
              description: '/giveaway listに表示されるGiveaway ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'end',
          description: '自分が作成したGiveawayを今すぐ終了して抽選します',
          options: [
            {
              name: 'id',
              description: '/giveaway listに表示されるGiveaway ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'reroll',
          description: '終了済みGiveawayの当選者を再抽選します',
          options: [
            {
              name: 'id',
              description: '/giveaway listに表示されるGiveaway ID',
              type: 'string',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
