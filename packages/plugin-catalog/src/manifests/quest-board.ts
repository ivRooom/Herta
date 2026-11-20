import type { PluginManifest } from '@herta/shared';

export const questBoardManifest: PluginManifest = {
  id: 'quest-board',
  name: 'クエストボード',
  version: '1.0.0',
  description:
    'Discordからivrm-webのクエストボード（デイリー／ウィークリー／マンスリー）の進捗や全クリア状況を確認できます。進捗はWebのクエストボードと同期します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [],
  dependencies: [],
  events: ['interactionCreate'],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', title: 'クエストボードを有効にする', default: true },
    },
    required: ['enabled'],
  },
  commands: [
    {
      name: 'quest',
      description: 'ivrm-webのクエストボードの進捗確認（デイリー／ウィークリー／マンスリー）',
      subcommands: [
        {
          name: 'daily',
          description: '今日のデイリークエストと進捗を表示します',
        },
        {
          name: 'weekly',
          description: '今週のウィークリークエストと進捗を表示します',
        },
        {
          name: 'monthly',
          description: '今月のマンスリークエストと進捗を表示します',
        },
      ],
    },
  ],
};
