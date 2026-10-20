import type { PluginManifest } from '@herta/shared';

export const vcRecapManifest: PluginManifest = {
  id: 'vc-recap',
  name: 'VC Recap',
  version: '1.0.0',
  description:
    'VC(ボイスチャンネル)での会話を文字起こしし、通話終了時に簡単な要約を生成します。発言の文字起こし対象は`/herta-privacy voice-consent`で本人が同意したメンバー、または自動同意ロールを付与されたメンバーのみです',
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
          help: '本人が同意したメンバー、または自動同意ロールを付与されたメンバーの発言のみをAWS Transcribeで文字起こしし、通話終了時に要約を生成します。有効化前にdocs/PRIVACY_POLICY.mdの内容を確認してください。',
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
          channelKind: 'voice',
          multiple: true,
          placeholder: '記録しないVCを選択',
        },
      },
      autoConsentRoleIds: {
        type: 'array',
        title: '自動同意ロール',
        uniqueItems: true,
        maxItems: 50,
        default: [],
        items: { type: 'string', pattern: '^\\d+$' },
        'x-herta-ui': {
          section: '除外設定',
          widget: 'discord-role',
          multiple: true,
          placeholder: '個別の同意操作なしで同意済みとみなすロールを選択',
          help: 'このロールを付与されたメンバーは、このGuildでのVC Recapに限り、個別の同意操作なしで文字起こしへ同意済みとみなされます。Discordのロールはguildごとに別物のため、この自動同意判定自体は他のGuildには影響しません(同意状態を保存するテーブル自体はguild非依存のグローバル設計ですが、ロールによる自動同意はDBへ書き込まないランタイム判定のみで、このGuildでのVC Recapセッション中にのみ適用されます)。',
        },
      },
    },
    required: ['enabled', 'excludedChannelIds', 'autoConsentRoleIds'],
  },
  events: [],
  commands: [
    {
      name: 'vc-recap',
      description: 'VC通話の文字起こし・要約を記録します',
      subcommands: [
        {
          name: 'start',
          description:
            '参加中のVCで記録を開始します(同意済みまたは自動同意ロールを持つメンバーの発言のみ対象)',
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
