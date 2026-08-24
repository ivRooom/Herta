'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useStudioServerContext } from '@/components/studio-server-context';
import {
  resolveEffectiveStudioPluginTabIds,
  type StudioPinnableServerTabId,
} from '@/lib/studio-navigation-config';

type StudioNavigationLoadState = 'idle' | 'loading' | 'ready' | 'error';

interface StudioNavigationContextValue {
  visiblePluginTabIds: readonly StudioPinnableServerTabId[];
  loadState: StudioNavigationLoadState;
  canManage: boolean;
  saveVisiblePluginTabIds: (ids: readonly StudioPinnableServerTabId[]) => Promise<boolean>;
  reload: () => void;
}

const StudioNavigationContext = createContext<StudioNavigationContextValue | null>(null);

export function StudioNavigationContextProvider({ children }: { children: ReactNode }) {
  const { selectedGuildId } = useStudioServerContext();
  const [loadedGuildId, setLoadedGuildId] = useState<string | null>(null);
  const [storedVisiblePluginTabIds, setStoredVisiblePluginTabIds] = useState<
    StudioPinnableServerTabId[]
  >([]);
  const [storedLoadState, setStoredLoadState] = useState<StudioNavigationLoadState>('idle');
  const [storedCanManage, setStoredCanManage] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!selectedGuildId) {
      setLoadedGuildId(null);
      setStoredVisiblePluginTabIds([]);
      setStoredCanManage(false);
      setStoredLoadState('idle');
      return;
    }

    const controller = new AbortController();
    setStoredLoadState('loading');

    void fetch(`/api/guilds/${selectedGuildId}/studio-navigation`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`StudioNavigationLoad:${response.status}`);
        return (await response.json()) as StudioNavigationResponse;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setStoredVisiblePluginTabIds(
          resolveEffectiveStudioPluginTabIds(normalizeResponseIds(payload.visiblePluginTabIds)),
        );
        setStoredCanManage(payload.canManage === true);
        setLoadedGuildId(selectedGuildId);
        setStoredLoadState('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStoredVisiblePluginTabIds([]);
        setStoredCanManage(false);
        setLoadedGuildId(selectedGuildId);
        setStoredLoadState('error');
        console.error('Studio navigation settings could not be loaded', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });

    return () => controller.abort();
  }, [reloadVersion, selectedGuildId]);

  // Guild切替直後は前Guildの設定を決して表示・更新権限へ流用しない。
  // Effectが新Guildを読み込む前のrenderでもloadedGuildIdとの一致を要求することで、
  // Server Aのoptional tabsがServer Bへ一瞬残ることを防ぐ。
  const hasLoadedSelectedGuild = loadedGuildId !== null && loadedGuildId === selectedGuildId;
  const visiblePluginTabIds = hasLoadedSelectedGuild ? storedVisiblePluginTabIds : [];
  const canManage = hasLoadedSelectedGuild ? storedCanManage : false;
  const loadState: StudioNavigationLoadState = selectedGuildId
    ? hasLoadedSelectedGuild
      ? storedLoadState
      : 'loading'
    : 'idle';

  const saveVisiblePluginTabIds = useCallback(
    async (ids: readonly StudioPinnableServerTabId[]): Promise<boolean> => {
      if (!selectedGuildId || !canManage) return false;
      const normalized = resolveEffectiveStudioPluginTabIds(ids);

      try {
        const response = await fetch(`/api/guilds/${selectedGuildId}/studio-navigation`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visiblePluginTabIds: normalized }),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as StudioNavigationResponse;
        setStoredVisiblePluginTabIds(
          resolveEffectiveStudioPluginTabIds(normalizeResponseIds(payload.visiblePluginTabIds)),
        );
        setStoredCanManage(payload.canManage === true);
        setLoadedGuildId(selectedGuildId);
        setStoredLoadState('ready');
        return true;
      } catch {
        return false;
      }
    },
    [canManage, selectedGuildId],
  );

  const reload = useCallback(() => setReloadVersion((version) => version + 1), []);

  const value = useMemo<StudioNavigationContextValue>(
    () => ({
      visiblePluginTabIds,
      loadState,
      canManage,
      saveVisiblePluginTabIds,
      reload,
    }),
    [canManage, loadState, reload, saveVisiblePluginTabIds, visiblePluginTabIds],
  );

  return <StudioNavigationContext.Provider value={value}>{children}</StudioNavigationContext.Provider>;
}

export function useStudioNavigationContext(): StudioNavigationContextValue {
  const context = useContext(StudioNavigationContext);
  if (!context) throw new Error('StudioNavigationContextProviderの内側で使用してください');
  return context;
}

interface StudioNavigationResponse {
  visiblePluginTabIds?: unknown;
  canManage?: unknown;
}

function normalizeResponseIds(value: unknown): StudioPinnableServerTabId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is StudioPinnableServerTabId => typeof id === 'string');
}
