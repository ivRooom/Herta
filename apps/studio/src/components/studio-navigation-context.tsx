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
  const [visiblePluginTabIds, setVisiblePluginTabIds] = useState<StudioPinnableServerTabId[]>([]);
  const [loadState, setLoadState] = useState<StudioNavigationLoadState>('idle');
  const [canManage, setCanManage] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!selectedGuildId) {
      setVisiblePluginTabIds([]);
      setCanManage(false);
      setLoadState('idle');
      return;
    }

    const controller = new AbortController();
    setLoadState('loading');

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
        setVisiblePluginTabIds(
          resolveEffectiveStudioPluginTabIds(normalizeResponseIds(payload.visiblePluginTabIds)),
        );
        setCanManage(payload.canManage === true);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setVisiblePluginTabIds([]);
        setCanManage(false);
        setLoadState('error');
        console.error('Studio navigation settings could not be loaded', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });

    return () => controller.abort();
  }, [reloadVersion, selectedGuildId]);

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
        setVisiblePluginTabIds(
          resolveEffectiveStudioPluginTabIds(normalizeResponseIds(payload.visiblePluginTabIds)),
        );
        setCanManage(payload.canManage === true);
        setLoadState('ready');
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
