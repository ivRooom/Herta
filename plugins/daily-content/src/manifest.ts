import type { PluginManifest } from '@herta/shared';

export const dailyContentManifest: PluginManifest = {
  id: 'daily-content',
  name: 'Daily Content',
  version: '1.0.0',
  description: 'Guildごとの定時コンテンツ配信、プレビュー、履歴管理を提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'daily-content.manage',
      name: 'Daily Content 管理',
      description: '定時コンテンツの設定、プレビュー、手動配信、履歴確認',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      defaultTimezone: {
        type: 'string',
        title: '既定timezone',
        description: 'IANA timezone形式で指定します',
        default: 'Asia/Tokyo',
        minLength: 1,
        maxLength: 100,
      },
      maxSchedules: {
        type: 'integer',
        title: '最大スケジュール数',
        minimum: 1,
        maximum: 500,
        default: 100,
      },
      maxContentLength: {
        type: 'integer',
        title: '本文の最大文字数',
        minimum: 1,
        maximum: 2000,
        default: 2000,
      },
      allowUserMentions: {
        type: 'boolean',
        title: 'ユーザーメンションを許可する',
        description: '@everyone、@here、ロールメンションは常に拒否します',
        default: false,
      },
      staleAfterMinutes: {
        type: 'integer',
        title: 'stale判定時間（分）',
        minimum: 2,
        maximum: 1440,
        default: 10,
      },
      maxAttempts: {
        type: 'integer',
        title: '最大配信試行回数',
        minimum: 1,
        maximum: 10,
        default: 5,
      },
    },
    required: [
      'defaultTimezone',
      'maxSchedules',
      'maxContentLength',
      'allowUserMentions',
      'staleAfterMinutes',
      'maxAttempts',
    ],
  },
  events: [],
  commands: [
    {
      name: 'daily',
      description: '定時コンテンツを管理します',
      subcommands: [
        {
          name: 'preview',
          description: '登録済みコンテンツを本人だけにプレビューします',
          options: [
            {
              name: 'schedule_id',
              description: 'スケジュールID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'publish',
          description: '登録済みコンテンツを手動配信キューへ追加します',
          options: [
            {
              name: 'schedule_id',
              description: 'スケジュールID',
              type: 'string',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
