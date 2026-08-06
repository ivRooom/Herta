import type { PluginManifest } from '@herta/shared';

const discordIdArraySchema = {
  type: 'array' as const,
  uniqueItems: true,
  default: [],
  items: { type: 'string' as const, pattern: '^\\d+$' },
};

const automaticWordArraySchema = {
  type: 'array' as const,
  uniqueItems: true,
  maxItems: 100,
  default: [],
  items: { type: 'string' as const, minLength: 1, maxLength: 120 },
};

export const moderationManifest: PluginManifest = {
  id: 'moderation',
  name: 'Moderation',
  version: '2.1.0',
  description: '手動モデレーションとobserve-only自動検知をGuild単位で提供します',
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
        ...discordIdArraySchema,
        title: '実行を許可するモデレーターロールID',
        description: '空配列の場合はDiscord権限だけで判定します',
      },
      automaticMode: {
        type: 'string',
        title: '自動検知モード',
        description: 'observeは検知ログだけを記録し、メッセージ削除や処罰を行いません',
        enum: ['disabled', 'observe'],
        default: 'disabled',
      },
      autoExactWords: {
        ...automaticWordArraySchema,
        title: '完全一致ワード',
        description: 'NFKC正規化と小文字化後の本文全体が一致した場合に検知します',
      },
      autoContainsWords: {
        ...automaticWordArraySchema,
        title: '部分一致ワード',
        description: 'NFKC正規化と小文字化後の本文に含まれる場合に検知します',
      },
      autoRegexPatterns: {
        type: 'array',
        title: '制限付き正規表現',
        description:
          '最大20件・各120文字。後方参照、lookaround、ネスト量指定子などReDoSリスクの高い式は無視します',
        uniqueItems: true,
        maxItems: 20,
        default: [],
        items: { type: 'string', minLength: 1, maxLength: 120 },
      },
      autoInviteFilterEnabled: {
        type: 'boolean',
        title: 'Discord招待リンクを検知する',
        default: false,
      },
      autoInviteAllowlist: {
        type: 'array',
        title: '許可するDiscord招待コード',
        description: 'discord.gg/以降のコードだけを入力します',
        uniqueItems: true,
        maxItems: 100,
        default: [],
        items: { type: 'string', pattern: '^[A-Za-z0-9-]{2,64}$' },
      },
      autoMentionLimit: {
        type: 'integer',
        title: '大量メンション検知数',
        description: '0で無効。User・Role・everyoneの合計が指定数以上で検知します',
        minimum: 0,
        maximum: 100,
        default: 0,
      },
      autoBurstMessageLimit: {
        type: 'integer',
        title: '連投検知メッセージ数',
        description: '0で無効。指定時間内の同一ユーザー投稿数を監視します',
        minimum: 0,
        maximum: 50,
        default: 0,
      },
      autoBurstWindowSeconds: {
        type: 'integer',
        title: '連投検知時間（秒）',
        minimum: 1,
        maximum: 300,
        default: 10,
      },
      autoDuplicateMessageLimit: {
        type: 'integer',
        title: '重複投稿検知数',
        description: '0で無効。正規化後の同一本文が指定数以上投稿された場合に検知します',
        minimum: 0,
        maximum: 20,
        default: 0,
      },
      autoDuplicateWindowSeconds: {
        type: 'integer',
        title: '重複投稿検知時間（秒）',
        minimum: 1,
        maximum: 600,
        default: 30,
      },
      autoMaxMessageLength: {
        type: 'integer',
        title: '自動検知する本文の最大文字数',
        minimum: 100,
        maximum: 4000,
        default: 2000,
      },
      autoExemptChannelIds: {
        ...discordIdArraySchema,
        title: '自動検知から除外するチャンネルID',
      },
      autoExemptRoleIds: {
        ...discordIdArraySchema,
        title: '自動検知から除外するロールID',
      },
      autoExemptUserIds: {
        ...discordIdArraySchema,
        title: '自動検知から除外するユーザーID',
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
  events: ['messageCreate'],
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
