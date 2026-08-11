import type { PluginManifest } from '@herta/shared';

export const serverStatsManifest: PluginManifest = {
  id: 'server-stats',
  name: 'Server Stats',
  version: '1.0.0',
  description: 'サーバーの構成・コミュニティ活動・有効Pluginをまとめて確認できます',
  author: { name: 'Herta' },
  category: 'analytics',
  permissions: [
    {
      id: 'server-stats.view',
      name: 'Server Stats 閲覧',
      description: 'サーバー統計・活動状況・Plugin状態を確認します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Server Statsを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralResponses: {
        type: 'boolean',
        title: '統計コマンドを自分だけに表示する',
        default: false,
        'x-herta-ui': {
          section: '表示設定',
          help: 'ONにすると /server の結果を実行者だけに表示します。',
        },
      },
      adminOnly: {
        type: 'boolean',
        title: '管理者だけ統計を閲覧できるようにする',
        default: false,
        'x-herta-ui': {
          section: 'アクセス制御',
          help: 'ONの場合、Manage Server権限を持つメンバーだけ利用できます。',
        },
      },
      includeBots: {
        type: 'boolean',
        title: 'メンバー数にBotを含める',
        default: true,
        'x-herta-ui': { section: '集計設定' },
      },
      activityWindowDays: {
        type: 'integer',
        title: 'Activity集計期間（日）',
        minimum: 1,
        maximum: 30,
        default: 7,
        'x-herta-ui': {
          section: '集計設定',
          help: '/server activity で最近何日分を集計するか指定します。',
        },
      },
      showZeroMetrics: {
        type: 'boolean',
        title: '0件の項目も表示する',
        default: false,
        'x-herta-ui': {
          section: '表示設定',
          help: 'OFFにするとAFK 0件など空の項目を省略します。',
        },
      },
      showCommunityMetrics: {
        type: 'boolean',
        title: 'コミュニティ指標を表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      showContentMetrics: {
        type: 'boolean',
        title: 'Poll / Giveaway / Suggestion等を表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      showPluginSummary: {
        type: 'boolean',
        title: '有効Plugin概要を表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'adminOnly',
      'includeBots',
      'activityWindowDays',
      'showZeroMetrics',
      'showCommunityMetrics',
      'showContentMetrics',
      'showPluginSummary',
    ],
  },
  events: [],
  commands: [
    {
      name: 'server',
      description: 'サーバーの統計・活動状況・Plugin状態を確認します',
      subcommands: [
        { name: 'stats', description: '現在のサーバー概要を表示します' },
        { name: 'activity', description: '最近のコミュニティ活動を表示します' },
        { name: 'plugins', description: '有効Pluginと利用可能コマンドを表示します' },
      ],
    },
  ],
};
