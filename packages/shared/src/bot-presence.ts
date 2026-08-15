export const BOT_PRESENCE_EVENT_CHANNEL = 'herta:bot-presence:update';

export const BOT_PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'invisible'] as const;
export type BotPresenceStatus = (typeof BOT_PRESENCE_STATUSES)[number];

export const BOT_ACTIVITY_TYPES = ['playing', 'listening', 'watching', 'competing'] as const;
export type BotActivityType = (typeof BOT_ACTIVITY_TYPES)[number];

export interface BotPresenceConfig {
  status: BotPresenceStatus;
  activityType: BotActivityType;
  activityText: string;
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
};

const STATUS_SET = new Set<string>(BOT_PRESENCE_STATUSES);
const ACTIVITY_TYPE_SET = new Set<string>(BOT_ACTIVITY_TYPES);

export function parseBotPresenceConfig(value: unknown): BotPresenceConfig | null {
  if (!isRecord(value)) return null;

  const status = value.status;
  const activityType = value.activityType;
  const activityText = typeof value.activityText === 'string' ? value.activityText.trim() : '';

  if (typeof status !== 'string' || !STATUS_SET.has(status)) return null;
  if (typeof activityType !== 'string' || !ACTIVITY_TYPE_SET.has(activityType)) return null;
  if (activityText.length < 1 || activityText.length > 128) return null;

  return {
    status: status as BotPresenceStatus,
    activityType: activityType as BotActivityType,
    activityText,
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
