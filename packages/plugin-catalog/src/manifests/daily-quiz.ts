import type { PluginManifest } from '@herta/shared';
export const dailyQuizManifest: PluginManifest = {
  id: 'daily-quiz',
  name: 'Daily Quiz',
  version: '1.0.0',
  description:
    '日次参加 (Daily Quiz) の参加可否と結果カード表示を設定します。問題・採点・ポイントの正本は ivrm-web で、Bot 内の内部識別子 (customId・DB・契約パス) は daily-participation のまま据え置きます。発表メッセージの配信と回答処理の実行はデイリーボーナスが行います',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [],
  dependencies: [],
  commands: [],
  events: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      participationEnabled: {
        type: 'boolean',
        default: true,
        title: 'Daily Quiz への参加を有効にする',
      },
      resultCardEnabled: {
        type: 'boolean',
        default: true,
        title: '結果カード画像を有効にする',
      },
    },
    required: ['participationEnabled', 'resultCardEnabled'],
  },
};
