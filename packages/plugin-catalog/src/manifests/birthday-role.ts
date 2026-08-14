import type { PluginManifest } from '@herta/shared';

export const birthdayRoleManifest: PluginManifest = {
  id: 'birthday-role',
  name: 'Birthday Role',
  version: '1.1.0',
  description: '誕生日の登録・確認と、誕生日当日のRole付与・お祝い通知を提供します',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [
    {
      id: 'birthday-role.manage',
      name: 'Birthday Role 管理',
      description: '誕生日Role・通知Channel・通知設定を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Birthday Roleを有効化する',
        default: true,
      },
      ephemeralResponses: {
        type: 'boolean',
        title: '誕生日の登録・確認結果を本人だけに表示する',
        default: true,
      },
      allowSelfRegistration: {
        type: 'boolean',
        title: 'メンバー本人の誕生日登録を許可する',
        default: true,
        description:
          'OFFにすると /birthday set を停止し、Studio管理者からのみ登録・更新できます。本人の /birthday remove は引き続き利用できます。',
      },
      assignRole: {
        type: 'boolean',
        title: '誕生日当日にRoleを付与する',
        default: true,
      },
      birthdayRoleId: {
        type: ['string', 'null'],
        title: '誕生日Role',
        description: '誕生日当日に付与し、翌日に解除するRoleです',
        pattern: '^\\d+$',
        default: null,
        'x-herta-ui': {
          widget: 'discord-role',
          editableOnly: true,
          placeholder: '誕生日Roleを検索',
        },
      },
      sendAnnouncement: {
        type: 'boolean',
        title: '誕生日のお祝いメッセージを投稿する',
        default: true,
      },
      announcementChannelId: {
        type: ['string', 'null'],
        title: 'お祝い投稿Channel',
        description: '誕生日のお祝いメッセージを投稿するChannelです',
        pattern: '^\\d+$',
        default: null,
        'x-herta-ui': {
          widget: 'discord-channel',
          placeholder: 'お祝い投稿Channelを検索',
        },
      },
      announcementMessage: {
        type: 'string',
        title: 'お祝いメッセージ',
        description:
          '{user}を対象ユーザーのメンション、{month}を誕生月、{day}を誕生日へ置換します',
        minLength: 1,
        maxLength: 1000,
        default: '🎂 {user} お誕生日おめでとう！',
      },
      leapDayPolicy: {
        type: 'string',
        title: '2月29日の非うるう年の扱い',
        enum: ['february-28', 'march-1', 'skip'],
        default: 'february-28',
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'allowSelfRegistration',
      'assignRole',
      'birthdayRoleId',
      'sendAnnouncement',
      'announcementChannelId',
      'announcementMessage',
      'leapDayPolicy',
    ],
  },
  events: [],
  commands: [
    {
      name: 'birthday',
      description: '誕生日を登録・確認します',
      subcommands: [
        {
          name: 'set',
          description: '自分の誕生日を月日だけ登録します',
          options: [
            {
              name: 'month',
              description: '誕生月（1〜12）',
              type: 'integer',
              required: true,
              minValue: 1,
              maxValue: 12,
            },
            {
              name: 'day',
              description: '誕生日（1〜31）',
              type: 'integer',
              required: true,
              minValue: 1,
              maxValue: 31,
            },
          ],
        },
        {
          name: 'remove',
          description: '自分の誕生日登録を削除します',
        },
        {
          name: 'me',
          description: '自分の登録済み誕生日を確認します',
        },
        {
          name: 'next',
          description: '次に誕生日を迎えるメンバーを表示します',
        },
        {
          name: 'list',
          description: '登録されている誕生日を月日順に表示します',
        },
      ],
    },
  ],
};
