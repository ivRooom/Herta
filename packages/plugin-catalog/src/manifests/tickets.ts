import type { PluginManifest } from '@herta/shared';

export const ticketsManifest: PluginManifest = {
  id: 'tickets',
  name: 'Tickets',
  version: '1.0.0',
  description:
    'Discordから問い合わせチケットを起票し、非公開スレッドで運営とやり取りできるようにします',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'tickets.manage',
      name: 'Tickets 管理',
      description: 'チケットパネルの設置とスレッド内の対応操作を行います',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Ticketsを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      panelChannelId: {
        type: ['string', 'null'],
        title: '案内パネルを置くチャンネル',
        default: null,
        'x-herta-ui': {
          section: '受付',
          widget: 'discord-channel',
          channelTypes: ['GuildText', 'GuildAnnouncement'],
          placeholder: '問い合わせ案内を表示するチャンネルを選択',
          help: '起票ごとの非公開スレッドはこのチャンネル配下に作成します。/ticket panel の実行チャンネルを既定にすることもできます。',
        },
      },
      staffRoleIds: {
        type: 'array',
        title: '対応を許可するStaff Role',
        uniqueItems: true,
        maxItems: 10,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
        'x-herta-ui': {
          section: 'Staff設定',
          widget: 'discord-role',
          multiple: true,
          placeholder: 'チケット対応を行うRoleを選択',
          help: 'パネル設置とスレッド内の対応ボタンの操作に使います。空の場合はManage Server権限を持つメンバーだけが操作できます。',
        },
      },
      notifyChannelId: {
        type: ['string', 'null'],
        title: '新規起票の通知先チャンネル',
        default: null,
        'x-herta-ui': {
          section: '通知',
          widget: 'discord-channel',
          channelTypes: ['GuildText', 'GuildAnnouncement'],
          placeholder: '新規チケットを運営へ知らせるチャンネルを選択',
          help: '未設定の場合は通知しません。',
        },
      },
      notifyStaffOnCreate: {
        type: 'boolean',
        title: '新規起票時にStaff Roleへメンションする',
        default: true,
        'x-herta-ui': { section: '通知' },
      },
      categoryDiscordEnabled: {
        type: 'boolean',
        title: 'カテゴリ「Discord全般」を有効化する',
        default: true,
        'x-herta-ui': { section: 'カテゴリ' },
      },
      categoryGameServerEnabled: {
        type: 'boolean',
        title: 'カテゴリ「ゲーム・サーバー」を有効化する',
        default: true,
        'x-herta-ui': { section: 'カテゴリ' },
      },
      categoryPrivacyEnabled: {
        type: 'boolean',
        title: 'カテゴリ「プライバシー・データ削除」を有効化する',
        default: true,
        'x-herta-ui': { section: 'カテゴリ' },
      },
      categoryGeneralEnabled: {
        type: 'boolean',
        title: 'カテゴリ「その他」を有効化する',
        default: true,
        'x-herta-ui': { section: 'カテゴリ' },
      },
    },
    required: [
      'enabled',
      'panelChannelId',
      'staffRoleIds',
      'notifyChannelId',
      'notifyStaffOnCreate',
      'categoryDiscordEnabled',
      'categoryGameServerEnabled',
      'categoryPrivacyEnabled',
      'categoryGeneralEnabled',
    ],
  },
  events: ['interactionCreate', 'messageCreate'],
  commands: [
    {
      name: 'ticket',
      description: '問い合わせチケットを起票・管理します',
      subcommands: [
        {
          name: 'create',
          description: '新しいチケットを作成します',
          options: [
            {
              name: 'category',
              description: '問い合わせの分類',
              type: 'string',
              required: true,
              choices: [
                { name: 'Discord全般', value: 'discord' },
                { name: 'ゲーム・サーバー', value: 'game_server' },
                { name: 'プライバシー・データ削除', value: 'privacy' },
                { name: 'その他', value: 'general' },
              ],
            },
          ],
        },
        {
          name: 'panel',
          description: '問い合わせ案内パネルを設置します（Staff向け）',
        },
      ],
    },
  ],
};
