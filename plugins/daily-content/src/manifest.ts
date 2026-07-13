import type { PluginManifest } from '@herta/shared';

export const dailyContentManifest: PluginManifest = {
  id: 'daily-content',
  name: 'Daily Content',
  version: '1.0.0',
  description: '毎日の定時メッセージ送信',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'daily-content.manage',
      name: 'Daily Content 管理',
      description: '定時メッセージの設定',
    },
  ],
  dependencies: [],
  configSchema: {},
  events: [],
  commands: [{ name: 'daily', description: '定時メッセージの管理' }],
};
