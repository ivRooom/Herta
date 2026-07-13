import type { PluginManifest } from '@herta/shared';

export const teamSplitManifest: PluginManifest = {
  id: 'team-split',
  name: 'Team Split',
  version: '1.0.0',
  description: 'ランダムチーム分け',
  author: { name: 'Herta' },
  category: 'game',
  permissions: [
    {
      id: 'team-split.manage',
      name: 'Team Split 管理',
      description: 'チーム分け設定の管理',
    },
  ],
  dependencies: [],
  configSchema: {},
  events: [],
  commands: [{ name: 'team', description: 'チーム分け' }],
};
