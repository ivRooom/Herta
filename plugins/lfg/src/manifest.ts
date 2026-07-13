import type { PluginManifest } from '@herta/shared';

export const lfgManifest: PluginManifest = {
  id: 'lfg',
  name: 'LFG',
  version: '1.0.0',
  description: 'メンバー募集 (Looking For Group)',
  author: { name: 'Herta' },
  category: 'game',
  permissions: [
    {
      id: 'lfg.manage',
      name: 'LFG 管理',
      description: 'LFG 設定の管理',
    },
  ],
  dependencies: [],
  configSchema: {},
  events: [],
  commands: [{ name: 'lfg', description: 'メンバー募集' }],
};
