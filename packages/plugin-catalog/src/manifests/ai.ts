import type { PluginManifest } from '@herta/shared';

/**
 * AI FoundationのGuild opt-inとDiscord mention surfaceを表すcatalog manifest。
 * model / provider / quota / Secretはserver-side設定だけで解決し、Plugin configへ保存しない。
 * Phase 1ではcode/file artifactをattachmentとして返し、code execution / image generationは行わない。
 */
export const aiManifest: PluginManifest = {
  id: 'ai',
  name: 'Herta AI',
  version: '1.0.0',
  description: 'Herta AIの会話・成果物生成機能をGuild単位で管理します',
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
      triggerRoleId: {
        type: ['string', 'null'],
        title: 'AIを呼び出すRole',
        pattern: '^\\d+$',
        default: null,
        'x-herta-ui': {
          section: '呼び出し設定',
          widget: 'discord-role',
          mentionableOnly: true,
          placeholder: 'AI呼び出しに使うRoleを選択（任意）',
          help: '設定した単一Roleへのreal mentionだけをHerta本人へのmentionと同じAI triggerとして扱います。Roleだけで呼び出すにはDiscord Developer PortalとBot runtimeのMessage Content Intentが有効である必要があります。未設定時はRole mentionで反応しません。',
        },
      },
    },
    required: ['enabled'],
  },
  events: ['messageCreate'],
  commands: [],
};
