import type { PluginManifest } from '@herta/shared';

/**
 * AI FoundationのGuild opt-inを表すcatalog manifest。
 * model / provider / quota / Secretはserver-side設定だけで解決し、Plugin configへ保存しない。
 * Discord surfaceはKnowledge/RAGとQ&Aの後続PRで追加する。
 */
export const aiManifest: PluginManifest = {
  id: 'ai',
  name: 'Herta AI',
  version: '1.0.0',
  description: 'Herta Knowledge Baseを利用するAI機能のGuild opt-inを管理します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'ai.use',
      name: 'Herta AI 利用',
      description: 'Guildで明示的に有効化されたHerta AI機能を利用します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'GuildでHerta AIを利用する',
        default: false,
        'x-herta-ui': {
          section: 'AI opt-in',
          help: 'Plugin自体の有効化とは別の明示opt-inです。Global AIが無効な場合はONでも外部AI providerを呼びません。',
        },
      },
    },
    required: ['enabled'],
  },
  events: [],
  commands: [],
};
