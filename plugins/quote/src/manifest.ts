import type { PluginManifest } from '@herta/shared';

export const quoteManifest: PluginManifest = {
  id: 'quote',
  name: 'Quote',
  version: '1.0.0',
  description: 'Guildごとに名言を登録・参照・管理します',
  author: { name: 'Herta' },
  category: 'fun',
  permissions: [
    {
      id: 'quote.manage',
      name: 'Quote 管理',
      description: '名言の追加・編集・削除',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowMemberRegistration: {
        type: 'boolean',
        title: '一般メンバーの登録を許可',
        description:
          '無効の場合、サーバー管理またはメッセージ管理権限を持つメンバーだけが登録できます',
        default: true,
      },
      allowMemberDeletion: {
        type: 'boolean',
        title: '一般メンバーの削除を許可',
        description:
          '無効の場合、サーバー管理またはメッセージ管理権限を持つメンバーだけが削除できます',
        default: false,
      },
      maxQuoteLength: {
        type: 'integer',
        title: '名言本文の最大文字数',
        minimum: 1,
        maximum: 1800,
        default: 1000,
      },
      randomResponseEphemeral: {
        type: 'boolean',
        title: 'ランダム表示を本人だけに表示',
        default: false,
      },
      allowedChannelIds: {
        type: 'array',
        title: '利用可能チャンネルID',
        description: '空配列の場合はすべてのチャンネルで利用できます',
        uniqueItems: true,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
      },
    },
    required: [
      'allowMemberRegistration',
      'allowMemberDeletion',
      'maxQuoteLength',
      'randomResponseEphemeral',
      'allowedChannelIds',
    ],
  },
  events: [],
  commands: [
    {
      name: 'quote',
      description: '名言を登録・表示・管理します',
      subcommands: [
        {
          name: 'random',
          description: '名言をランダムに表示します',
          options: [
            {
              name: 'tag',
              description: '絞り込むタグ',
              type: 'string',
            },
          ],
        },
        {
          name: 'show',
          description: '番号を指定して名言を表示します',
          options: [
            {
              name: 'number',
              description: 'Quote番号',
              type: 'integer',
              required: true,
            },
          ],
        },
        {
          name: 'add',
          description: '名言を登録します',
          options: [
            {
              name: 'text',
              description: '名言本文',
              type: 'string',
              required: true,
            },
            {
              name: 'author',
              description: '作者・発言者',
              type: 'string',
            },
            {
              name: 'tags',
              description: 'カンマ区切りのタグ',
              type: 'string',
            },
          ],
        },
        {
          name: 'delete',
          description: '名言を削除します',
          options: [
            {
              name: 'number',
              description: '削除するQuote番号',
              type: 'integer',
              required: true,
            },
          ],
        },
        {
          name: 'list',
          description: '名言の一覧を表示します',
          options: [
            {
              name: 'page',
              description: 'ページ番号',
              type: 'integer',
            },
            {
              name: 'tag',
              description: '絞り込むタグ',
              type: 'string',
            },
          ],
        },
      ],
    },
  ],
};
