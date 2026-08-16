export const BOT_PRESENCE_EVENT_CHANNEL = 'herta:bot-presence:update';

export const BOT_PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'invisible'] as const;
export type BotPresenceStatus = (typeof BOT_PRESENCE_STATUSES)[number];

export const BOT_ACTIVITY_TYPES = ['playing', 'listening', 'watching', 'competing'] as const;
export type BotActivityType = (typeof BOT_ACTIVITY_TYPES)[number];

export const BOT_PRESENCE_MEDIA_PROVIDERS = ['spotify', 'youtube', 'prime-video'] as const;
export type BotPresenceMediaProvider = (typeof BOT_PRESENCE_MEDIA_PROVIDERS)[number];

export interface BotPresenceMedia {
  provider: BotPresenceMediaProvider;
  providerId: string;
  title: string;
  creator: string;
  artworkUrl: string | null;
  externalUrl: string | null;
}

export interface BotPresenceConfig {
  status: BotPresenceStatus;
  activityType: BotActivityType;
  activityText: string;
  media?: BotPresenceMedia | null;
}

export interface BotPresenceUpdateEvent {
  version: 1;
  config: BotPresenceConfig;
  occurredAt: string;
}

export const DEFAULT_BOT_PRESENCE_CONFIG: BotPresenceConfig = {
  status: 'online',
  activityType: 'playing',
  activityText: 'Herta',
  media: null,
};

const STATUS_SET = new Set<string>(BOT_PRESENCE_STATUSES);
const ACTIVITY_TYPE_SET = new Set<string>(BOT_ACTIVITY_TYPES);
const MEDIA_PROVIDER_SET = new Set<string>(BOT_PRESENCE_MEDIA_PROVIDERS);

const MEDIA_ACTIVITY_TYPE: Readonly<Record<BotPresenceMediaProvider, BotActivityType>> = {
  spotify: 'listening',
  youtube: 'watching',
  'prime-video': 'watching',
};

export function isBotPresenceMediaCompatible(
  activityType: BotActivityType,
  provider: BotPresenceMediaProvider,
): boolean {
  return MEDIA_ACTIVITY_TYPE[provider] === activityType;
}

export function parseBotPresenceConfig(value: unknown): BotPresenceConfig | null {
  if (!isRecord(value)) return null;

  const status = value.status;
  const activityType = value.activityType;
  const activityText = typeof value.activityText === 'string' ? value.activityText.trim() : '';
  const hasMedia = Object.prototype.hasOwnProperty.call(value, 'media');
  const media =
    value.media === undefined || value.media === null ? null : parseBotPresenceMedia(value.media);

  if (typeof status !== 'string' || !STATUS_SET.has(status)) return null;
  if (typeof activityType !== 'string' || !ACTIVITY_TYPE_SET.has(activityType)) return null;
  if (activityText.length < 1 || activityText.length > 128) return null;
  if (value.media !== undefined && value.media !== null && !media) return null;

  const normalizedActivityType = activityType as BotActivityType;
  if (media && !isBotPresenceMediaCompatible(normalizedActivityType, media.provider)) return null;

  const config: BotPresenceConfig = {
    status: status as BotPresenceStatus,
    activityType: normalizedActivityType,
    activityText,
  };
  if (hasMedia) config.media = media;
  return config;
}

export function normalizeBotPresenceConfig(value: unknown): BotPresenceConfig {
  return parseBotPresenceConfig(value) ?? { ...DEFAULT_BOT_PRESENCE_CONFIG };
}

export function createBotPresenceUpdateEvent(config: BotPresenceConfig): BotPresenceUpdateEvent {
  return {
    version: 1,
    config,
    occurredAt: new Date().toISOString(),
  };
}

export function parseBotPresenceUpdateEvent(payload: string): BotPresenceUpdateEvent | null {
  if (payload.length > 4_096) return null;

  try {
    const value = JSON.parse(payload) as unknown;
    if (!isRecord(value) || value.version !== 1 || typeof value.occurredAt !== 'string') {
      return null;
    }
    if (!Number.isFinite(Date.parse(value.occurredAt))) return null;

    const config = parseBotPresenceConfig(value.config);
    if (!config) return null;

    return { version: 1, config, occurredAt: value.occurredAt };
  } catch {
    return null;
  }
}

function parseBotPresenceMedia(value: unknown): BotPresenceMedia | null {
  if (!isRecord(value)) return null;
  const provider = value.provider;
  const providerId = normalizeString(value.providerId, 200);
  const title = normalizeString(value.title, 200);
  const creator = normalizeString(value.creator, 200, true);
  const artworkUrl = normalizeHttpsUrl(value.artworkUrl);
  const externalUrl = normalizeHttpsUrl(value.externalUrl);

  if (typeof provider !== 'string' || !MEDIA_PROVIDER_SET.has(provider)) return null;
  if (!providerId || !title || creator === null) return null;
  if (value.artworkUrl !== null && value.artworkUrl !== undefined && artworkUrl === null)
    return null;
  if (value.externalUrl !== null && value.externalUrl !== undefined && externalUrl === null)
    return null;

  return {
    provider: provider as BotPresenceMediaProvider,
    providerId,
    title,
    creator,
    artworkUrl,
    externalUrl,
  };
}

function normalizeString(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if ((!allowEmpty && normalized.length === 0) || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeHttpsUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
