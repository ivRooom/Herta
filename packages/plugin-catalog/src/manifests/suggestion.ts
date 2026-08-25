import type { PluginManifest } from '@herta/shared';

export const suggestionManifest: PluginManifest = {
  id: 'suggestion',
  name: 'Suggestion',
  version: '1.0.0',
  description: '要望投稿・賛否投票・Staffによる状態管理を提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'suggestion.manage',
      name: 'Suggestion 管理',
      description: '要望の状態変更と運用設定を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Suggestionを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      suggestionChannelId: {
        type: ['string', 'null'],
        title: '要望の投稿先チャンネル',
        default: null,
        'x-herta-ui': {
          section: '投稿先',
          widget: 'discord-channel',
          channelTypes: ['GuildText', 'GuildAnnouncement'],
          placeholder: '要望を公開するチャンネルを選択',
          help: '未設定の場合は /suggest create を実行したチャンネルへ投稿します。',
        },
      },
      anonymousSubmissions: {
        type: 'boolean',
        title: '投稿者名を公開しない',
        default: false,
        'x-herta-ui': {
          section: '表示設定',
          help: 'DBには投稿者IDを保持しますが、公開メッセージには表示しません。',
        },
      },
      enableVoting: {
        type: 'boolean',
        title: '👍 / 👎 投票を有効化する',
        default: true,
        'x-herta-ui': { section: '投票設定' },
      },
      maxOpenPerUser: {
        type: 'integer',
        title: 'ユーザーごとの未処理Suggestion上限',
        minimum: 1,
        maximum: 20,
        default: 5,
        'x-herta-ui': {
          section: '制限',
          help: 'pending / reviewing のSuggestionだけを上限対象にします。',
        },
      },
      staffRoleIds: {
        type: 'array',
        title: '状態変更を許可するStaff Role',
        uniqueItems: true,
        maxItems: 10,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
        'x-herta-ui': {
          section: 'Staff設定',
          widget: 'discord-role',
          multiple: true,
          placeholder: 'Suggestionを管理するRoleを選択',
          help: '空の場合はManage Server権限を持つメンバーだけが状態変更できます。',
        },
      },
      notifyAuthorOnStatusChange: {
        type: 'boolean',
        title: '状態変更時に投稿者へ通知する',
        default: true,
        'x-herta-ui': { section: '通知' },
      },
    },
    required: [
      'enabled',
      'suggestionChannelId',
      'anonymousSubmissions',
      'enableVoting',
      'maxOpenPerUser',
      'staffRoleIds',
      'notifyAuthorOnStatusChange',
    ],
  },
  events: ['interactionCreate'],
  commands: [
    {
      name: 'suggest',
      description: '要望を投稿・確認・管理します',
      subcommands: [
        {
          name: 'create',
          description: '新しい要望を投稿します',
          options: [
            {
              name: 'content',
              description: '要望内容（1〜1000文字）',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'list',
          description: '自分が投稿した最近の要望を表示します',
        },
        {
          name: 'info',
          description: 'Suggestionの詳細を表示します（投稿者本人 / Staff）',
          options: [
            {
              name: 'id',
              description: 'Suggestion ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'withdraw',
          description: '自分の未処理Suggestionを取り下げます',
          options: [
            {
              name: 'id',
              description: 'Suggestion ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'queue',
          description: 'Staff向けSuggestion Queueを表示します',
          options: [
            {
              name: 'status',
              description: '表示する状態。省略時は未処理（pending / reviewing）',
              type: 'string',
              choices: [
                { name: '未処理', value: 'open' },
                { name: '未確認', value: 'pending' },
                { name: '検討中', value: 'reviewing' },
                { name: '採用', value: 'accepted' },
                { name: '却下', value: 'rejected' },
                { name: '完了', value: 'completed' },
                { name: '取下げ', value: 'withdrawn' },
                { name: 'すべて', value: 'all' },
              ],
            },
            {
              name: 'page',
              description: 'ページ番号（1〜100）',
              type: 'integer',
              minValue: 1,
              maxValue: 100,
            },
          ],
        },
        {
          name: 'status',
          description: 'Suggestionの状態を変更します（Staff向け）',
          options: [
            {
              name: 'id',
              description: 'Suggestion ID',
              type: 'string',
              required: true,
            },
            {
              name: 'status',
              description: '新しい状態',
              type: 'string',
              required: true,
              choices: [
                { name: '検討中', value: 'reviewing' },
                { name: '採用', value: 'accepted' },
                { name: '却下', value: 'rejected' },
                { name: '完了', value: 'completed' },
              ],
            },
            {
              name: 'note',
              description: 'Staffコメント（任意・300文字以内）',
              type: 'string',
            },
          ],
        },
      ],
    },
  ],
};
