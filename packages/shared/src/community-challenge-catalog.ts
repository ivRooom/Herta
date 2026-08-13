export const COMMUNITY_CHALLENGE_PERIODS = ['daily', 'weekly'] as const;
export const COMMUNITY_CHALLENGE_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export const COMMUNITY_CHALLENGE_METRICS = [
  'messages',
  'reactions_given',
  'reactions_received',
  'voice_seconds',
  'minecraft_seconds',
  'minigame_plays',
  'minigame_wins',
  'highlow_round_wins',
  'blackjack_wins',
] as const;

export type CommunityChallengePeriod = (typeof COMMUNITY_CHALLENGE_PERIODS)[number];
export type CommunityChallengeDifficulty = (typeof COMMUNITY_CHALLENGE_DIFFICULTIES)[number];
export type CommunityChallengeMetric = (typeof COMMUNITY_CHALLENGE_METRICS)[number];

export interface CommunityChallengeDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  period: CommunityChallengePeriod;
  metric: CommunityChallengeMetric;
  target: number;
  basePoints: number;
  difficulty: CommunityChallengeDifficulty;
}

export interface CommunityChallengeWindow {
  key: string;
  startDateKey: string;
  endDateKey: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CommunitySeasonWindow extends CommunityChallengeWindow {
  index: number;
}

export interface CommunityChallengeSelectionInput {
  guildId: string;
  period: CommunityChallengePeriod;
  periodKey: string;
  count: number;
  includeMinecraft: boolean;
  includeMiniGames?: boolean;
}

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60_000;
const SEASON_LENGTH_DAYS = 28;
const SEASON_EPOCH_DATE_KEY = '2026-01-05';
const SEASON_EPOCH_MS = Date.parse(`${SEASON_EPOCH_DATE_KEY}T00:00:00+09:00`);

export const COMMUNITY_CHALLENGES: readonly CommunityChallengeDefinition[] = [
  // Daily / Messages
  challenge(
    'daily-hello-there',
    'Hello There',
    '集計対象メッセージを5件送信する',
    '👋',
    'daily',
    'messages',
    5,
    10,
    'easy',
  ),
  challenge(
    'daily-conversation-starter',
    'Conversation Starter',
    '集計対象メッセージを15件送信する',
    '💬',
    'daily',
    'messages',
    15,
    15,
    'normal',
  ),
  challenge(
    'daily-chat-sprint',
    'Chat Sprint',
    '集計対象メッセージを30件送信する',
    '🏃',
    'daily',
    'messages',
    30,
    25,
    'hard',
  ),

  // Daily / Reactions Given
  challenge(
    'daily-emoji-wave',
    'Emoji Wave',
    'リアクションを5回付ける',
    '✨',
    'daily',
    'reactions_given',
    5,
    10,
    'easy',
  ),
  challenge(
    'daily-social-spark',
    'Social Spark',
    'リアクションを15回付ける',
    '🌟',
    'daily',
    'reactions_given',
    15,
    15,
    'normal',
  ),
  challenge(
    'daily-reaction-rush',
    'Reaction Rush',
    'リアクションを30回付ける',
    '🎇',
    'daily',
    'reactions_given',
    30,
    25,
    'hard',
  ),

  // Daily / Reactions Received
  challenge(
    'daily-getting-noticed',
    'Getting Noticed',
    '自分の投稿にリアクションを3回もらう',
    '💜',
    'daily',
    'reactions_received',
    3,
    10,
    'easy',
  ),
  challenge(
    'daily-appreciated',
    'Appreciated',
    '自分の投稿にリアクションを10回もらう',
    '💖',
    'daily',
    'reactions_received',
    10,
    15,
    'normal',
  ),
  challenge(
    'daily-crowd-energy',
    'Crowd Energy',
    '自分の投稿にリアクションを20回もらう',
    '🌈',
    'daily',
    'reactions_received',
    20,
    25,
    'hard',
  ),

  // Daily / Voice
  challenge(
    'daily-voice-drop-in',
    'Voice Drop-In',
    'VCで10分活動する',
    '🎙️',
    'daily',
    'voice_seconds',
    600,
    10,
    'easy',
  ),
  challenge(
    'daily-voice-session',
    'Voice Session',
    'VCで30分活動する',
    '🎧',
    'daily',
    'voice_seconds',
    1_800,
    15,
    'normal',
  ),
  challenge(
    'daily-voice-marathon',
    'Voice Marathon',
    'VCで1時間活動する',
    '📻',
    'daily',
    'voice_seconds',
    3_600,
    25,
    'hard',
  ),

  // Daily / Minecraft
  challenge(
    'daily-block-break',
    'Block Break',
    'Minecraftを30分プレイする',
    '⛏️',
    'daily',
    'minecraft_seconds',
    1_800,
    15,
    'easy',
  ),
  challenge(
    'daily-mining-session',
    'Mining Session',
    'Minecraftを1時間プレイする',
    '🧱',
    'daily',
    'minecraft_seconds',
    3_600,
    20,
    'normal',
  ),
  challenge(
    'daily-minecraft-adventure',
    'Minecraft Adventure',
    'Minecraftを2時間プレイする',
    '🏕️',
    'daily',
    'minecraft_seconds',
    7_200,
    30,
    'hard',
  ),

  // Weekly / Messages
  challenge(
    'weekly-community-check-in',
    'Community Check-In',
    '1週間でメッセージを50件送信する',
    '🗨️',
    'weekly',
    'messages',
    50,
    40,
    'easy',
  ),
  challenge(
    'weekly-chat-regular',
    'Chat Regular',
    '1週間でメッセージを150件送信する',
    '🗣️',
    'weekly',
    'messages',
    150,
    60,
    'normal',
  ),
  challenge(
    'weekly-conversation-engine',
    'Conversation Engine',
    '1週間でメッセージを300件送信する',
    '🚂',
    'weekly',
    'messages',
    300,
    100,
    'hard',
  ),

  // Weekly / Reactions Given
  challenge(
    'weekly-supporter',
    'Supporter',
    '1週間でリアクションを30回付ける',
    '🙌',
    'weekly',
    'reactions_given',
    30,
    40,
    'easy',
  ),
  challenge(
    'weekly-hype-squad',
    'Hype Squad',
    '1週間でリアクションを100回付ける',
    '🎉',
    'weekly',
    'reactions_given',
    100,
    60,
    'normal',
  ),
  challenge(
    'weekly-reaction-engine',
    'Reaction Engine',
    '1週間でリアクションを200回付ける',
    '⚙️',
    'weekly',
    'reactions_given',
    200,
    100,
    'hard',
  ),

  // Weekly / Reactions Received
  challenge(
    'weekly-community-love',
    'Community Love',
    '1週間でリアクションを20回もらう',
    '💗',
    'weekly',
    'reactions_received',
    20,
    40,
    'easy',
  ),
  challenge(
    'weekly-crowd-favorite',
    'Crowd Favorite',
    '1週間でリアクションを60回もらう',
    '🌟',
    'weekly',
    'reactions_received',
    60,
    60,
    'normal',
  ),
  challenge(
    'weekly-beloved-contributor',
    'Beloved Contributor',
    '1週間でリアクションを120回もらう',
    '💞',
    'weekly',
    'reactions_received',
    120,
    100,
    'hard',
  ),

  // Weekly / Voice
  challenge(
    'weekly-voice-regular',
    'Voice Regular',
    '1週間でVCを2時間利用する',
    '🎤',
    'weekly',
    'voice_seconds',
    7_200,
    40,
    'easy',
  ),
  challenge(
    'weekly-voice-enthusiast',
    'Voice Enthusiast',
    '1週間でVCを5時間利用する',
    '🎚️',
    'weekly',
    'voice_seconds',
    18_000,
    60,
    'normal',
  ),
  challenge(
    'weekly-voice-veteran',
    'Voice Veteran',
    '1週間でVCを10時間利用する',
    '📡',
    'weekly',
    'voice_seconds',
    36_000,
    100,
    'hard',
  ),

  // Weekly / Minecraft
  challenge(
    'weekly-minecraft-explorer',
    'Minecraft Explorer',
    '1週間でMinecraftを3時間プレイする',
    '🗺️',
    'weekly',
    'minecraft_seconds',
    10_800,
    50,
    'easy',
  ),
  challenge(
    'weekly-minecraft-regular',
    'Minecraft Regular',
    '1週間でMinecraftを8時間プレイする',
    '🧭',
    'weekly',
    'minecraft_seconds',
    28_800,
    75,
    'normal',
  ),
  challenge(
    'weekly-minecraft-veteran',
    'Minecraft Veteran',
    '1週間でMinecraftを15時間プレイする',
    '🏰',
    'weekly',
    'minecraft_seconds',
    54_000,
    120,
    'hard',
  ),

  // Daily / Mini Games
  challenge(
    'daily-arcade-break',
    'Arcade Break',
    'Mini Gameを2回プレイする',
    '🎮',
    'daily',
    'minigame_plays',
    2,
    10,
    'easy',
  ),
  challenge(
    'daily-arcade-session',
    'Arcade Session',
    'Mini Gameを5回プレイする',
    '🕹️',
    'daily',
    'minigame_plays',
    5,
    15,
    'normal',
  ),
  challenge(
    'daily-arcade-marathon',
    'Arcade Marathon',
    'Mini Gameを10回プレイする',
    '👾',
    'daily',
    'minigame_plays',
    10,
    25,
    'hard',
  ),
  challenge(
    'daily-lucky-win',
    'Lucky Win',
    'Mini Gameで1回勝利する',
    '🍀',
    'daily',
    'minigame_wins',
    1,
    10,
    'easy',
  ),
  challenge(
    'daily-winning-hand',
    'Winning Hand',
    'Mini Gameで3回勝利する',
    '🏅',
    'daily',
    'minigame_wins',
    3,
    20,
    'normal',
  ),
  challenge(
    'daily-win-streak',
    'Win Streak',
    'Mini Gameで5回勝利する',
    '🔥',
    'daily',
    'minigame_wins',
    5,
    30,
    'hard',
  ),
  challenge(
    'daily-highlow-warmup',
    'High-Low Warmup',
    'High-Lowで合計3Round正解する',
    '🎴',
    'daily',
    'highlow_round_wins',
    3,
    10,
    'easy',
  ),
  challenge(
    'daily-highlow-reader',
    'Card Reader',
    'High-Lowで合計8Round正解する',
    '🔮',
    'daily',
    'highlow_round_wins',
    8,
    20,
    'normal',
  ),
  challenge(
    'daily-highlow-run',
    'High-Low Run',
    'High-Lowで合計15Round正解する',
    '🃏',
    'daily',
    'highlow_round_wins',
    15,
    30,
    'hard',
  ),
  challenge(
    'daily-blackjack-win',
    'Twenty-One',
    'Blackjackで1回勝利する',
    '♠️',
    'daily',
    'blackjack_wins',
    1,
    15,
    'easy',
  ),
  challenge(
    'daily-blackjack-table',
    'Blackjack Table',
    'Blackjackで2回勝利する',
    '♦️',
    'daily',
    'blackjack_wins',
    2,
    20,
    'normal',
  ),
  challenge(
    'daily-blackjack-shark',
    'Table Shark',
    'Blackjackで4回勝利する',
    '🦈',
    'daily',
    'blackjack_wins',
    4,
    35,
    'hard',
  ),

  // Weekly / Mini Games
  challenge(
    'weekly-arcade-regular',
    'Arcade Regular',
    '1週間でMini Gameを15回プレイする',
    '🎮',
    'weekly',
    'minigame_plays',
    15,
    40,
    'easy',
  ),
  challenge(
    'weekly-arcade-fan',
    'Arcade Fan',
    '1週間でMini Gameを35回プレイする',
    '🕹️',
    'weekly',
    'minigame_plays',
    35,
    60,
    'normal',
  ),
  challenge(
    'weekly-arcade-veteran',
    'Arcade Veteran',
    '1週間でMini Gameを70回プレイする',
    '👾',
    'weekly',
    'minigame_plays',
    70,
    100,
    'hard',
  ),
  challenge(
    'weekly-winner',
    'Winning Week',
    '1週間でMini Gameに8回勝利する',
    '🏅',
    'weekly',
    'minigame_wins',
    8,
    45,
    'easy',
  ),
  challenge(
    'weekly-champion',
    'Weekly Champion',
    '1週間でMini Gameに20回勝利する',
    '🏆',
    'weekly',
    'minigame_wins',
    20,
    70,
    'normal',
  ),
  challenge(
    'weekly-arcade-ace',
    'Arcade Ace',
    '1週間でMini Gameに40回勝利する',
    '🌟',
    'weekly',
    'minigame_wins',
    40,
    120,
    'hard',
  ),
  challenge(
    'weekly-highlow-climber',
    'High-Low Climber',
    '1週間でHigh-Lowを25Round正解する',
    '🎴',
    'weekly',
    'highlow_round_wins',
    25,
    45,
    'easy',
  ),
  challenge(
    'weekly-highlow-reader',
    'Card Reader Pro',
    '1週間でHigh-Lowを60Round正解する',
    '🔮',
    'weekly',
    'highlow_round_wins',
    60,
    70,
    'normal',
  ),
  challenge(
    'weekly-highlow-master',
    'High-Low Master',
    '1週間でHigh-Lowを120Round正解する',
    '🃏',
    'weekly',
    'highlow_round_wins',
    120,
    120,
    'hard',
  ),
  challenge(
    'weekly-blackjack-regular',
    'Blackjack Regular',
    '1週間でBlackjackに5回勝利する',
    '♠️',
    'weekly',
    'blackjack_wins',
    5,
    50,
    'easy',
  ),
  challenge(
    'weekly-blackjack-pro',
    'Blackjack Pro',
    '1週間でBlackjackに12回勝利する',
    '♦️',
    'weekly',
    'blackjack_wins',
    12,
    80,
    'normal',
  ),
  challenge(
    'weekly-blackjack-shark',
    'Blackjack Shark',
    '1週間でBlackjackに25回勝利する',
    '🦈',
    'weekly',
    'blackjack_wins',
    25,
    130,
    'hard',
  ),
];

export const COMMUNITY_CHALLENGE_BY_ID = new Map(
  COMMUNITY_CHALLENGES.map((definition) => [definition.id, definition]),
);

export function selectCommunityChallenges(
  input: CommunityChallengeSelectionInput,
): CommunityChallengeDefinition[] {
  const safeCount = Math.max(1, Math.min(5, Math.trunc(input.count)));
  const definitions = COMMUNITY_CHALLENGES.filter(
    (definition) =>
      definition.period === input.period &&
      (input.includeMinecraft || definition.metric !== 'minecraft_seconds') &&
      (input.includeMiniGames === true || !isMiniGameChallengeMetric(definition.metric)),
  );
  const groups = new Map<CommunityChallengeMetric, CommunityChallengeDefinition[]>();
  for (const definition of definitions) {
    const group = groups.get(definition.metric) ?? [];
    group.push(definition);
    groups.set(definition.metric, group);
  }

  const seed = `${input.guildId}:${input.period}:${input.periodKey}`;
  const metrics = [...groups.keys()].sort(
    (left, right) => stableHash(`${seed}:metric:${left}`) - stableHash(`${seed}:metric:${right}`),
  );

  return metrics.slice(0, Math.min(safeCount, metrics.length)).map((metric) => {
    const group = groups.get(metric)!;
    const index = stableHash(`${seed}:variant:${metric}`) % group.length;
    return group[index]!;
  });
}

export function getCommunityChallengeWindow(
  period: CommunityChallengePeriod,
  now = new Date(),
): CommunityChallengeWindow {
  const local = new Date(now.getTime() + JST_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  if (period === 'weekly') {
    const day = local.getUTCDay();
    const sinceMonday = (day + 6) % 7;
    local.setUTCDate(local.getUTCDate() - sinceMonday);
  }
  const lengthDays = period === 'daily' ? 1 : 7;
  const startDateKey = local.toISOString().slice(0, 10);
  const endLocal = new Date(local.getTime() + lengthDays * DAY_MS);
  const endDateKey = endLocal.toISOString().slice(0, 10);
  return {
    key: startDateKey,
    startDateKey,
    endDateKey,
    startsAt: new Date(`${startDateKey}T00:00:00+09:00`),
    endsAt: new Date(`${endDateKey}T00:00:00+09:00`),
  };
}

export function getCommunitySeasonWindow(now = new Date()): CommunitySeasonWindow {
  const day = getCommunityChallengeWindow('daily', now);
  const dayStartMs = day.startsAt.getTime();
  const rawIndex = Math.floor((dayStartMs - SEASON_EPOCH_MS) / (SEASON_LENGTH_DAYS * DAY_MS));
  const index = Math.max(0, rawIndex);
  const startsAt = new Date(SEASON_EPOCH_MS + index * SEASON_LENGTH_DAYS * DAY_MS);
  const endsAt = new Date(startsAt.getTime() + SEASON_LENGTH_DAYS * DAY_MS);
  const startDateKey = toJstDateKey(startsAt);
  const endDateKey = toJstDateKey(endsAt);
  return {
    key: startDateKey,
    index: index + 1,
    startDateKey,
    endDateKey,
    startsAt,
    endsAt,
  };
}

export function communitySeasonLevel(points: number, pointsPerLevel = 100): number {
  const safePoints = Math.max(0, Math.floor(points));
  const safeStep = Math.max(1, Math.floor(pointsPerLevel));
  return Math.floor(safePoints / safeStep) + 1;
}

export function communitySeasonLevelProgress(
  points: number,
  pointsPerLevel = 100,
): { level: number; current: number; needed: number; percentage: number } {
  const safePoints = Math.max(0, Math.floor(points));
  const safeStep = Math.max(1, Math.floor(pointsPerLevel));
  const current = safePoints % safeStep;
  return {
    level: communitySeasonLevel(safePoints, safeStep),
    current,
    needed: safeStep,
    percentage: Math.floor((current / safeStep) * 100),
  };
}

export function communityChallengeMetricLabel(metric: CommunityChallengeMetric): string {
  switch (metric) {
    case 'messages':
      return 'Messages';
    case 'reactions_given':
      return 'Reactions Given';
    case 'reactions_received':
      return 'Reactions Received';
    case 'voice_seconds':
      return 'Voice';
    case 'minecraft_seconds':
      return 'Minecraft';
    case 'minigame_plays':
      return 'Mini Game Plays';
    case 'minigame_wins':
      return 'Mini Game Wins';
    case 'highlow_round_wins':
      return 'High-Low Round Wins';
    case 'blackjack_wins':
      return 'Blackjack Wins';
  }
}

export function communityChallengeDifficultyLabel(
  difficulty: CommunityChallengeDifficulty,
): string {
  switch (difficulty) {
    case 'easy':
      return 'Easy';
    case 'normal':
      return 'Normal';
    case 'hard':
      return 'Hard';
  }
}

export function formatCommunityChallengeValue(
  metric: CommunityChallengeMetric,
  value: number,
): string {
  const safe = Math.max(0, Math.floor(value));
  if (metric === 'voice_seconds' || metric === 'minecraft_seconds') {
    const hours = Math.floor(safe / 3_600);
    const minutes = Math.floor((safe % 3_600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  return safe.toLocaleString();
}

function isMiniGameChallengeMetric(metric: CommunityChallengeMetric): boolean {
  return (
    metric === 'minigame_plays' ||
    metric === 'minigame_wins' ||
    metric === 'highlow_round_wins' ||
    metric === 'blackjack_wins'
  );
}

function challenge(
  id: string,
  name: string,
  description: string,
  emoji: string,
  period: CommunityChallengePeriod,
  metric: CommunityChallengeMetric,
  target: number,
  basePoints: number,
  difficulty: CommunityChallengeDifficulty,
): CommunityChallengeDefinition {
  return { id, name, description, emoji, period, metric, target, basePoints, difficulty };
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function toJstDateKey(value: Date): string {
  return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}
