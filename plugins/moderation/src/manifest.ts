import type { PluginManifest } from '@herta/shared';

export const moderationManifest: PluginManifest = {
  id: 'moderation',
  name: 'Moderation',
  version: '1.0.0',
  description: 'NGワードフィルター、スパム検知、招待リンク管理',
  author: { name: 'Herta' },
  category: 'moderation',
  permissions: [
    {
      id: 'moderation.manage',
      name: 'Moderation 管理',
      description: 'モデレーション設定の管理',
    },
  ],
  dependencies: [],
  configSchema: {},
  events: ['messageCreate', 'messageUpdate'],
  commands: [{ name: 'mod', description: 'モデレーション管理' }],
};
