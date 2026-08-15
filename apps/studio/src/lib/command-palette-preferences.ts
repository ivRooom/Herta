import {
  STUDIO_COMMAND_GROUP_LABELS,
  STUDIO_COMMAND_GROUP_ORDER,
  type StudioCommandGroup,
  type StudioCommandItem,
} from './studio-navigation.ts';

export const COMMAND_PALETTE_PREFERENCES_STORAGE_KEY = 'herta:studio:command-palette:v1';
export const COMMAND_PALETTE_MAX_FAVORITES = 12;
export const COMMAND_PALETTE_MAX_RECENT = 6;

const MAX_STORED_PREFERENCES_LENGTH = 16_384;
const COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export interface CommandPalettePreferences {
  version: 1;
  favoriteIds: string[];
  recentIds: string[];
}

export type CommandPaletteSectionId = 'favorites' | 'recent' | StudioCommandGroup;

export interface CommandPaletteSection {
  id: CommandPaletteSectionId;
  label: string;
  commands: StudioCommandItem[];
}

export function createDefaultCommandPalettePreferences(): CommandPalettePreferences {
  return {
    version: 1,
    favoriteIds: [],
    recentIds: [],
  };
}

export function parseCommandPalettePreferences(raw: string | null): CommandPalettePreferences {
  if (!raw || raw.length > MAX_STORED_PREFERENCES_LENGTH) {
    return createDefaultCommandPalettePreferences();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) {
      return createDefaultCommandPalettePreferences();
    }

    return {
      version: 1,
      favoriteIds: sanitizeCommandIds(parsed.favoriteIds, COMMAND_PALETTE_MAX_FAVORITES),
      recentIds: sanitizeCommandIds(parsed.recentIds, COMMAND_PALETTE_MAX_RECENT),
    };
  } catch {
    return createDefaultCommandPalettePreferences();
  }
}

export function serializeCommandPalettePreferences(
  preferences: CommandPalettePreferences,
): string {
  return JSON.stringify({
    version: 1,
    favoriteIds: sanitizeCommandIds(preferences.favoriteIds, COMMAND_PALETTE_MAX_FAVORITES),
    recentIds: sanitizeCommandIds(preferences.recentIds, COMMAND_PALETTE_MAX_RECENT),
  });
}

export function toggleFavoriteCommand(
  preferences: CommandPalettePreferences,
  commandId: string,
): CommandPalettePreferences {
  const safeCommandId = sanitizeCommandIds([commandId], 1)[0];
  if (!safeCommandId) return preferences;

  const favoriteIds = sanitizeCommandIds(
    preferences.favoriteIds,
    COMMAND_PALETTE_MAX_FAVORITES,
  );
  const nextFavoriteIds = favoriteIds.includes(safeCommandId)
    ? favoriteIds.filter((id) => id !== safeCommandId)
    : [safeCommandId, ...favoriteIds.filter((id) => id !== safeCommandId)].slice(
        0,
        COMMAND_PALETTE_MAX_FAVORITES,
      );

  return {
    version: 1,
    favoriteIds: nextFavoriteIds,
    recentIds: sanitizeCommandIds(preferences.recentIds, COMMAND_PALETTE_MAX_RECENT),
  };
}

export function recordRecentCommand(
  preferences: CommandPalettePreferences,
  commandId: string,
): CommandPalettePreferences {
  const safeCommandId = sanitizeCommandIds([commandId], 1)[0];
  if (!safeCommandId) return preferences;

  const recentIds = sanitizeCommandIds(preferences.recentIds, COMMAND_PALETTE_MAX_RECENT);

  return {
    version: 1,
    favoriteIds: sanitizeCommandIds(
      preferences.favoriteIds,
      COMMAND_PALETTE_MAX_FAVORITES,
    ),
    recentIds: [safeCommandId, ...recentIds.filter((id) => id !== safeCommandId)].slice(
      0,
      COMMAND_PALETTE_MAX_RECENT,
    ),
  };
}

export function clearRecentCommands(
  preferences: CommandPalettePreferences,
): CommandPalettePreferences {
  return {
    version: 1,
    favoriteIds: sanitizeCommandIds(
      preferences.favoriteIds,
      COMMAND_PALETTE_MAX_FAVORITES,
    ),
    recentIds: [],
  };
}

export function buildCommandPaletteSections(
  items: readonly StudioCommandItem[],
  preferences: CommandPalettePreferences,
  showQuickAccess: boolean,
): CommandPaletteSection[] {
  if (!showQuickAccess) return buildStandardSections(items);

  const commandById = new Map(items.map((command) => [command.id, command]));
  const favorites = resolveCommands(preferences.favoriteIds, commandById);
  const favoriteIds = new Set(favorites.map((command) => command.id));
  const recent = resolveCommands(preferences.recentIds, commandById).filter(
    (command) => !favoriteIds.has(command.id),
  );
  const quickAccessIds = new Set([
    ...favoriteIds,
    ...recent.map((command) => command.id),
  ]);
  const remainingCommands = items.filter((command) => !quickAccessIds.has(command.id));

  const sections: CommandPaletteSection[] = [];
  if (favorites.length > 0) {
    sections.push({ id: 'favorites', label: 'お気に入り', commands: favorites });
  }
  if (recent.length > 0) {
    sections.push({ id: 'recent', label: '最近使った項目', commands: recent });
  }

  return [...sections, ...buildStandardSections(remainingCommands)];
}

function buildStandardSections(items: readonly StudioCommandItem[]): CommandPaletteSection[] {
  return STUDIO_COMMAND_GROUP_ORDER.flatMap((group) => {
    const commands = items.filter((command) => command.group === group);
    if (commands.length === 0) return [];

    return [
      {
        id: group,
        label: STUDIO_COMMAND_GROUP_LABELS[group],
        commands,
      },
    ];
  });
}

function resolveCommands(
  commandIds: readonly string[],
  commandById: ReadonlyMap<string, StudioCommandItem>,
): StudioCommandItem[] {
  return commandIds
    .map((id) => commandById.get(id))
    .filter((command): command is StudioCommandItem => Boolean(command));
}

function sanitizeCommandIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const id = candidate.trim();
    if (!COMMAND_ID_PATTERN.test(id) || seen.has(id)) continue;

    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }

  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
