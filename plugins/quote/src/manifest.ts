import type { PluginManifest } from '@herta/shared';

export const quoteManifest: PluginManifest = {
  id: 'quote',
  name: 'Quote',
  version: '1.0.0',
  description: '名言の登録・表示・管理',
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
  configSchema: {},
  events: [],
  commands: [{ name: 'quote', description: '名言の管理' }],
};
