import type { PluginManifest } from '@herta/shared';

export const pollManifest: PluginManifest = {
  id: 'poll',
  name: 'Poll',
  version: '1.0.0',
  description: 'Buttonで投票できる永続Pollと自動集計を提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'poll.use',
      name: 'Poll 利用',
      description: '投票の作成・確認・終了と投票参加を行います',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Pollを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralResponses: {
        type: 'boolean',
        title: '管理コマンド結果を本人だけに表示する',
        default: true,
        'x-herta-ui': {
          section: '基本設定',
          help: '投票そのものはチャンネルへ公開されます。作成・終了などの確認メッセージだけを非公開にします。',
        },
      },
      defaultDurationMinutes: {
        type: 'integer',
        title: '既定の投票時間（分）',
        description: 'コマンドでdurationを省略した場合に使う時間です',
        minimum: 1,
        maximum: 10080,
        default: 60,
        'x-herta-ui': { section: '時間設定' },
      },
      maxDurationMinutes: {
        type: 'integer',
        title: '投票時間の上限（分）',
        minimum: 1,
        maximum: 10080,
        default: 10080,
        'x-herta-ui': {
          section: '時間設定',
          help: '最大7日です。既定の投票時間より短く設定した場合は上限側へ丸めます。',
        },
      },
      defaultMultipleChoice: {
        type: 'boolean',
        title: '複数選択を既定にする',
        default: false,
        'x-herta-ui': { section: '投票方式' },
      },
      showLiveResults: {
        type: 'boolean',
        title: '投票中も得票数を表示する',
        default: true,
        'x-herta-ui': {
          section: '表示設定',
          help: '無効にすると締切までは選択肢ごとの得票数を隠します。',
        },
      },
      resultStyle: {
        type: 'string',
        title: '結果表示方式',
        enum: ['count', 'percentage'],
        default: 'percentage',
        'x-herta-ui': {
          section: '表示設定',
          help: 'countは票数中心、percentageは割合も表示します。',
        },
      },
      closeAnnouncement: {
        type: 'boolean',
        title: '終了後に最終結果を公開する',
        default: true,
        'x-herta-ui': {
          section: '終了処理',
          help: '無効でも締切時に投票Buttonは停止しますが、最終得票数はチャンネル上へ表示しません。',
        },
      },
      maxActivePerUser: {
        type: 'integer',
        title: 'ユーザーごとの同時開催Poll上限',
        minimum: 1,
        maximum: 20,
        default: 5,
        'x-herta-ui': {
          section: '制限',
          help: '大量作成によるチャンネル占有を防ぐための上限です。',
        },
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'defaultDurationMinutes',
      'maxDurationMinutes',
      'defaultMultipleChoice',
      'showLiveResults',
      'resultStyle',
      'closeAnnouncement',
      'maxActivePerUser',
    ],
  },
  events: ['interactionCreate'],
  commands: [
    {
      name: 'poll',
      description: '投票を作成・確認・終了します',
      subcommands: [
        {
          name: 'create',
          description: '新しい投票を作成します',
          options: [
            {
              name: 'question',
              description: '投票の質問（1〜200文字）',
              type: 'string',
              required: true,
            },
            {
              name: 'options',
              description: '選択肢を | で区切って2〜10件入力します',
              type: 'string',
              required: true,
            },
            {
              name: 'duration',
              description: '投票時間（分）。省略時はStudio設定を使用',
              type: 'integer',
              minValue: 1,
              maxValue: 10080,
            },
            {
              name: 'multiple',
              description: '複数選択を許可するか。省略時はStudio設定を使用',
              type: 'boolean',
            },
          ],
        },
        {
          name: 'list',
          description: '自分が開催中の投票を一覧表示します',
        },
        {
          name: 'results',
          description: '投票結果を確認します',
          options: [
            {
              name: 'id',
              description: '/poll listに表示されるPoll ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'close',
          description: '自分が作成した投票を終了します',
          options: [
            {
              name: 'id',
              description: '/poll listに表示されるPoll ID',
              type: 'string',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
