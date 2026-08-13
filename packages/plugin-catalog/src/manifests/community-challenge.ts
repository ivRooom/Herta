import type { PluginManifest } from '@herta/shared';

export const communityChallengeManifest: PluginManifest = {
  id: 'community-challenge',
  name: 'Community Challenge / Season',
  version: '1.0.0',
  description:
    'Daily / Weekly Challenge、Season Point、Season Level、Streak、ランキングを提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'community-challenge.use',
      name: 'Community Challenge利用',
      description: 'Challenge進捗・Season情報・ランキングを確認します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Community Challengeを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      dailyEnabled: {
        type: 'boolean',
        title: 'Daily Challengeを有効化する',
        default: true,
        'x-herta-ui': { section: 'Challenge配布' },
      },
      weeklyEnabled: {
        type: 'boolean',
        title: 'Weekly Challengeを有効化する',
        default: true,
        'x-herta-ui': { section: 'Challenge配布' },
      },
      dailyChallengeCount: {
        type: 'integer',
        title: '1日のDaily Challenge数',
        minimum: 1,
        maximum: 5,
        default: 3,
        'x-herta-ui': {
          section: 'Challenge配布',
          help: '同じ活動指標が重複しないように選出します。現在配布済みのChallengeは途中変更されません。',
        },
      },
      weeklyChallengeCount: {
        type: 'integer',
        title: '1週間のWeekly Challenge数',
        minimum: 1,
        maximum: 5,
        default: 3,
        'x-herta-ui': {
          section: 'Challenge配布',
          help: '月曜0:00 JSTを基準に更新します。',
        },
      },
      includeMinecraftChallenges: {
        type: 'boolean',
        title: 'Minecraft Challengeを配布候補に含める',
        default: true,
        'x-herta-ui': {
          section: 'Challenge配布',
          help: 'Minecraft活動データを投入していないGuildではOFFを推奨します。',
        },
      },
      includeMiniGameChallenges: {
        type: 'boolean',
        title: 'Mini Games Challengeを配布候補に含める',
        default: false,
        'x-herta-ui': {
          section: 'Challenge配布',
          help: 'Mini Games Pluginを有効にし、ゲーム戦績を記録しているGuildでONにしてください。',
        },
      },
      autoSync: {
        type: 'boolean',
        title: '活動に応じてChallengeを自動同期する',
        default: true,
        'x-herta-ui': {
          section: '自動同期',
          help: '発言・リアクション・VC変化を契機にChallenge完了を判定します。',
        },
      },
      autoSyncCooldownSeconds: {
        type: 'integer',
        title: '自動同期Cooldown（秒）',
        minimum: 10,
        maximum: 600,
        default: 30,
        'x-herta-ui': {
          section: '自動同期',
          help: 'ユーザー単位でDB判定頻度を抑えます。',
        },
      },
      notifyCompletions: {
        type: 'boolean',
        title: 'Challenge完了を通知する',
        default: true,
        'x-herta-ui': { section: '完了通知' },
      },
      completionChannelId: {
        type: ['string', 'null'],
        title: 'Challenge完了通知チャンネル',
        default: null,
        'x-herta-ui': {
          section: '完了通知',
          widget: 'discord-channel',
          placeholder: '通知先を選択（未設定は活動元へ返信）',
          help: 'VCなど返信先がない活動では、未設定の場合は通知のみ省略されます。Challenge完了は保存されます。',
        },
      },
      mentionOnCompletion: {
        type: 'boolean',
        title: 'Challenge完了通知で本人へメンションする',
        default: false,
        'x-herta-ui': { section: '完了通知' },
      },
      seasonPointMultiplier: {
        type: 'integer',
        title: 'Season Point倍率',
        minimum: 1,
        maximum: 3,
        default: 1,
        'x-herta-ui': {
          section: 'Season',
          help: 'Challengeの基本Pointへ1〜3倍を適用します。完了済みPointは後から変更されません。',
        },
      },
      seasonLevelPoints: {
        type: 'integer',
        title: 'Season Level 1段階あたりのPoint',
        minimum: 25,
        maximum: 500,
        default: 100,
        'x-herta-ui': {
          section: 'Season',
          help: '既定では100ptごとにSeason Levelが1上がります。',
        },
      },
      leaderboardSize: {
        type: 'integer',
        title: 'Season Leaderboard表示人数',
        minimum: 5,
        maximum: 25,
        default: 10,
        'x-herta-ui': { section: 'Season' },
      },
      ephemeralSync: {
        type: 'boolean',
        title: '手動同期結果を本人だけに表示する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
    },
    required: [
      'enabled',
      'dailyEnabled',
      'weeklyEnabled',
      'dailyChallengeCount',
      'weeklyChallengeCount',
      'includeMinecraftChallenges',
      'autoSync',
      'autoSyncCooldownSeconds',
      'notifyCompletions',
      'completionChannelId',
      'mentionOnCompletion',
      'seasonPointMultiplier',
      'seasonLevelPoints',
      'leaderboardSize',
      'ephemeralSync',
    ],
  },
  events: ['messageCreate', 'messageReactionAdd', 'interactionCreate', 'voiceStateUpdate'],
  commands: [
    {
      name: 'challenge',
      description: 'Daily / Weekly Challengeを確認・同期します',
      subcommands: [
        {
          name: 'today',
          description: '今日のDaily Challengeと進捗を表示します',
        },
        {
          name: 'week',
          description: '今週のWeekly Challengeと進捗を表示します',
        },
        {
          name: 'sync',
          description: '現在の活動からDaily / Weekly Challengeを同期します',
        },
        {
          name: 'catalog',
          description: 'Challengeテンプレート一覧を表示します',
          options: [
            {
              name: 'period',
              description: '表示するChallenge種別',
              type: 'string',
              choices: [
                { name: 'Daily', value: 'daily' },
                { name: 'Weekly', value: 'weekly' },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'season',
      description: 'Community Seasonの進捗とランキングを確認します',
      subcommands: [
        {
          name: 'status',
          description: 'Season Point・Level・Streakを表示します',
          options: [
            {
              name: 'user',
              description: '確認するメンバー（未指定は自分）',
              type: 'user',
            },
          ],
        },
        {
          name: 'leaderboard',
          description: 'Season Pointランキングを表示します',
          options: [
            {
              name: 'limit',
              description: '表示人数（5〜25）',
              type: 'integer',
              minValue: 5,
              maxValue: 25,
            },
          ],
        },
      ],
    },
  ],
};
