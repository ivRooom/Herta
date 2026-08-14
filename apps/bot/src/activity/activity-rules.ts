const DISCORD_ID_PATTERN = /^\d+$/;
const DEFAULT_COMMAND_PREFIXES = ['/', '!'] as const;

export interface ActivityRulesConfig {
  excludedTextChannelIds: string[];
  excludedVoiceChannelIds: string[];
  excludedRoleIds: string[];
  messageCooldownSeconds: number;
  minimumMessageLength: number;
  excludeCommandMessages: boolean;
  commandPrefixes: string[];
  applyMessageRulesToXp: boolean;
  countReactionsGiven: boolean;
  countReactionsReceived: boolean;
  countSelfMutedVoice: boolean;
  countServerMutedVoice: boolean;
  countSelfDeafenedVoice: boolean;
  countServerDeafenedVoice: boolean;
}

export interface MessageActivityCandidate {
  channelId: string;
  roleIds?: readonly string[];
  contentLength?: number;
  content?: string;
  contentAvailable: boolean;
}

export interface VoiceActivityCandidate {
  channelId: string | null;
  roleIds?: readonly string[];
  selfMute?: boolean | null;
  serverMute?: boolean | null;
  selfDeaf?: boolean | null;
  serverDeaf?: boolean | null;
}

export function normalizeActivityRulesConfig(value: unknown): ActivityRulesConfig {
  const source = isRecord(value) ? value : {};
  return {
    excludedTextChannelIds: normalizedIds(source.excludedTextChannelIds, 50),
    excludedVoiceChannelIds: normalizedIds(source.excludedVoiceChannelIds, 50),
    excludedRoleIds: normalizedIds(source.excludedRoleIds, 50),
    messageCooldownSeconds: clamp(toInteger(source.messageCooldownSeconds, 0), 0, 300),
    minimumMessageLength: clamp(toInteger(source.minimumMessageLength, 0), 0, 200),
    excludeCommandMessages: source.excludeCommandMessages === true,
    commandPrefixes: normalizedCommandPrefixes(source.commandPrefixes),
    applyMessageRulesToXp: source.applyMessageRulesToXp === true,
    countReactionsGiven:
      source.countReactionsGiven === undefined ? true : source.countReactionsGiven === true,
    countReactionsReceived:
      source.countReactionsReceived === undefined ? true : source.countReactionsReceived === true,
    countSelfMutedVoice:
      source.countSelfMutedVoice === undefined ? true : source.countSelfMutedVoice === true,
    countServerMutedVoice:
      source.countServerMutedVoice === undefined ? true : source.countServerMutedVoice === true,
    countSelfDeafenedVoice:
      source.countSelfDeafenedVoice === undefined ? true : source.countSelfDeafenedVoice === true,
    countServerDeafenedVoice:
      source.countServerDeafenedVoice === undefined
        ? true
        : source.countServerDeafenedVoice === true,
  };
}

export function shouldCountMessage(
  config: ActivityRulesConfig,
  candidate: MessageActivityCandidate,
): boolean {
  if (config.excludedTextChannelIds.includes(candidate.channelId)) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  if (
    config.excludeCommandMessages &&
    candidate.contentAvailable &&
    isCommandLikeMessage(candidate.content ?? '', config.commandPrefixes)
  ) {
    return false;
  }
  if (
    config.minimumMessageLength > 0 &&
    candidate.contentAvailable &&
    (candidate.contentLength ?? 0) < config.minimumMessageLength
  ) {
    return false;
  }
  return true;
}

export function shouldCountVoice(
  config: ActivityRulesConfig,
  candidate: VoiceActivityCandidate,
): boolean {
  if (!candidate.channelId) return false;
  if (config.excludedVoiceChannelIds.includes(candidate.channelId)) return false;
  if (hasExcludedRole(config, candidate.roleIds)) return false;
  if (!config.countSelfMutedVoice && candidate.selfMute) return false;
  if (!config.countServerMutedVoice && candidate.serverMute) return false;
  if (!config.countSelfDeafenedVoice && candidate.selfDeaf) return false;
  if (!config.countServerDeafenedVoice && candidate.serverDeaf) return false;
  return true;
}

export function hasMessageCooldownElapsed(
  config: ActivityRulesConfig,
  lastCountedAt: number | undefined,
  now = Date.now(),
): boolean {
  if (config.messageCooldownSeconds <= 0 || lastCountedAt === undefined) return true;
  return now - lastCountedAt >= config.messageCooldownSeconds * 1_000;
}

function isCommandLikeMessage(content: string, prefixes: readonly string[]): boolean {
  const normalized = content.trimStart();
  if (!normalized) return false;
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function hasExcludedRole(config: ActivityRulesConfig, roleIds?: readonly string[]): boolean {
  if (!roleIds?.length || config.excludedRoleIds.length === 0) return false;
  return roleIds.some((roleId) => config.excludedRoleIds.includes(roleId));
}

function normalizedIds(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === 'string' && DISCORD_ID_PATTERN.test(item),
      ),
    ),
  ].slice(0, maxItems);
}

function normalizedCommandPrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_COMMAND_PREFIXES];
  const prefixes = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 5 && !/\s/u.test(item)),
    ),
  ].slice(0, 10);
  return prefixes.length > 0 ? prefixes : [...DEFAULT_COMMAND_PREFIXES];
}

function toInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
