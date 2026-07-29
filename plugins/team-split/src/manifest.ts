import type { PluginManifest } from '@herta/shared';

export const teamSplitManifest: PluginManifest = {
  id: 'team-split',
  name: 'Team Split',
  version: '1.0.0',
  description: '参加者を集め、randomまたは明示scoreによるbalancedチームへ安全に分割します',
  author: { name: 'Herta' },
  category: 'game',
  permissions: [
    {
      id: 'team-split.manage',
      name: 'Team Split 管理',
      description: 'セッションの閲覧、参加者操作、分割、再抽選、強制終了を管理します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      maxOpenSessionsPerGuild: {
        type: 'integer',
        title: 'Guild内の最大進行中セッション数',
        minimum: 1,
        maximum: 200,
        default: 20,
      },
      maxOpenSessionsPerChannel: {
        type: 'integer',
        title: 'チャンネル内の最大進行中セッション数',
        minimum: 1,
        maximum: 50,
        default: 5,
      },
      creationCooldownSeconds: {
        type: 'integer',
        title: 'セッション作成Cooldown（秒）',
        minimum: 0,
        maximum: 3600,
        default: 30,
      },
      maxParticipantsLimit: {
        type: 'integer',
        title: '参加可能な最大人数',
        minimum: 2,
        maximum: 500,
        default: 100,
      },
      maxTeamCount: {
        type: 'integer',
        title: '作成可能な最大チーム数',
        minimum: 2,
        maximum: 50,
        default: 10,
      },
      defaultDurationMinutes: {
        type: 'integer',
        title: '既定受付期間（分）',
        minimum: 5,
        maximum: 10080,
        default: 60,
      },
      maxDurationMinutes: {
        type: 'integer',
        title: '最大受付期間（分）',
        minimum: 5,
        maximum: 43200,
        default: 1440,
      },
      maxTitleLength: {
        type: 'integer',
        title: 'タイトル最大文字数',
        minimum: 1,
        maximum: 200,
        default: 100,
      },
      retentionDays: {
        type: 'integer',
        title: '終了済みセッションの保持日数',
        minimum: 1,
        maximum: 3650,
        default: 90,
      },
    },
    required: [
      'maxOpenSessionsPerGuild',
      'maxOpenSessionsPerChannel',
      'creationCooldownSeconds',
      'maxParticipantsLimit',
      'maxTeamCount',
      'defaultDurationMinutes',
      'maxDurationMinutes',
      'maxTitleLength',
      'retentionDays',
    ],
  },
  events: ['interactionCreate', 'messageDelete'],
  commands: [
    {
      name: 'team',
      description: 'チーム分けセッションを管理します',
      subcommands: [
        {
          name: 'create',
          description: '新しいチーム分けセッションを作成します',
          options: [
            { name: 'title', description: 'セッション名', type: 'string', required: true },
            {
              name: 'team_count',
              description: '作成するチーム数',
              type: 'integer',
              required: true,
            },
            {
              name: 'mode',
              description: '分割方式',
              type: 'string',
              required: true,
              choices: [
                { name: 'ランダム', value: 'random' },
                { name: '明示scoreで均等化', value: 'balanced' },
              ],
            },
            {
              name: 'max_participants',
              description: '作成者を含む最大参加人数',
              type: 'integer',
              required: true,
            },
            { name: 'duration_minutes', description: '受付期間（分）', type: 'integer' },
            { name: 'seed', description: '任意の再現用seed（公開表示されません）', type: 'string' },
            {
              name: 'creator_score',
              description: 'balanced用の作成者score（未指定は0）',
              type: 'integer',
            },
          ],
        },
        {
          name: 'add',
          description: '参加者を追加またはscore更新します',
          options: [
            { name: 'id', description: 'セッションID', type: 'string', required: true },
            { name: 'user', description: '対象ユーザー', type: 'user', required: true },
            { name: 'score', description: 'balanced用score（未指定は0）', type: 'integer' },
          ],
        },
        {
          name: 'remove',
          description: '参加者を削除します',
          options: [
            { name: 'id', description: 'セッションID', type: 'string', required: true },
            { name: 'user', description: '対象ユーザー', type: 'user', required: true },
          ],
        },
        {
          name: 'split',
          description: '現在の参加者をチームへ分割します',
          options: [{ name: 'id', description: 'セッションID', type: 'string', required: true }],
        },
        {
          name: 'reroll',
          description: '同じ参加者で再抽選します',
          options: [{ name: 'id', description: 'セッションID', type: 'string', required: true }],
        },
        {
          name: 'show',
          description: 'セッションと結果を表示します',
          options: [{ name: 'id', description: 'セッションID', type: 'string', required: true }],
        },
        {
          name: 'close',
          description: 'セッションを終了します',
          options: [{ name: 'id', description: 'セッションID', type: 'string', required: true }],
        },
      ],
    },
  ],
};
