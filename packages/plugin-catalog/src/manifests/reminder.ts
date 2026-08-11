import type { PluginManifest } from '@herta/shared';

export const reminderManifest: PluginManifest = {
  id: 'reminder',
  name: 'Reminder',
  version: '1.0.0',
  description: '指定した時間後にDMまたはチャンネルへリマインダーを配信します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'reminder.use',
      name: 'Reminder 利用',
      description: '自分のリマインダーを作成・確認・キャンセルします',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', title: 'Reminderを有効化する', default: true },
      ephemeralResponses: {
        type: 'boolean',
        title: 'コマンド応答を自分だけに表示する',
        default: true,
      },
      maxActivePerUser: {
        type: 'integer',
        title: 'ユーザーごとの最大未配信Reminder数',
        minimum: 1,
        maximum: 50,
        default: 20,
      },
    },
    required: ['enabled', 'ephemeralResponses', 'maxActivePerUser'],
  },
  events: [],
  commands: [
    {
      name: 'remind',
      description: 'リマインダーを作成・確認・キャンセルします',
      subcommands: [
        {
          name: 'set',
          description: '指定した分数後にリマインダーを作成します',
          options: [
            {
              name: 'minutes',
              description: '何分後に通知するか（1〜10080分）',
              type: 'integer',
              required: true,
              minValue: 1,
              maxValue: 10080,
            },
            {
              name: 'message',
              description: '通知する内容（1〜1000文字）',
              type: 'string',
              required: true,
            },
            {
              name: 'delivery',
              description: '通知先。省略時は現在のチャンネル',
              type: 'string',
              choices: [
                { name: '現在のチャンネル', value: 'channel' },
                { name: 'DM', value: 'dm' },
              ],
            },
          ],
        },
        {
          name: 'list',
          description: '自分の未配信リマインダー一覧を表示します',
        },
        {
          name: 'cancel',
          description: '自分のリマインダーをキャンセルします',
          options: [
            {
              name: 'id',
              description: '/remind listに表示されるReminder ID',
              type: 'string',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
