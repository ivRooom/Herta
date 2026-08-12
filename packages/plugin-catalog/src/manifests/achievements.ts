import type { PluginManifest } from '@herta/shared';

export const achievementsManifest: PluginManifest = {
  id: 'achievements',
  name: 'Achievements / Badges',
  version: '2.1.0',
  description:
    'サーバー活動から実績を自動解除し、Badge Collection・進捗・ポイント・ランキングを提供します',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [
    {
      id: 'achievements.use',
      name: 'Achievements利用',
      description: '自分やメンバーの実績・Badge・進捗・ランキングを確認します',
    },
  ],
  dependencies: [],
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Achievementsを有効化する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      autoSync: {
        type: 'boolean',
        title: '活動に応じて自動同期する',
        default: true,
        'x-herta-ui': {
          section: '自動解除',
          help: '発言・リアクション・VC活動をきっかけにAchievement解除状態を自動更新します。',
        },
      },
      autoSyncCooldownSeconds: {
        type: 'integer',
        title: '自動同期Cooldown（秒）',
        minimum: 10,
        maximum: 600,
        default: 30,
        'x-herta-ui': {
          section: '自動解除',
          help: 'ユーザー単位でAchievement判定のDB負荷を抑えます。',
        },
      },
      ephemeralSync: {
        type: 'boolean',
        title: '手動同期結果を本人だけに表示する',
        default: true,
        'x-herta-ui': { section: '基本設定' },
      },
      notifyUnlocks: {
        type: 'boolean',
        title: 'Achievement解除を通知する',
        default: true,
        'x-herta-ui': { section: '解除通知' },
      },
      unlockChannelId: {
        type: ['string', 'null'],
        title: 'Achievement解除通知チャンネル',
        default: null,
        'x-herta-ui': {
          section: '解除通知',
          widget: 'discord-channel',
          placeholder: '通知先を選択（未設定は活動元へ返信）',
          help: 'VCなど返信先がない活動では、未設定の場合は通知だけ省略されます。解除自体は保存されます。',
        },
      },
      mentionOnUnlock: {
        type: 'boolean',
        title: '解除通知で本人へメンションする',
        default: false,
        'x-herta-ui': { section: '解除通知' },
      },
      notificationMinimumRarity: {
        type: 'string',
        title: '通知する最低Rarity',
        enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
        default: 'common',
        'x-herta-ui': {
          section: '解除通知',
          help: 'Rare以上だけ通知する、といった運用ができます。',
        },
      },
      showLocked: {
        type: 'boolean',
        title: '未解除実績を一覧に表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      showProgress: {
        type: 'boolean',
        title: '未解除実績の進捗を表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      showScore: {
        type: 'boolean',
        title: 'Badge Pointを表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      showRarity: {
        type: 'boolean',
        title: 'Rarityを表示する',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      hideSecretUntilUnlocked: {
        type: 'boolean',
        title: 'Secret実績を解除まで隠す',
        default: true,
        'x-herta-ui': { section: '表示設定' },
      },
      pageSize: {
        type: 'integer',
        title: '一覧1ページの実績数',
        minimum: 5,
        maximum: 20,
        default: 10,
        'x-herta-ui': { section: '表示設定' },
      },
      leaderboardSize: {
        type: 'integer',
        title: 'Badge Leaderboard表示人数',
        minimum: 5,
        maximum: 25,
        default: 10,
        'x-herta-ui': { section: 'ランキング' },
      },
    },
    required: [
      'enabled',
      'autoSync',
      'autoSyncCooldownSeconds',
      'ephemeralSync',
      'notifyUnlocks',
      'unlockChannelId',
      'mentionOnUnlock',
      'notificationMinimumRarity',
      'showLocked',
      'showProgress',
      'showScore',
      'showRarity',
      'hideSecretUntilUnlocked',
      'pageSize',
      'leaderboardSize',
    ],
  },
  events: ['messageCreate', 'messageReactionAdd', 'voiceStateUpdate'],
  commands: [
    {
      name: 'achievements',
      description: '実績・Badge Collectionと進捗を表示します',
      options: [
        {
          name: 'user',
          description: '確認するメンバー（未指定は自分）',
          type: 'user',
        },
        {
          name: 'category',
          description: '表示カテゴリ',
          type: 'string',
          choices: [
            { name: 'XP', value: 'xp' },
            { name: 'Activity', value: 'activity' },
            { name: 'Social', value: 'social' },
            { name: 'Events', value: 'events' },
            { name: 'Community', value: 'community' },
            { name: 'Minecraft', value: 'minecraft' },
            { name: 'Challenge', value: 'challenge' },
          ],
        },
        {
          name: 'rarity',
          description: '表示Rarity',
          type: 'string',
          choices: [
            { name: 'Common', value: 'common' },
            { name: 'Uncommon', value: 'uncommon' },
            { name: 'Rare', value: 'rare' },
            { name: 'Epic', value: 'epic' },
            { name: 'Legendary', value: 'legendary' },
          ],
        },
        {
          name: 'status',
          description: '解除状態',
          type: 'string',
          choices: [
            { name: '解除済み', value: 'unlocked' },
            { name: '未解除', value: 'locked' },
          ],
        },
      ],
    },
    {
      name: 'achievement',
      description: 'Achievementsを同期・確認します',
      subcommands: [
        {
          name: 'sync',
          description: '現在の活動データから実績解除状態を同期します',
        },
        {
          name: 'info',
          description: '実績の条件・現在進捗を表示します',
          options: [
            {
              name: 'id',
              description: 'Achievement ID',
              type: 'string',
              required: true,
            },
            {
              name: 'user',
              description: '確認するメンバー（未指定は自分）',
              type: 'user',
            },
          ],
        },
        {
          name: 'leaderboard',
          description: 'Achievement解除数ランキングを表示します',
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
