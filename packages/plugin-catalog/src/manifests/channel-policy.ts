import type { PluginManifest } from '@herta/shared';

const discordIdArraySchema = {
  type: 'array' as const,
  uniqueItems: true,
  maxItems: 100,
  default: [],
  items: { type: 'string' as const, pattern: '^\\d+$' },
};

export const channelPolicyManifest: PluginManifest = {
  id: 'channel-policy',
  name: 'Channel Policy',
  version: '1.0.0',
  description: 'チャンネルごとにコマンド専用・メディア専用・画像専用などの投稿ルールを適用します',
  author: { name: 'Herta' },
  category: 'moderation',
  permissions: [
    {
      id: 'channel-policy.manage',
      name: 'Channel Policy 管理',
      description: 'チャンネル投稿ルールの設定と管理',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Channel Policyを有効化する',
        default: true,
      },
      warningCooldownSeconds: {
        type: 'integer',
        title: '同一ユーザーへの警告Cooldown（秒）',
        description: '0でCooldownを無効化します',
        minimum: 0,
        maximum: 3600,
        default: 15,
      },
      defaultWarningMessage: {
        type: 'string',
        title: '既定の違反警告メッセージ',
        description: '{user}、{channel}、{mode}を置換できます。メンション通知は発生しません',
        minLength: 1,
        maxLength: 1000,
        default:
          '{user} このチャンネルでは `{mode}` ルールが有効です。投稿内容を確認してください。',
      },
      rules: {
        type: 'array',
        title: 'チャンネル投稿ルール',
        description:
          '同じチャンネルIDが複数ある場合は後ろの設定を優先します。commands_onlyはSlash CommandなどInteractionだけを許可し、通常メッセージは拒否します。',
        maxItems: 200,
        default: [],
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: {
              type: 'boolean',
              title: 'ルールを有効化する',
              default: true,
            },
            channelId: {
              type: 'string',
              title: '対象チャンネルID',
              pattern: '^\\d+$',
            },
            mode: {
              type: 'string',
              title: '投稿ルール',
              enum: [
                'commands_only',
                'media_only',
                'images_only',
                'videos_only',
                'attachments_only',
                'text_only',
                'links_only',
                'no_links',
              ],
              default: 'commands_only',
            },
            action: {
              type: 'string',
              title: '違反時Action',
              description: 'log_onlyで監視のみ、deleteで削除、warn_deleteで削除後に警告します',
              enum: ['log_only', 'delete', 'warn_delete'],
              default: 'warn_delete',
            },
            allowCaption: {
              type: 'boolean',
              title: '添付ファイルと一緒の本文を許可する',
              description: 'media/images/videos/attachments専用ルールでのみ使用します',
              default: true,
            },
            allowStickers: {
              type: 'boolean',
              title: 'Stickerをメディアとして許可する',
              description: 'media_onlyでのみStickerを投稿として許可します',
              default: false,
            },
            includeThreads: {
              type: 'boolean',
              title: '配下のスレッドにも適用する',
              default: true,
            },
            exemptRoleIds: {
              ...discordIdArraySchema,
              title: '除外ロールID',
            },
            exemptUserIds: {
              ...discordIdArraySchema,
              title: '除外ユーザーID',
            },
            warningMessage: {
              type: ['string', 'null'],
              title: 'このルール専用の警告メッセージ',
              description: 'nullの場合は既定メッセージを使用します',
              minLength: 1,
              maxLength: 1000,
              default: null,
            },
          },
          required: [
            'enabled',
            'channelId',
            'mode',
            'action',
            'allowCaption',
            'allowStickers',
            'includeThreads',
            'exemptRoleIds',
            'exemptUserIds',
            'warningMessage',
          ],
        },
      },
    },
    required: ['enabled', 'warningCooldownSeconds', 'defaultWarningMessage', 'rules'],
  },
  events: ['messageCreate'],
  commands: [],
};
