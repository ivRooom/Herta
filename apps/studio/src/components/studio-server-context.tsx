'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getGuildConsoleContext } from '@/lib/guild-context-nav';
import {
  STUDIO_SELECTED_SERVER_SESSION_KEY,
  STUDIO_SERVER_PREFERENCES_STORAGE_KEY,
  createDefaultStudioServerPreferences,
  parseStudioServerPreferences,
  resolveSelectedGuildId,
  serializeStudioServerPreferences,
} from '@/lib/studio-server-preferences';

export interface StudioServerItem {
  id: string;
  name: string;
  iconUrl: string | null;
}

interface StudioServerContextValue {
  guilds: readonly StudioServerItem[];
  selectedGuild: StudioServerItem | null;
  selectedGuildId: string | null;
  defaultGuildId: string | null;
  selectGuild: (guildId: string) => boolean;
  setDefaultGuild: (guildId: string | null) => boolean;
}

const StudioServerContext = createContext<StudioServerContextValue | null>(null);

export function StudioServerContextProvider({
  guilds,
  children,
}: {
  guilds: readonly StudioServerItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const routeGuildId = getGuildConsoleContext(pathname)?.guildId ?? null;
  const initialSelectedGuildId = resolveSelectedGuildId({
    guildIds: guilds.map((guild) => guild.id),
    routeGuildId,
  });
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(initialSelectedGuildId);
  const [defaultGuildId, setDefaultGuildId] = useState<string | null>(null);

  const guildById = useMemo(() => new Map(guilds.map((guild) => [guild.id, guild])), [guilds]);

  useEffect(() => {
    let preferences = createDefaultStudioServerPreferences();
    let sessionGuildId: string | null = null;

    try {
      preferences = parseStudioServerPreferences(
        window.localStorage.getItem(STUDIO_SERVER_PREFERENCES_STORAGE_KEY),
      );
      sessionGuildId = window.sessionStorage.getItem(STUDIO_SELECTED_SERVER_SESSION_KEY);
    } catch {
      // Storageが利用できない環境でもStudioの操作自体は継続する。
    }

    const nextSelectedGuildId = resolveSelectedGuildId({
      guildIds: guilds.map((guild) => guild.id),
      routeGuildId,
      sessionGuildId,
      defaultGuildId: preferences.defaultGuildId,
    });
    const nextDefaultGuildId =
      preferences.defaultGuildId && guildById.has(preferences.defaultGuildId)
        ? preferences.defaultGuildId
        : null;

    setDefaultGuildId(nextDefaultGuildId);
    setSelectedGuildId(nextSelectedGuildId);
    persistSessionSelection(nextSelectedGuildId);
  }, [guildById, guilds, routeGuildId]);

  useEffect(() => {
    if (!routeGuildId || !guildById.has(routeGuildId)) return;
    setSelectedGuildId(routeGuildId);
    persistSessionSelection(routeGuildId);
  }, [guildById, routeGuildId]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== STUDIO_SERVER_PREFERENCES_STORAGE_KEY) return;
      const preferences = parseStudioServerPreferences(event.newValue);
      setDefaultGuildId(
        preferences.defaultGuildId && guildById.has(preferences.defaultGuildId)
          ? preferences.defaultGuildId
          : null,
      );
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [guildById]);

  const selectGuild = useCallback(
    (guildId: string): boolean => {
      if (!guildById.has(guildId)) return false;
      setSelectedGuildId(guildId);
      persistSessionSelection(guildId);
      return true;
    },
    [guildById],
  );

  const setDefaultGuild = useCallback(
    (guildId: string | null): boolean => {
      if (guildId !== null && !guildById.has(guildId)) return false;

      const preferences = { version: 1 as const, defaultGuildId: guildId };
      try {
        window.localStorage.setItem(
          STUDIO_SERVER_PREFERENCES_STORAGE_KEY,
          serializeStudioServerPreferences(preferences),
        );
      } catch {
        return false;
      }

      setDefaultGuildId(guildId);
      return true;
    },
    [guildById],
  );

  const selectedGuild = selectedGuildId ? (guildById.get(selectedGuildId) ?? null) : null;
  const value = useMemo<StudioServerContextValue>(
    () => ({
      guilds,
      selectedGuild,
      selectedGuildId: selectedGuild?.id ?? null,
      defaultGuildId,
      selectGuild,
      setDefaultGuild,
    }),
    [defaultGuildId, guilds, selectGuild, selectedGuild, setDefaultGuild],
  );

  return <StudioServerContext.Provider value={value}>{children}</StudioServerContext.Provider>;
}

export function useStudioServerContext(): StudioServerContextValue {
  const context = useContext(StudioServerContext);
  if (!context) throw new Error('StudioServerContextProviderの内側で使用してください');
  return context;
}

function persistSessionSelection(guildId: string | null): void {
  try {
    if (guildId) {
      window.sessionStorage.setItem(STUDIO_SELECTED_SERVER_SESSION_KEY, guildId);
    } else {
      window.sessionStorage.removeItem(STUDIO_SELECTED_SERVER_SESSION_KEY);
    }
  } catch {
    // sessionStorageが利用できなくてもURLとメモリ上のContextで継続する。
  }
}
