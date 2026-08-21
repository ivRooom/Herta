import { BIRTHDAY_CARD_ASSET_ID_PATTERN, type PluginManifest } from '@herta/shared';

export const birthdayRoleManifest: PluginManifest = {
  id: 'birthday-role',
  name: 'Birthday Role',
  version: '1.4.0',
  description: '誕生日の登録・確認と、誕生日当日のRole付与・お祝い通知・Birthday Cardを提供します',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [
    {
      id: 'birthday-role.manage',
      name: 'Birthday Role 管理',
      description: '誕生日Role・通知Channel・通知・Birthday Card設定を管理します',
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
          '{user}・{month}・{day}・{age}・{ageText}・{serverBirthdayNumber}を利用できます。生年未登録時の{age}/{ageText}は空文字です。',
        minLength: 1,
        maxLength: 1000,
        default: '🎂 {user} {ageText}お誕生日おめでとう！',
      },
      leapDayPolicy: {
        type: 'string',
        title: '2月29日の非うるう年の扱い',
        enum: ['february-28', 'march-1', 'skip'],
        default: 'february-28',
      },
      birthdayCardEnabled: {
        type: 'boolean',
        title: 'Birthday Cardを投稿する',
        description: 'お祝い投稿へPNGのBirthday Cardを添付します。',
        default: false,
      },
      birthdayCardBackgroundSource: {
        type: 'string',
        title: 'Birthday Card背景',
        description:
          '組み込みプリセット、画像ライブラリ、または既存Guild専用カスタム背景を利用します。',
        enum: ['preset', 'asset', 'custom'],
        default: 'preset',
      },
      birthdayCardAssetId: {
        type: ['string', 'null'],
        title: 'Birthday Card画像ライブラリAsset',
        description: 'Birthday Card Studioで登録したGuild専用画像のAsset IDです。',
        pattern: BIRTHDAY_CARD_ASSET_ID_PATTERN,
        default: null,
      },
      birthdayCardPreset: {
        type: 'string',
        title: 'Birthday Cardプリセット / テキスト配色',
        enum: ['herta-night-board', 'herta-lavender-tea', 'herta-lavender-gifts'],
        default: 'herta-lavender-tea',
      },
      birthdayCardShowName: {
        type: 'boolean',
        title: 'Birthday Cardに名前を表示',
        default: true,
      },
      birthdayCardShowAvatar: {
        type: 'boolean',
        title: 'Birthday CardにAvatarを表示',
        default: true,
      },
      birthdayCardShowBirthday: {
        type: 'boolean',
        title: 'Birthday Cardに誕生日を表示',
        default: true,
      },
      birthdayCardShowAge: {
        type: 'boolean',
        title: 'Birthday Cardに年齢を表示',
        description: '生年を登録したメンバーだけ年齢を表示します。',
        default: true,
      },
      birthdayCardAvatarX: positionSchema('Avatar X位置', 74),
      birthdayCardAvatarY: positionSchema('Avatar Y位置', 30),
      birthdayCardAvatarSize: {
        type: 'number',
        title: 'Avatarサイズ',
        description: 'カード横幅に対する直径の割合（%）です。',
        minimum: 6,
        maximum: 30,
        default: 16,
      },
      birthdayCardNameX: positionSchema('名前 X位置', 74),
      birthdayCardNameY: positionSchema('名前 Y位置', 54),
      birthdayCardNameSize: fontSizeSchema('名前 文字サイズ', 58, 20, 96),
      birthdayCardBirthdayX: positionSchema('誕生日 X位置', 74),
      birthdayCardBirthdayY: positionSchema('誕生日 Y位置', 65),
      birthdayCardBirthdaySize: fontSizeSchema('誕生日 文字サイズ', 38, 16, 72),
      birthdayCardAgeX: positionSchema('年齢 X位置', 74),
      birthdayCardAgeY: positionSchema('年齢 Y位置', 75),
      birthdayCardAgeSize: fontSizeSchema('年齢 文字サイズ', 36, 16, 72),
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
          description: '自分の誕生日を登録します。生年は任意です',
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
            {
              name: 'year',
              description: '生年（西暦・任意）',
              type: 'integer',
              required: false,
              minValue: 1900,
              maxValue: 2100,
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

function positionSchema(title: string, defaultValue: number) {
  return {
    type: 'number',
    title,
    description: 'カード左上を0、右下を100とした相対位置です。',
    minimum: 0,
    maximum: 100,
    default: defaultValue,
  };
}

function fontSizeSchema(title: string, defaultValue: number, minimum: number, maximum: number) {
  return {
    type: 'number',
    title,
    description: '1672×941の出力画像に対するpx相当の文字サイズです。',
    minimum,
    maximum,
    default: defaultValue,
  };
}
