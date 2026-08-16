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
  setDefaultGuild: (guildId: string | null) => Promise<boolean>;
}

const StudioServerContext = createContext<StudioServerContextValue | null>(null);

export function StudioServerContextProvider({
  guilds,
  initialDefaultGuildId,
  children,
}: {
  guilds: readonly StudioServerItem[];
  initialDefaultGuildId: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const routeGuildId = getGuildConsoleContext(pathname)?.guildId ?? null;
  const initialSelectedGuildId = resolveSelectedGuildId({
    guildIds: guilds.map((guild) => guild.id),
    routeGuildId,
    defaultGuildId: initialDefaultGuildId,
  });
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(initialSelectedGuildId);
  const [defaultGuildId, setDefaultGuildId] = useState<string | null>(initialDefaultGuildId);

  const guildById = useMemo(() => new Map(guilds.map((guild) => [guild.id, guild])), [guilds]);

  useEffect(() => {
    let sessionGuildId: string | null = null;
    try {
      sessionGuildId = window.sessionStorage.getItem(STUDIO_SELECTED_SERVER_SESSION_KEY);
      // DB由来の初期値はstateだけへ反映し、古いタブからlocalStorageへ再配信しない。
    } catch {
      // Storageが利用できない環境でもDB設定とURL Contextで継続する。
    }

    const nextDefaultGuildId =
      initialDefaultGuildId && guildById.has(initialDefaultGuildId) ? initialDefaultGuildId : null;
    const nextSelectedGuildId = resolveSelectedGuildId({
      guildIds: guilds.map((guild) => guild.id),
      routeGuildId,
      sessionGuildId,
      defaultGuildId: nextDefaultGuildId,
    });

    setDefaultGuildId(nextDefaultGuildId);
    setSelectedGuildId(nextSelectedGuildId);
    persistSessionSelection(nextSelectedGuildId);
  }, [guildById, guilds, initialDefaultGuildId, routeGuildId]);

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
    async (guildId: string | null): Promise<boolean> => {
      if (guildId !== null && !guildById.has(guildId)) return false;

      try {
        const response = await fetch('/api/me/studio-preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultGuildId: guildId }),
        });
        if (!response.ok) return false;

        setDefaultGuildId(guildId);
        try {
          window.localStorage.setItem(
            STUDIO_SERVER_PREFERENCES_STORAGE_KEY,
            serializeStudioServerPreferences({ version: 1, defaultGuildId: guildId }),
          );
        } catch {
          // DBへの保存は成功済みなのでブラウザキャッシュ失敗は致命的ではない。
        }
        return true;
      } catch {
        return false;
      }
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
