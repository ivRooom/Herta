import type { PluginManifest } from '@herta/shared';

export const minecraftStatusManifest: PluginManifest = {
  id: 'minecraft-status',
  name: 'Minecraft Status',
  version: '1.0.0',
  description: 'Minecraftサーバーの稼働状態・プレイヤー・リソースを確認できます',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'minecraft-status.view',
      name: 'Minecraft Status 閲覧',
      description: 'Minecraftサーバーの稼働状態を確認します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Minecraft Statusを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralResponses: {
        type: 'boolean',
        title: '状態コマンドを自分だけに表示する',
        default: false,
        'x-herta-ui': {
          section: '表示設定',
          help: 'ONにすると /mc の結果を実行者だけに表示します。',
        },
      },
      showResources: {
        type: 'boolean',
        title: 'リソース使用量を表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      showServers: {
        type: 'boolean',
        title: '各サーバーの状態を表示する',
        default: true,
        'x-herta-ui': {
          section: '表示設定',
          help: 'main / proxy / resource など構成サーバーごとの状態を表示します。',
        },
      },
      showBackup: {
        type: 'boolean',
        title: '最新バックアップを表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      staleAfterMinutes: {
        type: 'integer',
        title: '古いデータとみなす分数',
        minimum: 1,
        maximum: 60,
        default: 3,
        'x-herta-ui': {
          section: '表示設定',
          help: '状態データの最終更新からこの分数を超えたら、古い可能性を表示します。',
        },
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'showResources',
      'showServers',
      'showBackup',
      'staleAfterMinutes',
    ],
  },
  events: [],
  commands: [
    {
      name: 'mc',
      description: 'Minecraftサーバーの状態を確認します',
      subcommands: [
        { name: 'status', description: '現在の稼働状態・プレイヤー・リソースを表示します' },
      ],
    },
  ],
};
