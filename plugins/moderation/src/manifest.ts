import type { PluginManifest } from '@herta/shared';
import { AUTOMATIC_CASE_RULE_SELECTOR_PATTERN } from './auto-case.js';
import { AUTOMATIC_ENFORCEMENT_RULE_SELECTOR_PATTERN } from './enforcement-config.js';

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
  version: '2.4.0',
  description:
    '手動モデレーション、自動検知、緊急Alert、明示的に有効化する自動対応ポリシーをGuild単位で提供します',
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
        description:
          'observeで自動検知エンジンを有効化します。Discord上の自動対応は別の自動対応スイッチがONの場合のみ実行します',
        enum: ['disabled', 'observe'],
        default: 'disabled',
      },
      autoEnforcementEnabled: {
        type: 'boolean',
        title: '検知後の自動対応を有効化する',
        description:
          'OFFではすべて検知・Alertのみです。ONでも各ルールのActionがobserveなら処罰しません',
        default: false,
      },
      autoEnforcementPolicies: {
        type: 'array',
        title: 'ルール別の自動対応ポリシー',
        description: '各検知ルールの危険度とActionを設定します',
        maxItems: 200,
        default: [],
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            selector: {
              type: 'string',
              pattern: AUTOMATIC_ENFORCEMENT_RULE_SELECTOR_PATTERN,
            },
            action: {
              type: 'string',
              enum: [
                'observe',
                'warn',
                'delete',
                'warn_delete',
                'timeout',
                'role',
                'blacklist',
                'kick',
                'ban',
              ],
            },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            timeoutMinutes: {
              type: 'integer',
              minimum: 1,
              maximum: 40320,
              default: 10,
            },
            roleId: {
              type: ['string', 'null'],
              pattern: '^\\d+$',
              default: null,
            },
            warningMessage: {
              type: ['string', 'null'],
              maxLength: 500,
              default: null,
            },
            banDeleteMessageSeconds: {
              type: 'integer',
              minimum: 0,
              maximum: 604800,
              default: 0,
            },
          },
          required: [
            'selector',
            'action',
            'severity',
            'timeoutMinutes',
            'roleId',
            'warningMessage',
            'banDeleteMessageSeconds',
          ],
        },
      },
      autoAlertChannelId: {
        type: ['string', 'null'],
        title: '緊急Alert送信先チャンネルID',
        description: '危険度が閾値以上の検知と自動対応失敗を通知します',
        pattern: '^\\d+$',
        default: null,
      },
      autoAlertMinimumSeverity: {
        type: 'string',
        title: '緊急Alertの最低危険度',
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'high',
      },
      autoAlertMentionRoleIds: {
        ...discordIdArraySchema,
        title: '緊急AlertでメンションするロールID',
        description: '@everyone/@hereは使用せず、ここで指定したRoleだけメンションします',
      },
      autoAlertIncludeExcerpt: {
        type: 'boolean',
        title: 'Alertへ本文プレビューを含める',
        description: 'プライバシー保護のためデフォルトOFFです',
        default: false,
      },
      autoAlertCooldownSeconds: {
        type: 'integer',
        title: '同一ユーザー・ルールのAlert Cooldown（秒）',
        minimum: 0,
        maximum: 3600,
        default: 60,
      },
      autoCaseOnConfirmedEnabled: {
        type: 'boolean',
        title: '正検知確定時にCaseを自動作成する',
        description:
          '対象ルールに一致した正検知だけを非処罰のflag Caseとして記録します。すでに自動対応Caseがある検知では重複作成しません',
        default: false,
      },
      autoCaseOnConfirmedRules: {
        type: 'array',
        title: '正検知時に自動Case化するルール',
        description:
          'word系は word_contains:0 のようにルール番号を付け、組み込み検知は invite_link のように指定します',
        uniqueItems: true,
        maxItems: 100,
        default: [],
        items: { type: 'string', pattern: AUTOMATIC_CASE_RULE_SELECTOR_PATTERN },
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
  events: ['messageCreate', 'guildMemberAdd'],
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
          name: 'untimeout',
          description: 'ユーザーのタイムアウトを解除しCaseを更新します',
          options: [
            {
              name: 'user',
              description: '対象ユーザー',
              type: 'user',
              required: true,
            },
            {
              name: 'reason',
              description: '解除理由',
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
          name: 'case-status',
          description: 'ケースの状態を更新します',
          options: [
            {
              name: 'number',
              description: 'ケース番号',
              type: 'integer',
              required: true,
            },
            {
              name: 'status',
              description: '更新後の状態',
              type: 'string',
              required: true,
              choices: [
                { name: '有効', value: 'active' },
                { name: '完了', value: 'completed' },
                { name: '解除済み', value: 'revoked' },
              ],
            },
            {
              name: 'reason',
              description: 'Case理由も同時に更新する場合に入力',
              type: 'string',
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
