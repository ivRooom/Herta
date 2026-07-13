import type { PluginManifest } from '@herta/shared';

export const autoResponseManifest: PluginManifest = {
  id: 'auto-response',
  name: 'Auto Response',
  version: '1.0.0',
  description: 'キーワード・正規表現に基づく自動応答',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'auto-response.manage',
      name: 'Auto Response 管理',
      description: '自動応答ルールの追加・編集・削除',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    properties: {
      maxResponses: { type: 'number', default: 50 },
      cooldownMs: { type: 'number', default: 3000 },
    },
  },
  events: ['messageCreate'],
  commands: [{ name: 'autoresponse', description: '自動応答の管理' }],
};
