export type TeamSplitMode = 'random' | 'balanced';

export interface TeamSplitConfig {
  maxOpenSessionsPerGuild: number;
  maxOpenSessionsPerChannel: number;
  creationCooldownSeconds: number;
  maxParticipantsLimit: number;
  maxTeamCount: number;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
  maxTitleLength: number;
  retentionDays: number;
}

export interface TeamSplitSessionInput {
  channelId: string;
  title: string;
  mode: TeamSplitMode;
  teamCount: number;
  maxParticipants: number;
  durationMinutes?: number | null;
  seed?: string | null;
}

export interface NormalizedTeamSplitSessionInput {
  channelId: string;
  title: string;
  mode: TeamSplitMode;
  teamCount: number;
  maxParticipants: number;
  expiresAt: Date;
  requestedSeed: string;
}

export const TEAM_SPLIT_DEFAULTS: TeamSplitConfig = {
  maxOpenSessionsPerGuild: 20,
  maxOpenSessionsPerChannel: 5,
  creationCooldownSeconds: 30,
  maxParticipantsLimit: 100,
  maxTeamCount: 10,
  defaultDurationMinutes: 60,
  maxDurationMinutes: 1440,
  maxTitleLength: 100,
  retentionDays: 90,
};

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const ROLE_MENTION_PATTERN = /<@&\d{17,20}>/;
const USER_MENTION_PATTERN = /<@!?\d{17,20}>/;

export class TeamSplitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamSplitValidationError';
  }
}

export function normalizeTeamSplitConfig(input: unknown): TeamSplitConfig {
  const source = isRecord(input) ? input : {};
  return {
    maxOpenSessionsPerGuild: readInteger(
      source['maxOpenSessionsPerGuild'],
      TEAM_SPLIT_DEFAULTS.maxOpenSessionsPerGuild,
      1,
      200,
    ),
    maxOpenSessionsPerChannel: readInteger(
      source['maxOpenSessionsPerChannel'],
      TEAM_SPLIT_DEFAULTS.maxOpenSessionsPerChannel,
      1,
      50,
    ),
    creationCooldownSeconds: readInteger(
      source['creationCooldownSeconds'],
      TEAM_SPLIT_DEFAULTS.creationCooldownSeconds,
      0,
      3600,
    ),
    maxParticipantsLimit: readInteger(
      source['maxParticipantsLimit'],
      TEAM_SPLIT_DEFAULTS.maxParticipantsLimit,
      2,
      500,
    ),
    maxTeamCount: readInteger(
      source['maxTeamCount'],
      TEAM_SPLIT_DEFAULTS.maxTeamCount,
      2,
      50,
    ),
    defaultDurationMinutes: readInteger(
      source['defaultDurationMinutes'],
      TEAM_SPLIT_DEFAULTS.defaultDurationMinutes,
      5,
      10080,
    ),
    maxDurationMinutes: readInteger(
      source['maxDurationMinutes'],
      TEAM_SPLIT_DEFAULTS.maxDurationMinutes,
      5,
      43200,
    ),
    maxTitleLength: readInteger(
      source['maxTitleLength'],
      TEAM_SPLIT_DEFAULTS.maxTitleLength,
      1,
      200,
    ),
    retentionDays: readInteger(
      source['retentionDays'],
      TEAM_SPLIT_DEFAULTS.retentionDays,
      1,
      3650,
    ),
  };
}

export function normalizeTeamSplitSessionInput(
  input: TeamSplitSessionInput,
  config: TeamSplitConfig,
  now: Date = new Date(),
): NormalizedTeamSplitSessionInput {
  const channelId = input.channelId.trim();
  if (!DISCORD_SNOWFLAKE_PATTERN.test(channelId)) {
    throw new TeamSplitValidationError('channelIdに有効なDiscordチャンネルIDを指定してください');
  }

  const title = input.title.trim();
  if (!title || title.length > config.maxTitleLength) {
    throw new TeamSplitValidationError(`titleは1〜${config.maxTitleLength}文字で指定してください`);
  }
  assertSafeTeamSplitText(title);

  if (input.mode !== 'random' && input.mode !== 'balanced') {
    throw new TeamSplitValidationError('modeはrandomまたはbalancedを指定してください');
  }
  if (!Number.isInteger(input.teamCount) || input.teamCount < 2 || input.teamCount > config.maxTeamCount) {
    throw new TeamSplitValidationError(`teamCountは2〜${config.maxTeamCount}の整数で指定してください`);
  }
  if (
    !Number.isInteger(input.maxParticipants) ||
    input.maxParticipants < input.teamCount ||
    input.maxParticipants > config.maxParticipantsLimit
  ) {
    throw new TeamSplitValidationError(
      `maxParticipantsはteamCount以上かつ${config.maxParticipantsLimit}以下の整数で指定してください`,
    );
  }

  const durationMinutes = input.durationMinutes ?? config.defaultDurationMinutes;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 5 ||
    durationMinutes > config.maxDurationMinutes
  ) {
    throw new TeamSplitValidationError(
      `durationMinutesは5〜${config.maxDurationMinutes}の整数で指定してください`,
    );
  }

  const requestedSeed = (input.seed ?? '').trim();
  if (requestedSeed.length > 128) {
    throw new TeamSplitValidationError('seedは128文字以内で指定してください');
  }
  if (requestedSeed) assertSafeTeamSplitText(requestedSeed);

  return {
    channelId,
    title,
    mode: input.mode,
    teamCount: input.teamCount,
    maxParticipants: input.maxParticipants,
    expiresAt: new Date(now.getTime() + durationMinutes * 60_000),
    requestedSeed,
  };
}

export function normalizeParticipantScore(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (!Number.isInteger(value) || value < -100000 || value > 100000) {
    throw new TeamSplitValidationError('scoreは-100000〜100000の整数で指定してください');
  }
  return value;
}

export function assertSafeTeamSplitText(value: string): void {
  if (value.includes('@everyone') || value.includes('@here')) {
    throw new TeamSplitValidationError('@everyoneと@hereは使用できません');
  }
  if (ROLE_MENTION_PATTERN.test(value) || USER_MENTION_PATTERN.test(value)) {
    throw new TeamSplitValidationError('メンションは使用できません');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
