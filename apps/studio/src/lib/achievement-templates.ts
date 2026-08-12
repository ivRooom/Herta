export type AchievementTemplateMetric =
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

export type AchievementTemplateRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type AchievementTemplateCondition = {
  metric: AchievementTemplateMetric;
  target: number;
};

export type AchievementTemplateStage = {
  key: string;
  name: string;
  description: string;
  emoji: string;
  rarity: AchievementTemplateRarity;
  points: number;
  secret: boolean;
  conditionMode: 'all' | 'any';
  conditions: AchievementTemplateCondition[];
  rewardRoleId: null;
  notificationChannelId: null;
};

export type AchievementTemplateSeries = {
  key: string;
  name: string;
  category: string;
  enabled: boolean;
  stages: AchievementTemplateStage[];
};

export type AchievementTemplatePack = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'starter' | 'community' | 'voice' | 'minecraft' | 'events' | 'season';
  recommended?: boolean;
  series: AchievementTemplateSeries[];
};

function stage(
  key: string,
  name: string,
  emoji: string,
  rarity: AchievementTemplateRarity,
  points: number,
  metric: AchievementTemplateMetric,
  target: number,
  description: string,
): AchievementTemplateStage {
  return {
    key,
    name,
    description,
    emoji,
    rarity,
    points,
    secret: false,
    conditionMode: 'all',
    conditions: [{ metric, target }],
    rewardRoleId: null,
    notificationChannelId: null,
  };
}

export const ACHIEVEMENT_TEMPLATE_PACKS: AchievementTemplatePack[] = [
  {
    id: 'community-starter',
    name: 'Community Starter',
    description:
      '発言・リアクション・XPを中心に、参加したばかりのメンバーが自然に解除できる定番セットです。',
    icon: '🌱',
    category: 'starter',
    recommended: true,
    series: [
      {
        key: 'community-starter-chat',
        name: 'Chat Journey',
        category: 'activity',
        enabled: true,
        stages: [
          stage(
            'hello',
            'Hello!',
            '💬',
            'common',
            25,
            'messages',
            10,
            'まずは10メッセージ。コミュニティで会話を始めよう。',
          ),
          stage(
            'regular',
            'Regular Chatter',
            '🗨️',
            'uncommon',
            50,
            'messages',
            100,
            '100メッセージを送信して常連への一歩を踏み出す。',
          ),
          stage(
            'talkative',
            'Talkative',
            '📣',
            'rare',
            100,
            'messages',
            500,
            '500メッセージを送信して会話の中心メンバーになる。',
          ),
          stage(
            'legend',
            'Chat Legend',
            '🏆',
            'epic',
            250,
            'messages',
            2000,
            '2,000メッセージを達成する。',
          ),
        ],
      },
      {
        key: 'community-starter-social',
        name: 'Reaction Explorer',
        category: 'social',
        enabled: true,
        stages: [
          stage(
            'first-reactions',
            'Reaction Rookie',
            '✨',
            'common',
            25,
            'reactionsGiven',
            10,
            '10回リアクションして会話に参加する。',
          ),
          stage(
            'supporter',
            'Supporter',
            '🙌',
            'uncommon',
            50,
            'reactionsGiven',
            100,
            '100回リアクションしてメンバーを盛り上げる。',
          ),
          stage(
            'social-star',
            'Social Star',
            '🌟',
            'rare',
            125,
            'reactionsReceived',
            250,
            '250回リアクションを受け取る。',
          ),
        ],
      },
    ],
  },
  {
    id: 'community-contributor',
    name: 'Community Contributor',
    description:
      'Suggestion・採用・Challenge達成を組み合わせ、コミュニティ改善への貢献を可視化します。',
    icon: '🤝',
    category: 'community',
    recommended: true,
    series: [
      {
        key: 'community-contributor-suggestions',
        name: 'Idea Maker',
        category: 'community',
        enabled: true,
        stages: [
          stage(
            'suggest',
            'Idea Starter',
            '💡',
            'common',
            40,
            'suggestions',
            1,
            '最初のSuggestionを投稿する。',
          ),
          stage(
            'ideas',
            'Idea Maker',
            '🧠',
            'uncommon',
            80,
            'suggestions',
            10,
            '10件のSuggestionを投稿する。',
          ),
          stage(
            'accepted',
            'Community Architect',
            '🏗️',
            'rare',
            160,
            'acceptedSuggestions',
            3,
            '3件のSuggestionが採用される。',
          ),
          stage(
            'visionary',
            'Visionary',
            '🔭',
            'epic',
            320,
            'acceptedSuggestions',
            10,
            '10件のSuggestionが採用される。',
          ),
        ],
      },
      {
        key: 'community-contributor-challenges',
        name: 'Challenge Finisher',
        category: 'challenge',
        enabled: true,
        stages: [
          stage(
            'first-clear',
            'First Clear',
            '✅',
            'common',
            30,
            'challengeCompletions',
            1,
            '最初のCommunity Challengeを達成する。',
          ),
          stage(
            'challenger',
            'Challenger',
            '🎯',
            'uncommon',
            75,
            'challengeCompletions',
            5,
            'Challengeを5回達成する。',
          ),
          stage(
            'master',
            'Challenge Master',
            '👑',
            'rare',
            180,
            'challengeCompletions',
            20,
            'Challengeを20回達成する。',
          ),
        ],
      },
    ],
  },
  {
    id: 'voice-regulars',
    name: 'Voice Regulars',
    description:
      'VC滞在時間で段階的に解除される、通話コミュニティ向けの長期Achievementセットです。',
    icon: '🎙️',
    category: 'voice',
    series: [
      {
        key: 'voice-regulars-time',
        name: 'Voice Journey',
        category: 'activity',
        enabled: true,
        stages: [
          stage(
            'first-hour',
            'First Hour',
            '🎧',
            'common',
            30,
            'voiceSeconds',
            3600,
            'VC累計1時間を達成する。',
          ),
          stage(
            'ten-hours',
            'Voice Regular',
            '🎙️',
            'uncommon',
            75,
            'voiceSeconds',
            36000,
            'VC累計10時間を達成する。',
          ),
          stage(
            'fifty-hours',
            'Late Night Crew',
            '🌙',
            'rare',
            175,
            'voiceSeconds',
            180000,
            'VC累計50時間を達成する。',
          ),
          stage(
            'hundred-hours',
            'Voice Veteran',
            '📻',
            'epic',
            350,
            'voiceSeconds',
            360000,
            'VC累計100時間を達成する。',
          ),
          stage(
            'five-hundred-hours',
            'Voice Legend',
            '👑',
            'legendary',
            750,
            'voiceSeconds',
            1800000,
            'VC累計500時間を達成する。',
          ),
        ],
      },
    ],
  },
  {
    id: 'minecraft-explorer',
    name: 'Minecraft Explorer',
    description:
      'Minecraft連携サーバー向け。プレイ時間を軸に初心者から古参まで長く追える実績を追加します。',
    icon: '⛏️',
    category: 'minecraft',
    recommended: true,
    series: [
      {
        key: 'minecraft-explorer-playtime',
        name: 'Block by Block',
        category: 'minecraft',
        enabled: true,
        stages: [
          stage(
            'one-hour',
            'First Blocks',
            '🪵',
            'common',
            35,
            'minecraftSeconds',
            3600,
            'Minecraft累計1時間を達成する。',
          ),
          stage(
            'ten-hours',
            'Settler',
            '🏠',
            'uncommon',
            80,
            'minecraftSeconds',
            36000,
            'Minecraft累計10時間を達成する。',
          ),
          stage(
            'fifty-hours',
            'Explorer',
            '🧭',
            'rare',
            180,
            'minecraftSeconds',
            180000,
            'Minecraft累計50時間を達成する。',
          ),
          stage(
            'hundred-hours',
            'Master Builder',
            '🏰',
            'epic',
            360,
            'minecraftSeconds',
            360000,
            'Minecraft累計100時間を達成する。',
          ),
          stage(
            'five-hundred-hours',
            'World Keeper',
            '🌍',
            'legendary',
            800,
            'minecraftSeconds',
            1800000,
            'Minecraft累計500時間を達成する。',
          ),
        ],
      },
    ],
  },
  {
    id: 'event-hunter',
    name: 'Event Hunter',
    description:
      'Event RSVP・Poll・Giveawayを横断して、コミュニティ企画への参加をゲーム化するセットです。',
    icon: '🎉',
    category: 'events',
    series: [
      {
        key: 'event-hunter-attendance',
        name: 'Event Hunter',
        category: 'events',
        enabled: true,
        stages: [
          stage(
            'first-event',
            'First Event',
            '🎫',
            'common',
            30,
            'eventGoing',
            1,
            '最初のイベントへ参加表明する。',
          ),
          stage(
            'regular',
            'Event Regular',
            '🎪',
            'uncommon',
            80,
            'eventGoing',
            5,
            '5回イベントへ参加表明する。',
          ),
          stage(
            'enthusiast',
            'Event Enthusiast',
            '🎆',
            'rare',
            180,
            'eventGoing',
            20,
            '20回イベントへ参加表明する。',
          ),
        ],
      },
      {
        key: 'event-hunter-participation',
        name: 'Community Participant',
        category: 'events',
        enabled: true,
        stages: [
          stage(
            'poll-voter',
            'Poll Voter',
            '🗳️',
            'common',
            25,
            'pollVotes',
            5,
            'Pollへ5回投票する。',
          ),
          stage(
            'giveaway-fan',
            'Giveaway Fan',
            '🎁',
            'uncommon',
            60,
            'giveawayEntries',
            10,
            'Giveawayへ10回参加する。',
          ),
          {
            ...stage(
              'all-rounder',
              'Community All-Rounder',
              '🎊',
              'epic',
              300,
              'eventGoing',
              10,
              'イベント・Poll・Giveawayすべてへ継続参加する。',
            ),
            conditionMode: 'all',
            conditions: [
              { metric: 'eventGoing', target: 10 },
              { metric: 'pollVotes', target: 20 },
              { metric: 'giveawayEntries', target: 10 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'season-journey',
    name: 'Season Journey',
    description:
      'Season Pointを使った長期進行向け。Season機能と組み合わせやすい5段階のProgressionです。',
    icon: '🏅',
    category: 'season',
    series: [
      {
        key: 'season-journey-points',
        name: 'Season Journey',
        category: 'season',
        enabled: true,
        stages: [
          stage(
            'bronze',
            'Bronze',
            '🥉',
            'common',
            50,
            'seasonPoints',
            100,
            'Season Pointを100pt獲得する。',
          ),
          stage(
            'silver',
            'Silver',
            '🥈',
            'uncommon',
            100,
            'seasonPoints',
            500,
            'Season Pointを500pt獲得する。',
          ),
          stage(
            'gold',
            'Gold',
            '🥇',
            'rare',
            200,
            'seasonPoints',
            1500,
            'Season Pointを1,500pt獲得する。',
          ),
          stage(
            'platinum',
            'Platinum',
            '💎',
            'epic',
            400,
            'seasonPoints',
            5000,
            'Season Pointを5,000pt獲得する。',
          ),
          stage(
            'legend',
            'Season Legend',
            '👑',
            'legendary',
            900,
            'seasonPoints',
            10000,
            'Season Pointを10,000pt獲得する。',
          ),
        ],
      },
    ],
  },
];

export function templatePackStats(pack: AchievementTemplatePack) {
  return {
    seriesCount: pack.series.length,
    stageCount: pack.series.reduce((total, item) => total + item.stages.length, 0),
    pointTotal: pack.series.reduce(
      (total, item) =>
        total + item.stages.reduce((subtotal, itemStage) => subtotal + itemStage.points, 0),
      0,
    ),
    metrics: Array.from(
      new Set(
        pack.series.flatMap((item) =>
          item.stages.flatMap((itemStage) =>
            itemStage.conditions.map((condition) => condition.metric),
          ),
        ),
      ),
    ),
  };
}

export function materializeAchievementTemplatePack(
  pack: AchievementTemplatePack,
  existingSeries: unknown[],
): AchievementTemplateSeries[] {
  const usedKeys = new Set(extractSeriesKeys(existingSeries));
  return pack.series.map((source) => {
    const key = uniqueKey(source.key, usedKeys);
    usedKeys.add(key);
    return {
      ...source,
      key,
      stages: source.stages.map((itemStage) => ({
        ...itemStage,
        conditions: itemStage.conditions.map((condition) => ({ ...condition })),
      })),
    };
  });
}

export function extractSeriesKeys(series: unknown[]): string[] {
  return series.flatMap((item) => {
    if (!isRecord(item) || typeof item.key !== 'string' || item.key.length === 0) return [];
    return [item.key];
  });
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let sequence = 2;
  while (used.has(`${base}-${sequence}`)) sequence += 1;
  return `${base}-${sequence}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
