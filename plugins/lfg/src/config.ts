export interface LfgConfig {
  maxOpenPostsPerGuild: number;
  maxOpenPostsPerChannel: number;
  creationCooldownSeconds: number;
  maxPlayersLimit: number;
  defaultMaxPlayers: number;
  gamePresets: string[];
  maxTitleLength: number;
  maxDescriptionLength: number;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
  allowUserMentions: boolean;
  retentionDays: number;
}

export interface LfgPostInput {
  channelId: string;
  game: string;
  title: string;
  description?: string | null;
  maxPlayers: number;
  startTime?: Date | null;
  durationMinutes?: number | null;
}

export interface NormalizedLfgPostInput {
  channelId: string;
  game: string;
  title: string;
  description: string;
  maxPlayers: number;
  startTime: Date | null;
  expiresAt: Date;
}

export const LFG_DEFAULTS: LfgConfig = {
  maxOpenPostsPerGuild: 50,
  maxOpenPostsPerChannel: 10,
  creationCooldownSeconds: 30,
  maxPlayersLimit: 100,
  defaultMaxPlayers: 4,
  gamePresets: [
    'Minecraft',
    'VALORANT',
    'Apex Legends',
    'Fortnite',
    'Overwatch 2',
    'League of Legends',
    'Splatoon 3',
    'Monster Hunter Wilds',
    '雑談・イベント',
  ],
  maxTitleLength: 100,
  maxDescriptionLength: 1000,
  defaultDurationMinutes: 180,
  maxDurationMinutes: 10_080,
  allowUserMentions: false,
  retentionDays: 90,
};

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const USER_MENTION_PATTERN = /<@!?\d{17,20}>/;
const ROLE_MENTION_PATTERN = /<@&\d{17,20}>/;

export class LfgValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LfgValidationError';
  }
}

export function normalizeLfgConfig(input: unknown): LfgConfig {
  const source = isRecord(input) ? input : {};
  const maxPlayersLimit = readInteger(
    source['maxPlayersLimit'],
    LFG_DEFAULTS.maxPlayersLimit,
    2,
    500,
  );
  return {
    maxOpenPostsPerGuild: readInteger(
      source['maxOpenPostsPerGuild'],
      LFG_DEFAULTS.maxOpenPostsPerGuild,
      1,
      500,
    ),
    maxOpenPostsPerChannel: readInteger(
      source['maxOpenPostsPerChannel'],
      LFG_DEFAULTS.maxOpenPostsPerChannel,
      1,
      100,
    ),
    creationCooldownSeconds: readInteger(
      source['creationCooldownSeconds'],
      LFG_DEFAULTS.creationCooldownSeconds,
      0,
      3600,
    ),
    maxPlayersLimit,
    defaultMaxPlayers: readInteger(
      source['defaultMaxPlayers'],
      Math.min(LFG_DEFAULTS.defaultMaxPlayers, maxPlayersLimit),
      2,
      maxPlayersLimit,
    ),
    gamePresets: readStringArray(source['gamePresets'], LFG_DEFAULTS.gamePresets, 30, 80),
    maxTitleLength: readInteger(source['maxTitleLength'], LFG_DEFAULTS.maxTitleLength, 1, 200),
    maxDescriptionLength: readInteger(
      source['maxDescriptionLength'],
      LFG_DEFAULTS.maxDescriptionLength,
      0,
      2000,
    ),
    defaultDurationMinutes: readInteger(
      source['defaultDurationMinutes'],
      LFG_DEFAULTS.defaultDurationMinutes,
      5,
      10_080,
    ),
    maxDurationMinutes: readInteger(
      source['maxDurationMinutes'],
      LFG_DEFAULTS.maxDurationMinutes,
      5,
      43_200,
    ),
    allowUserMentions: readBoolean(source['allowUserMentions'], LFG_DEFAULTS.allowUserMentions),
    retentionDays: readInteger(source['retentionDays'], LFG_DEFAULTS.retentionDays, 1, 3650),
  };
}

export function normalizeLfgPostInput(
  input: LfgPostInput,
  config: LfgConfig,
  now: Date = new Date(),
): NormalizedLfgPostInput {
  const channelId = input.channelId.trim();
  if (!DISCORD_SNOWFLAKE_PATTERN.test(channelId)) {
    throw new LfgValidationError('channelIdに有効なDiscordチャンネルIDを指定してください');
  }

  const game = input.game.trim();
  if (!game || game.length > 80) {
    throw new LfgValidationError('gameは1〜80文字で指定してください');
  }

  const title = input.title.trim();
  if (!title || title.length > config.maxTitleLength) {
    throw new LfgValidationError(`titleは1〜${config.maxTitleLength}文字で指定してください`);
  }

  const description = (input.description ?? '').trim();
  if (description.length > config.maxDescriptionLength) {
    throw new LfgValidationError(
      `descriptionは${config.maxDescriptionLength}文字以内で指定してください`,
    );
  }
  assertSafeLfgMentions(description, config.allowUserMentions);

  if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 2) {
    throw new LfgValidationError('maxPlayersは2以上の整数で指定してください');
  }
  if (input.maxPlayers > config.maxPlayersLimit) {
    throw new LfgValidationError(`maxPlayersは${config.maxPlayersLimit}以下で指定してください`);
  }

  const startTime = input.startTime ?? null;
  if (startTime && (!Number.isFinite(startTime.getTime()) || startTime.getTime() < now.getTime())) {
    throw new LfgValidationError('startTimeには現在以降の日時を指定してください');
  }

  const durationMinutes = input.durationMinutes ?? config.defaultDurationMinutes;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 5 ||
    durationMinutes > config.maxDurationMinutes
  ) {
    throw new LfgValidationError(
      `durationMinutesは5〜${config.maxDurationMinutes}の整数で指定してください`,
    );
  }

  const baseTime = startTime && startTime.getTime() > now.getTime() ? startTime : now;
  const expiresAt = new Date(baseTime.getTime() + durationMinutes * 60_000);

  return {
    channelId,
    game,
    title,
    description,
    maxPlayers: input.maxPlayers,
    startTime,
    expiresAt,
  };
}

export function assertSafeLfgMentions(content: string, allowUserMentions: boolean): void {
  if (content.includes('@everyone') || content.includes('@here')) {
    throw new LfgValidationError('@everyoneと@hereは使用できません');
  }
  if (ROLE_MENTION_PATTERN.test(content)) {
    throw new LfgValidationError('ロールメンションは使用できません');
  }
  if (!allowUserMentions && USER_MENTION_PATTERN.test(content)) {
    throw new LfgValidationError('ユーザーメンションはPlugin設定で許可されていません');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(
  value: unknown,
  fallback: string[],
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!normalized || normalized.length > maxLength || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
