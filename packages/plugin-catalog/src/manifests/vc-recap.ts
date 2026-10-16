import type { PluginManifest } from '@herta/shared';

export const vcRecapManifest: PluginManifest = {
  id: 'vc-recap',
  name: 'VC Recap',
  version: '1.0.0',
  description:
    'VC(ボイスチャンネル)での会話を文字起こしし、通話終了時に簡単な要約を生成します。発言の文字起こし対象は`/herta-privacy voice-consent`で本人が同意したメンバーのみです',
  author: { name: 'Herta' },
  category: 'moderation',
  permissions: [
    {
      id: 'vc-recap.view',
      name: 'VC Recap 閲覧',
      description: '生成されたVC通話の要約を確認します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'VC Recapを有効化する',
        default: false,
        'x-herta-ui': {
          section: '基本設定',
          help: '本人が同意したメンバーの発言のみをAWS Transcribeで文字起こしし、通話終了時に要約を生成します。有効化前にdocs/PRIVACY_POLICY.mdの内容を確認してください。',
        },
      },
      excludedChannelIds: {
        type: 'array',
        title: '記録から除外するVC',
        uniqueItems: true,
        maxItems: 50,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
        'x-herta-ui': {
          section: '除外設定',
          widget: 'discord-channel',
          multiple: true,
          placeholder: '記録しないVCを選択',
        },
      },
    },
    required: ['enabled', 'excludedChannelIds'],
  },
  events: [],
  commands: [
    {
      name: 'vc-recap',
      description: 'VC通話の文字起こし・要約を記録します',
      subcommands: [
        {
          name: 'start',
          description: '参加中のVCで記録を開始します(本人が同意したメンバーの発言のみ対象)',
        },
        {
          name: 'stop',
          description: '記録を終了し、要約を生成します',
        },
        {
          name: 'list',
          description: '直近のVC要約を表示します',
          options: [
            {
              name: 'limit',
              description: '表示件数(1〜10、既定5)',
              type: 'integer',
              minValue: 1,
              maxValue: 10,
            },
          ],
        },
      ],
    },
  ],
};
