import type { PluginManifest } from '@herta/shared';

export const moderationManifest: PluginManifest = {
  id: 'moderation',
  name: 'Moderation',
  version: '1.0.0',
  description: '手動モデレーション操作とGuild単位のケース管理を提供します',
  author: { name: 'Herta' },
  category: 'moderation',
  permissions: [
    {
      id: 'moderation.manage',
      name: 'Moderation 管理',
      description: 'モデレーションケースの閲覧・更新とPlugin設定の管理',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      requireReason: {
        type: 'boolean',
        title: '理由を必須にする',
        default: true,
      },
      dmTarget: {
        type: 'boolean',
        title: '対象ユーザーへDMで通知する',
        description: 'DM送信に失敗してもモデレーション操作は継続します',
        default: true,
      },
      logChannelId: {
        type: ['string', 'null'],
        title: 'ログ送信先チャンネルID',
        description: '未指定の場合はDiscordへの追加ログ送信を行いません',
        pattern: '^\\d+$',
        default: null,
      },
      defaultResponseEphemeral: {
        type: 'boolean',
        title: 'コマンド応答を本人だけに表示する',
        default: true,
      },
      maxReasonLength: {
        type: 'integer',
        title: '理由の最大文字数',
        minimum: 1,
        maximum: 1000,
        default: 500,
      },
      caseRetentionDays: {
        type: 'integer',
        title: 'ケース保持日数',
        minimum: 30,
        maximum: 3650,
        default: 365,
      },
      allowedModeratorRoleIds: {
        type: 'array',
        title: '実行を許可するモデレーターロールID',
        description: '空配列の場合はDiscord権限だけで判定します',
        uniqueItems: true,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
      },
    },
    required: [
      'requireReason',
      'dmTarget',
      'logChannelId',
      'defaultResponseEphemeral',
      'maxReasonLength',
      'caseRetentionDays',
      'allowedModeratorRoleIds',
    ],
  },
  events: [],
  commands: [
    {
      name: 'mod',
      description: 'モデレーション操作とケース確認を行います',
      subcommands: [
        {
          name: 'warn',
          description: 'ユーザーへ警告を記録します',
          options: [
            {
              name: 'user',
              description: '対象ユーザー',
              type: 'user',
              required: true,
            },
            {
              name: 'reason',
              description: '警告理由',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'timeout',
          description: 'ユーザーを指定時間タイムアウトします',
          options: [
            {
              name: 'user',
              description: '対象ユーザー',
              type: 'user',
              required: true,
            },
            {
              name: 'duration',
              description: 'タイムアウト時間（分）',
              type: 'integer',
              required: true,
            },
            {
              name: 'reason',
              description: 'タイムアウト理由',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'kick',
          description: 'ユーザーをサーバーから退出させます',
          options: [
            {
              name: 'user',
              description: '対象ユーザー',
              type: 'user',
              required: true,
            },
            {
              name: 'reason',
              description: 'Kick理由',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'ban',
          description: 'ユーザーをサーバーからBANします',
          options: [
            {
              name: 'user',
              description: '対象ユーザー',
              type: 'user',
              required: true,
            },
            {
              name: 'reason',
              description: 'BAN理由',
              type: 'string',
              required: true,
            },
            {
              name: 'delete_message_seconds',
              description: '削除する過去メッセージの秒数（最大604800）',
              type: 'integer',
            },
          ],
        },
        {
          name: 'case',
          description: 'ケース番号を指定して詳細を確認します',
          options: [
            {
              name: 'number',
              description: 'ケース番号',
              type: 'integer',
              required: true,
            },
          ],
        },
        {
          name: 'history',
          description: 'ユーザーのモデレーション履歴を確認します',
          options: [
            {
              name: 'user',
              description: '対象ユーザー',
              type: 'user',
              required: true,
            },
            {
              name: 'page',
              description: 'ページ番号',
              type: 'integer',
            },
          ],
        },
      ],
    },
  ],
};
