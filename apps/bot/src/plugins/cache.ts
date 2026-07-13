import type { EnabledPlugin } from '@herta/plugin-catalog';

export interface GuildPluginCache {
  get(guildId: string): EnabledPlugin[] | undefined;
  set(guildId: string, value: EnabledPlugin[]): void;
  invalidate(guildId: string): void;
  invalidateAll(): void;
}

interface CacheEntry {
  value: EnabledPlugin[];
  expiresAt: number;
}

export class InMemoryGuildPluginCache implements GuildPluginCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
  }

  get(guildId: string): EnabledPlugin[] | undefined {
    const entry = this.entries.get(guildId);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(guildId);
      return undefined;
    }
    return entry.value;
  }

  set(guildId: string, value: EnabledPlugin[]): void {
    this.entries.set(guildId, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(guildId: string): void {
    this.entries.delete(guildId);
  }

  invalidateAll(): void {
    this.entries.clear();
  }
}

export const defaultGuildPluginCache = new InMemoryGuildPluginCache();

// 将来は Redis Pub/Sub、Queue、またはイベント通知から共有キャッシュを無効化する。
export function invalidateGuildPluginCache(guildId: string): void {
  defaultGuildPluginCache.invalidate(guildId);
}
