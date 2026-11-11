import type { PluginManifest } from '@herta/shared';

export const minecraftStatusManifest: PluginManifest = {
  id: 'minecraft-status',
  name: 'Minecraft Status',
  version: '1.2.0',
  description: 'Minecraftサーバーの稼働状態・プレイヤー・リソースを確認できます',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'minecraft-status.view',
      name: 'Minecraft Status 閲覧',
      description: 'Minecraftサーバーの稼働状態を確認します',
    },
    {
      id: 'minecraft-status.control',
      name: 'Minecraft サーバー操作',
      description:
        'Minecraftサーバーの起動・停止・再起動・セーブ・再生成を行います（運営ロール限定）',
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
      operatorRoleIds: {
        type: 'array',
        title: 'サーバー操作を追加で許可するロールID',
        items: { type: 'string' },
        default: [],
        'x-herta-ui': {
          section: '起動コマンド',
          help: '必須ロール（コードで指定）に加えて /mc main・/mc resource の操作を許可するロールIDを指定します。',
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
        {
          name: 'main',
          description: 'メインワールドを操作します（運営ロール限定）',
          options: [
            {
              name: 'action',
              description: '実行する操作',
              type: 'string',
              required: true,
              choices: [
                { name: 'start（起動）', value: 'start' },
                { name: 'stop（セーブして停止）', value: 'stop' },
                { name: 'restart（セーブして再起動）', value: 'restart' },
                { name: 'save（セーブ）', value: 'save' },
              ],
            },
          ],
        },
        {
          name: 'resource',
          description: '資源サーバーを操作します（運営ロール限定）',
          options: [
            {
              name: 'action',
              description: '実行する操作',
              type: 'string',
              required: true,
              choices: [
                { name: 'start（起動）', value: 'start' },
                { name: 'stop（セーブして停止）', value: 'stop' },
                { name: 'restart（セーブして再起動）', value: 'restart' },
                { name: 'save（セーブ）', value: 'save' },
                { name: 'regenerate（ワールド再生成）', value: 'regenerate' },
              ],
            },
          ],
        },
      ],
    },
  ],
};
