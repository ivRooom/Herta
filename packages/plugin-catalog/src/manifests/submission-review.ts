import type { PluginManifest } from '@herta/shared';

export const submissionReviewManifest: PluginManifest = {
  id: 'submission-review',
  name: 'Submission Review',
  version: '1.0.0',
  description:
    'メンバー申請（デイリー問題・今日は何の日）をDiscordへ通知し、ボタンとモーダルで審査できます',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'submission-review.review',
      name: 'メンバー申請の審査',
      description:
        'デイリー問題申請と今日は何の日申請の承認・差し戻し・ポイント指定を行います（専用ロール必須）',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Submission Reviewを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      opsChannelId: {
        type: 'string',
        title: '申請通知先チャンネルID',
        default: '',
        'x-herta-ui': {
          section: '申請審査',
          help: '新規申請の通知と24時間ごとのリマインドを投稿するテキストチャンネルのIDを指定します。未設定の場合は通知しません。',
        },
      },
      approverRoleIds: {
        type: 'array',
        title: '申請審査を許可するロールID（専用ロール）',
        items: { type: 'string' },
        // ランタイムは先頭20件までしか保持しないため、保存時に同じ上限で弾く
        maxItems: 20,
        default: [],
        'x-herta-ui': {
          section: '申請審査',
          help: 'Discord上の承認・差し戻し・状況確認を実行できる専用ロールのIDを指定します。未設定の場合は誰も実行できません。',
        },
      },
    },
    required: ['enabled', 'opsChannelId', 'approverRoleIds'],
  },
  events: [],
  commands: [],
};
