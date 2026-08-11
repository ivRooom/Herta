import type { PluginManifest } from '@herta/shared';

export const afkManifest: PluginManifest = {
  id: 'afk',
  name: 'AFK',
  version: '1.0.0',
  description: '離席状態の設定・メンション通知・発言時の自動解除を提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'afk.manage',
      name: 'AFK 管理',
      description: 'AFKの動作・通知・一覧表示設定を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'AFKを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralResponses: {
        type: 'boolean',
        title: 'AFKコマンドの応答を自分だけに表示する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      defaultReason: {
        type: 'string',
        title: '理由未指定時の表示',
        minLength: 1,
        maxLength: 200,
        default: '離席中',
        'x-herta-ui': { section: '理由設定' },
      },
      maxReasonLength: {
        type: 'integer',
        title: 'AFK理由の最大文字数',
        minimum: 20,
        maximum: 200,
        default: 200,
        'x-herta-ui': { section: '理由設定' },
      },
      autoClearOnMessage: {
        type: 'boolean',
        title: '本人が発言したらAFKを自動解除する',
        default: true,
        'x-herta-ui': {
          section: '自動解除',
          help: 'Message Content Intentが有効な環境で動作します。',
        },
      },
      notifyOnMention: {
        type: 'boolean',
        title: 'AFK中のメンバーがメンションされたら通知する',
        default: true,
        'x-herta-ui': {
          section: 'メンション通知',
          help: '既存のDISCORD_ENABLE_MESSAGE_CONTENT_INTENT設定を利用します。',
        },
      },
      notificationCooldownSeconds: {
        type: 'integer',
        title: '同じAFKメンバーへの通知Cooldown（秒）',
        minimum: 0,
        maximum: 300,
        default: 15,
        'x-herta-ui': { section: 'メンション通知' },
      },
      maxMentionNotices: {
        type: 'integer',
        title: '1メッセージで通知するAFK人数',
        minimum: 1,
        maximum: 10,
        default: 5,
        'x-herta-ui': { section: 'メンション通知' },
      },
      maxListEntries: {
        type: 'integer',
        title: '/afk list の最大表示人数',
        minimum: 5,
        maximum: 50,
        default: 25,
        'x-herta-ui': { section: '一覧表示' },
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'defaultReason',
      'maxReasonLength',
      'autoClearOnMessage',
      'notifyOnMention',
      'notificationCooldownSeconds',
      'maxMentionNotices',
      'maxListEntries',
    ],
  },
  events: ['messageCreate'],
  commands: [
    {
      name: 'afk',
      description: 'AFK状態を設定・解除・確認します',
      subcommands: [
        {
          name: 'set',
          description: 'AFK状態を設定します',
          options: [
            {
              name: 'reason',
              description: 'AFK理由（任意）',
              type: 'string',
            },
          ],
        },
        {
          name: 'clear',
          description: '自分のAFK状態を解除します',
        },
        {
          name: 'list',
          description: '現在AFK中のメンバーを表示します',
        },
      ],
    },
  ],
};
