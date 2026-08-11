import type { PluginManifest } from '@herta/shared';

export const onboardingManifest: PluginManifest = {
  id: 'onboarding',
  name: 'Onboarding',
  version: '1.0.0',
  description: '参加・退出メッセージと新規メンバーへのAuto Roleを提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'onboarding.manage',
      name: 'Onboarding 管理',
      description: 'Welcome/Goodbye Channel・メッセージ・Auto Roleを管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', title: 'Onboardingを有効化する', default: true },
      welcomeEnabled: { type: 'boolean', title: '参加メッセージを投稿する', default: true },
      welcomeChannelId: {
        type: ['string', 'null'],
        title: 'Welcome Channel',
        pattern: '^\\d+$',
        default: null,
        'x-herta-ui': {
          widget: 'discord-channel',
          placeholder: 'Welcome Channelを検索',
        },
      },
      welcomeMessage: {
        type: 'string',
        title: '参加メッセージ',
        description: '{user} / {server} / {memberCount} を利用できます',
        minLength: 1,
        maxLength: 1500,
        default: '👋 {user}、{server}へようこそ！現在のメンバー数は{memberCount}人です。',
      },
      goodbyeEnabled: { type: 'boolean', title: '退出メッセージを投稿する', default: true },
      goodbyeChannelId: {
        type: ['string', 'null'],
        title: 'Goodbye Channel',
        pattern: '^\\d+$',
        default: null,
        'x-herta-ui': {
          widget: 'discord-channel',
          placeholder: 'Goodbye Channelを検索',
        },
      },
      goodbyeMessage: {
        type: 'string',
        title: '退出メッセージ',
        description: '{user} / {username} / {server} / {memberCount} を利用できます',
        minLength: 1,
        maxLength: 1500,
        default:
          '👋 {username}さんが{server}から退出しました。現在のメンバー数は{memberCount}人です。',
      },
      autoRoleEnabled: {
        type: 'boolean',
        title: '新規メンバーへRoleを自動付与する',
        default: false,
      },
      autoRoleIds: {
        type: 'array',
        title: 'Auto Role',
        uniqueItems: true,
        maxItems: 10,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
        'x-herta-ui': {
          widget: 'discord-role',
          multiple: true,
          editableOnly: true,
          placeholder: '自動付与するRoleを検索',
        },
      },
      mentionNewMember: {
        type: 'boolean',
        title: '参加メッセージで新規メンバーをメンションする',
        default: true,
      },
    },
    required: [
      'enabled',
      'welcomeEnabled',
      'welcomeChannelId',
      'welcomeMessage',
      'goodbyeEnabled',
      'goodbyeChannelId',
      'goodbyeMessage',
      'autoRoleEnabled',
      'autoRoleIds',
      'mentionNewMember',
    ],
  },
  events: ['guildMemberAdd', 'guildMemberRemove'],
  commands: [
    {
      name: 'welcome',
      description: 'Onboardingメッセージを確認・テストします',
      subcommands: [
        {
          name: 'preview',
          description: '現在のWelcome/Goodbyeメッセージを自分だけに表示します',
        },
        {
          name: 'test',
          description: '現在のチャンネルへWelcomeメッセージをテスト投稿します',
        },
      ],
    },
  ],
};
