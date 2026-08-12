import type { PluginManifest } from '@herta/shared';

export const communityProfileManifest: PluginManifest = {
  id: 'community-profile',
  name: 'Community Profile',
  version: '2.0.0',
  description:
    'XP・Activity・Achievements・Profile Title・Badge Showcaseを1つのメンバープロフィールとして表示します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'community-profile.use',
      name: 'Community Profile利用',
      description: 'プロフィール閲覧・Badge Showcase・公開設定を利用します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Community Profileを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      ephemeralResponses: {
        type: 'boolean',
        title: 'プロフィール表示を本人だけに表示する',
        default: false,
        'x-herta-ui': {
          section: '基本設定',
          help: 'ONにすると /profile view の結果をコマンド実行者だけに表示します。',
        },
      },
      allowViewingOthers: {
        type: 'boolean',
        title: '他メンバーのプロフィール閲覧を許可する',
        default: true,
        'x-herta-ui': {
          section: '公開設定',
          help: 'ユーザー個別の非公開設定が優先されます。',
        },
      },
      defaultActivityPeriod: {
        type: 'string',
        title: 'Activityの標準集計期間',
        enum: ['7d', '30d', 'all'],
        default: '30d',
        'x-herta-ui': {
          section: 'Activity',
          help: 'プロフィールに表示する発言・VC・リアクション等の集計期間です。',
        },
      },
      showXp: {
        type: 'boolean',
        title: 'XP / Levelを表示する',
        default: true,
        'x-herta-ui': { section: '表示項目' },
      },
      showActivity: {
        type: 'boolean',
        title: 'Activityを表示する',
        default: true,
        'x-herta-ui': { section: '表示項目' },
      },
      showAchievements: {
        type: 'boolean',
        title: 'Achievementsを表示する',
        default: true,
        'x-herta-ui': { section: '表示項目' },
      },
      showAchievementCompletion: {
        type: 'boolean',
        title: 'Achievement達成率を表示する',
        default: true,
        'x-herta-ui': { section: 'Achievements' },
      },
      showAchievementRarityBreakdown: {
        type: 'boolean',
        title: 'Rarity別の解除内訳を表示する',
        default: true,
        'x-herta-ui': { section: 'Achievements' },
      },
      showProfileTitle: {
        type: 'boolean',
        title: 'Profile Titleを表示する',
        default: true,
        'x-herta-ui': {
          section: 'Profile Title',
          help: '解除済みAchievementを称号としてプロフィール上部へ表示します。',
        },
      },
      showRankings: {
        type: 'boolean',
        title: 'ランキング順位を表示する',
        default: true,
        'x-herta-ui': { section: '表示項目' },
      },
      showRecentAchievements: {
        type: 'boolean',
        title: '最近解除したAchievementを表示する',
        default: true,
        'x-herta-ui': { section: 'Achievements' },
      },
      recentAchievementCount: {
        type: 'integer',
        title: '最近解除したAchievementの表示数',
        minimum: 0,
        maximum: 5,
        default: 3,
        'x-herta-ui': { section: 'Achievements' },
      },
      featuredBadgeLimit: {
        type: 'integer',
        title: 'Badge Showcaseの最大数',
        minimum: 1,
        maximum: 5,
        default: 3,
        'x-herta-ui': {
          section: 'Achievements',
          help: 'ユーザーがプロフィールに固定できるAchievement Badgeの最大数です。',
        },
      },
      showMinecraftActivity: {
        type: 'boolean',
        title: 'Minecraft活動時間を表示する',
        default: true,
        'x-herta-ui': { section: 'Activity' },
      },
      showZeroActivity: {
        type: 'boolean',
        title: '0件のActivity項目も表示する',
        default: false,
        'x-herta-ui': { section: 'Activity' },
      },
    },
    required: [
      'enabled',
      'ephemeralResponses',
      'allowViewingOthers',
      'defaultActivityPeriod',
      'showXp',
      'showActivity',
      'showAchievements',
      'showAchievementCompletion',
      'showAchievementRarityBreakdown',
      'showProfileTitle',
      'showRankings',
      'showRecentAchievements',
      'recentAchievementCount',
      'featuredBadgeLimit',
      'showMinecraftActivity',
      'showZeroActivity',
    ],
  },
  events: [],
  commands: [
    {
      name: 'profile',
      description: 'Community Profileを表示・設定します',
      subcommands: [
        {
          name: 'view',
          description: 'Community Profileを表示します',
          options: [
            {
              name: 'user',
              description: '確認するメンバー（未指定は自分）',
              type: 'user',
            },
          ],
        },
        {
          name: 'badge-add',
          description: '解除済みAchievementをBadge Showcaseへ追加します',
          options: [
            {
              name: 'achievement',
              description: '追加するAchievement ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'badge-remove',
          description: 'AchievementをBadge Showcaseから外します',
          options: [
            {
              name: 'achievement',
              description: '外すAchievement ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'badge-clear',
          description: 'Badge Showcaseをすべてクリアします',
        },
        {
          name: 'title-set',
          description: '解除済みAchievementをProfile Titleに設定します',
          options: [
            {
              name: 'achievement',
              description: 'Titleとして表示するAchievement ID',
              type: 'string',
              required: true,
            },
          ],
        },
        {
          name: 'title-clear',
          description: 'Profile Titleを解除します',
        },
        {
          name: 'privacy',
          description: '自分のCommunity Profile公開設定を変更します',
          options: [
            {
              name: 'public',
              description: '他メンバーや将来のMember Webから閲覧可能にする',
              type: 'boolean',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};
