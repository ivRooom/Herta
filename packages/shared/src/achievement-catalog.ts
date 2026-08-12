export const ACHIEVEMENT_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export const ACHIEVEMENT_CATEGORIES = [
  'xp',
  'activity',
  'social',
  'events',
  'community',
  'minecraft',
  'challenge',
] as const;

export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];
export type AchievementMetric =
  | 'xp'
  | 'messages'
  | 'reactionsGiven'
  | 'reactionsReceived'
  | 'voiceSeconds'
  | 'minecraftSeconds'
  | 'pollVotes'
  | 'giveawayEntries'
  | 'eventGoing'
  | 'suggestions'
  | 'acceptedSuggestions'
  | 'challengeCompletions'
  | 'seasonPoints';

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  metric?: AchievementMetric;
  target?: number;
  secret?: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    id: 'first-steps',
    name: 'First Steps',
    description: '100 XPを獲得する',
    emoji: '🌱',
    rarity: 'common',
    category: 'xp',
    metric: 'xp',
    target: 100,
  },
  {
    id: 'getting-active',
    name: 'Getting Active',
    description: '1,000 XPを獲得する',
    emoji: '⚡',
    rarity: 'uncommon',
    category: 'xp',
    metric: 'xp',
    target: 1_000,
  },
  {
    id: 'server-regular',
    name: 'Server Regular',
    description: '5,000 XPを獲得する',
    emoji: '🔥',
    rarity: 'rare',
    category: 'xp',
    metric: 'xp',
    target: 5_000,
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: '20,000 XPを獲得する',
    emoji: '👑',
    rarity: 'legendary',
    category: 'xp',
    metric: 'xp',
    target: 20_000,
  },
  {
    id: 'xp-elite',
    name: 'XP Elite',
    description: '50,000 XPを獲得する',
    emoji: '💎',
    rarity: 'legendary',
    category: 'xp',
    metric: 'xp',
    target: 50_000,
  },
  {
    id: 'first-message',
    name: 'Hello, Community!',
    description: '集計対象メッセージを1件送信する',
    emoji: '👋',
    rarity: 'common',
    category: 'activity',
    metric: 'messages',
    target: 1,
  },
  {
    id: 'chat-starter',
    name: 'Chat Starter',
    description: '集計対象メッセージを100件送信する',
    emoji: '💬',
    rarity: 'uncommon',
    category: 'activity',
    metric: 'messages',
    target: 100,
  },
  {
    id: 'conversation-engine',
    name: 'Conversation Engine',
    description: '集計対象メッセージを1,000件送信する',
    emoji: '🗣️',
    rarity: 'rare',
    category: 'activity',
    metric: 'messages',
    target: 1_000,
  },
  {
    id: 'chat-marathon',
    name: 'Chat Marathon',
    description: '集計対象メッセージを5,000件送信する',
    emoji: '🏃',
    rarity: 'epic',
    category: 'activity',
    metric: 'messages',
    target: 5_000,
  },
  {
    id: 'chat-legend',
    name: 'Chat Legend',
    description: '集計対象メッセージを10,000件送信する',
    emoji: '📣',
    rarity: 'legendary',
    category: 'activity',
    metric: 'messages',
    target: 10_000,
  },
  {
    id: 'voice-check-in',
    name: 'Voice Check-in',
    description: 'VCで合計10分活動する',
    emoji: '🎙️',
    rarity: 'common',
    category: 'activity',
    metric: 'voiceSeconds',
    target: 600,
  },
  {
    id: 'voice-regular',
    name: 'Voice Regular',
    description: 'VCで合計10時間活動する',
    emoji: '🎧',
    rarity: 'uncommon',
    category: 'activity',
    metric: 'voiceSeconds',
    target: 36_000,
  },
  {
    id: 'voice-enthusiast',
    name: 'Voice Enthusiast',
    description: 'VCで合計50時間活動する',
    emoji: '🎚️',
    rarity: 'epic',
    category: 'activity',
    metric: 'voiceSeconds',
    target: 180_000,
  },
  {
    id: 'voice-veteran',
    name: 'Voice Veteran',
    description: 'VCで合計100時間活動する',
    emoji: '📻',
    rarity: 'legendary',
    category: 'activity',
    metric: 'voiceSeconds',
    target: 360_000,
  },
  {
    id: 'first-reaction',
    name: 'First Reaction',
    description: 'リアクションを1回付ける',
    emoji: '✨',
    rarity: 'common',
    category: 'social',
    metric: 'reactionsGiven',
    target: 1,
  },
  {
    id: 'reaction-regular',
    name: 'Reaction Regular',
    description: 'リアクションを100回付ける',
    emoji: '🙌',
    rarity: 'uncommon',
    category: 'social',
    metric: 'reactionsGiven',
    target: 100,
  },
  {
    id: 'reaction-enthusiast',
    name: 'Reaction Enthusiast',
    description: 'リアクションを500回付ける',
    emoji: '🎇',
    rarity: 'rare',
    category: 'social',
    metric: 'reactionsGiven',
    target: 500,
  },
  {
    id: 'reaction-machine',
    name: 'Reaction Machine',
    description: 'リアクションを1,000回付ける',
    emoji: '🎆',
    rarity: 'epic',
    category: 'social',
    metric: 'reactionsGiven',
    target: 1_000,
  },
  {
    id: 'noticed',
    name: 'Getting Noticed',
    description: '自分の投稿にリアクションを10回もらう',
    emoji: '💜',
    rarity: 'common',
    category: 'social',
    metric: 'reactionsReceived',
    target: 10,
  },
  {
    id: 'crowd-favorite',
    name: 'Crowd Favorite',
    description: '自分の投稿にリアクションを100回もらう',
    emoji: '🌟',
    rarity: 'rare',
    category: 'social',
    metric: 'reactionsReceived',
    target: 100,
  },
  {
    id: 'beloved-contributor',
    name: 'Beloved Contributor',
    description: '自分の投稿にリアクションを500回もらう',
    emoji: '💖',
    rarity: 'epic',
    category: 'social',
    metric: 'reactionsReceived',
    target: 500,
  },
  {
    id: 'community-star',
    name: 'Community Star',
    description: '自分の投稿にリアクションを1,000回もらう',
    emoji: '💫',
    rarity: 'epic',
    category: 'social',
    metric: 'reactionsReceived',
    target: 1_000,
  },
  {
    id: 'first-vote',
    name: 'First Vote',
    description: 'Pollへ1回参加する',
    emoji: '🗳️',
    rarity: 'common',
    category: 'community',
    metric: 'pollVotes',
    target: 1,
  },
  {
    id: 'voice-of-community',
    name: 'Voice of Community',
    description: 'Pollへ10回参加する',
    emoji: '📊',
    rarity: 'rare',
    category: 'community',
    metric: 'pollVotes',
    target: 10,
  },
  {
    id: 'community-voter',
    name: 'Community Voter',
    description: 'Pollへ50回参加する',
    emoji: '🏛️',
    rarity: 'epic',
    category: 'community',
    metric: 'pollVotes',
    target: 50,
  },
  {
    id: 'feeling-lucky',
    name: 'Feeling Lucky',
    description: 'Giveawayへ1回参加する',
    emoji: '🎁',
    rarity: 'common',
    category: 'events',
    metric: 'giveawayEntries',
    target: 1,
  },
  {
    id: 'event-goer',
    name: 'Event Goer',
    description: 'Eventへ3回参加表明する',
    emoji: '🎟️',
    rarity: 'uncommon',
    category: 'events',
    metric: 'eventGoing',
    target: 3,
  },
  {
    id: 'community-regular',
    name: 'Community Regular',
    description: 'Eventへ10回参加表明する',
    emoji: '🎉',
    rarity: 'epic',
    category: 'events',
    metric: 'eventGoing',
    target: 10,
  },
  {
    id: 'event-veteran',
    name: 'Event Veteran',
    description: 'Eventへ25回参加表明する',
    emoji: '🏆',
    rarity: 'legendary',
    category: 'events',
    metric: 'eventGoing',
    target: 25,
  },
  {
    id: 'idea-maker',
    name: 'Idea Maker',
    description: 'Suggestionを1件投稿する',
    emoji: '💡',
    rarity: 'common',
    category: 'community',
    metric: 'suggestions',
    target: 1,
  },
  {
    id: 'idea-machine',
    name: 'Idea Machine',
    description: 'Suggestionを10件投稿する',
    emoji: '🧠',
    rarity: 'rare',
    category: 'community',
    metric: 'suggestions',
    target: 10,
  },
  {
    id: 'change-maker',
    name: 'Change Maker',
    description: 'Suggestionが1件採用または完了になる',
    emoji: '🛠️',
    rarity: 'rare',
    category: 'community',
    metric: 'acceptedSuggestions',
    target: 1,
  },
  {
    id: 'community-builder',
    name: 'Community Builder',
    description: 'Suggestionが5件採用または完了になる',
    emoji: '🏗️',
    rarity: 'epic',
    category: 'community',
    metric: 'acceptedSuggestions',
    target: 5,
  },
  {
    id: 'minecraft-explorer',
    name: 'Minecraft Explorer',
    description: 'Minecraftで合計1時間活動する',
    emoji: '⛏️',
    rarity: 'common',
    category: 'minecraft',
    metric: 'minecraftSeconds',
    target: 3_600,
  },
  {
    id: 'minecraft-regular',
    name: 'Minecraft Regular',
    description: 'Minecraftで合計25時間活動する',
    emoji: '🧱',
    rarity: 'rare',
    category: 'minecraft',
    metric: 'minecraftSeconds',
    target: 90_000,
  },
  {
    id: 'minecraft-veteran',
    name: 'Minecraft Veteran',
    description: 'Minecraftで合計100時間活動する',
    emoji: '🏰',
    rarity: 'legendary',
    category: 'minecraft',
    metric: 'minecraftSeconds',
    target: 360_000,
  },
  {
    id: 'first-challenge',
    name: 'First Challenge',
    description: 'Community Challengeを1回Clearする',
    emoji: '🎯',
    rarity: 'common',
    category: 'challenge',
    metric: 'challengeCompletions',
    target: 1,
  },
  {
    id: 'challenge-regular',
    name: 'Challenge Regular',
    description: 'Community Challengeを25回Clearする',
    emoji: '🧩',
    rarity: 'uncommon',
    category: 'challenge',
    metric: 'challengeCompletions',
    target: 25,
  },
  {
    id: 'challenge-master',
    name: 'Challenge Master',
    description: 'Community Challengeを100回Clearする',
    emoji: '🏆',
    rarity: 'epic',
    category: 'challenge',
    metric: 'challengeCompletions',
    target: 100,
  },
  {
    id: 'season-rising',
    name: 'Season Rising',
    description: '1つのCommunity Seasonで500 Pointを獲得する',
    emoji: '⭐',
    rarity: 'rare',
    category: 'challenge',
    metric: 'seasonPoints',
    target: 500,
  },
  {
    id: 'season-legend',
    name: 'Season Legend',
    description: '1つのCommunity Seasonで1,500 Pointを獲得する',
    emoji: '🌠',
    rarity: 'legendary',
    category: 'challenge',
    metric: 'seasonPoints',
    target: 1_500,
  },
  {
    id: 'all-rounder',
    name: 'All-Rounder',
    description: '発言・VC・リアクション・被リアクションの4分野で条件を達成する',
    emoji: '🧭',
    rarity: 'epic',
    category: 'community',
  },
  {
    id: 'community-legend',
    name: 'Community Legend',
    description: '複数のコミュニティ活動を極める',
    emoji: '🌌',
    rarity: 'legendary',
    category: 'community',
    secret: true,
  },
];

export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, AchievementDefinition> = new Map(
  ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]),
);

export const ACHIEVEMENT_RARITY_POINTS: Readonly<Record<AchievementRarity, number>> = {
  common: 10,
  uncommon: 25,
  rare: 50,
  epic: 100,
  legendary: 250,
};

export const ACHIEVEMENT_RARITY_ORDER: Readonly<Record<AchievementRarity, number>> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

export interface AchievementRaritySummary {
  rarity: AchievementRarity;
  unlocked: number;
  total: number;
}

export interface AchievementCollectionSummary {
  unlocked: number;
  total: number;
  percentage: number;
  score: number;
  rarity: AchievementRaritySummary[];
}

export function achievementPoints(achievement: AchievementDefinition): number {
  return ACHIEVEMENT_RARITY_POINTS[achievement.rarity];
}

export function achievementScoreForIds(achievementIds: readonly string[]): number {
  return [...new Set(achievementIds)].reduce((total, id) => {
    const achievement = ACHIEVEMENT_BY_ID.get(id);
    return total + (achievement ? achievementPoints(achievement) : 0);
  }, 0);
}

export function getAchievementDefinition(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_BY_ID.get(id);
}

export function summarizeAchievementCollection(
  achievementIds: readonly string[],
): AchievementCollectionSummary {
  const unlockedIds = new Set(achievementIds.filter((id) => ACHIEVEMENT_BY_ID.has(id)));
  const rarity = ACHIEVEMENT_RARITIES.map((value) => ({
    rarity: value,
    unlocked: ACHIEVEMENTS.filter(
      (achievement) => achievement.rarity === value && unlockedIds.has(achievement.id),
    ).length,
    total: ACHIEVEMENTS.filter((achievement) => achievement.rarity === value).length,
  }));
  return {
    unlocked: unlockedIds.size,
    total: ACHIEVEMENTS.length,
    percentage:
      ACHIEVEMENTS.length === 0 ? 0 : Math.floor((unlockedIds.size / ACHIEVEMENTS.length) * 100),
    score: achievementScoreForIds([...unlockedIds]),
    rarity,
  };
}

export function achievementRarityLabel(rarity: AchievementRarity): string {
  return {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary',
  }[rarity];
}

export function achievementCategoryLabel(category: AchievementCategory): string {
  return {
    xp: 'XP',
    activity: 'Activity',
    social: 'Social',
    events: 'Events',
    community: 'Community',
    minecraft: 'Minecraft',
    challenge: 'Challenge',
  }[category];
}

export function isAchievementRarity(value: unknown): value is AchievementRarity {
  return typeof value === 'string' && (ACHIEVEMENT_RARITIES as readonly string[]).includes(value);
}

export function isAchievementCategory(value: unknown): value is AchievementCategory {
  return typeof value === 'string' && (ACHIEVEMENT_CATEGORIES as readonly string[]).includes(value);
}
