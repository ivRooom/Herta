import { isDiscordGuildId } from './guild-context-nav.ts';

export const STUDIO_SERVER_PREFERENCES_STORAGE_KEY = 'herta:studio-server-preferences';
export const STUDIO_SELECTED_SERVER_SESSION_KEY = 'herta:studio-selected-server';

export interface StudioServerPreferences {
  version: 1;
  defaultGuildId: string | null;
}

export interface ResolveSelectedGuildInput {
  guildIds: readonly string[];
  routeGuildId?: string | null;
  sessionGuildId?: string | null;
  defaultGuildId?: string | null;
}

export function createDefaultStudioServerPreferences(): StudioServerPreferences {
  return { version: 1, defaultGuildId: null };
}

export function parseStudioServerPreferences(value: string | null): StudioServerPreferences {
  if (!value || value.length > 512) return createDefaultStudioServerPreferences();

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return createDefaultStudioServerPreferences();

    const defaultGuildId = normalizeOptionalGuildId(parsed.defaultGuildId);
    return { version: 1, defaultGuildId };
  } catch {
    return createDefaultStudioServerPreferences();
  }
}

export function serializeStudioServerPreferences(preferences: StudioServerPreferences): string {
  return JSON.stringify({
    version: 1,
    defaultGuildId: normalizeOptionalGuildId(preferences.defaultGuildId),
  } satisfies StudioServerPreferences);
}

export function resolveSelectedGuildId(input: ResolveSelectedGuildInput): string | null {
  const guildIds = [...new Set(input.guildIds.filter(isDiscordGuildId))];
  if (guildIds.length === 0) return null;

  const manageable = new Set(guildIds);
  for (const candidate of [input.routeGuildId, input.sessionGuildId, input.defaultGuildId]) {
    const guildId = normalizeOptionalGuildId(candidate);
    if (guildId && manageable.has(guildId)) return guildId;
  }

  return guildIds[0] ?? null;
}

export function normalizeOptionalGuildId(value: unknown): string | null {
  return typeof value === 'string' && isDiscordGuildId(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
