'use client';

import { useMemo, useState } from 'react';
import { Check, Filter, Layers3, Plus, Search, Sparkles } from 'lucide-react';
import {
  ACHIEVEMENT_TEMPLATE_PACKS,
  materializeAchievementTemplatePack,
  templatePackStats,
  type AchievementTemplatePack,
} from '@/lib/achievement-templates';

type PluginResponse = {
  error?: unknown;
  config?: Record<string, unknown>;
};

type CategoryFilter = 'all' | AchievementTemplatePack['category'];

const CATEGORY_LABELS: Record<AchievementTemplatePack['category'], string> = {
  starter: 'Starter',
  community: 'Community',
  voice: 'Voice',
  minecraft: 'Minecraft',
  events: 'Events',
  season: 'Season',
};

const METRIC_LABELS: Record<string, string> = {
  xp: 'XP',
  messages: 'Messages',
  reactionsGiven: 'Reaction送信',
  reactionsReceived: 'Reaction獲得',
  voiceSeconds: 'VC時間',
  minecraftSeconds: 'Minecraft時間',
  pollVotes: 'Poll',
  giveawayEntries: 'Giveaway',
  eventGoing: 'Event',
  suggestions: 'Suggestion',
  acceptedSuggestions: '採用Suggestion',
  challengeCompletions: 'Challenge',
  seasonPoints: 'Season Point',
};

export function AchievementTemplateGallery({
  guildId,
  initialConfig,
}: {
  guildId: string;
  initialConfig: Record<string, unknown>;
}) {
  const initialSeries = Array.isArray(initialConfig.customAchievements)
    ? initialConfig.customAchievements
    : [];
  const [currentSeriesCount, setCurrentSeriesCount] = useState(initialSeries.length);
  const [installedKeys, setInstalledKeys] = useState(() => readKeys(initialSeries));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja');
    return ACHIEVEMENT_TEMPLATE_PACKS.filter((pack) => {
      if (category !== 'all' && pack.category !== category) return false;
      if (!normalized) return true;
      const haystack = [
        pack.name,
        pack.description,
        CATEGORY_LABELS[pack.category],
        ...pack.series.map((item) => item.name),
      ]
        .join(' ')
        .toLocaleLowerCase('ja');
      return haystack.includes(normalized);
    });
  }, [category, query]);

  async function install(pack: AchievementTemplatePack) {
    setInstallingId(pack.id);
    setStatus(`${pack.name} を追加しています…`);
    try {
      const latestResponse = await fetch(`/api/guilds/${guildId}/plugins/achievements`, {
        cache: 'no-store',
      });
      const latest = (await latestResponse.json().catch(() => null)) as PluginResponse | null;
      if (!latestResponse.ok || !latest?.config)
        throw new Error('最新のAchievements設定を取得できませんでした');

      const current = Array.isArray(latest.config.customAchievements)
        ? latest.config.customAchievements
        : [];
      const additions = materializeAchievementTemplatePack(pack, current);
      if (current.length + additions.length > 25) {
        throw new Error(
          `Series上限25件を超えるため追加できません。現在${current.length}件、Templateは${additions.length}件です`,
        );
      }

      const response = await fetch(`/api/guilds/${guildId}/plugins/achievements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            ...latest.config,
            customAchievements: [...current, ...additions],
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as PluginResponse | null;
      if (!response.ok) throw new Error(readApiError(result));

      const saved = Array.isArray(result?.config?.customAchievements)
        ? result.config.customAchievements
        : [...current, ...additions];
      setCurrentSeriesCount(saved.length);
      setInstalledKeys(readKeys(saved));
      setStatus(`${pack.name} を追加しました。Achievement Builderから内容を調整できます`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Templateの追加に失敗しました');
    } finally {
      setInstallingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Achievement Content Packs</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              用途別に調整済みのSeries / Stage /
              条件をまとめて追加します。追加後はBuilderで名称、条件値、Role報酬、通知先を自由に変更できます。
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm">
            <span className="text-muted">現在のSeries </span>
            <strong>{currentSeriesCount}/25</strong>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Template名・用途・Seriesを検索…"
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted" />
            {(
              [
                'all',
                'starter',
                'community',
                'voice',
                'minecraft',
                'events',
                'season',
              ] as CategoryFilter[]
            ).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  category === item
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-muted hover:text-foreground'
                }`}
              >
                {item === 'all' ? 'すべて' : CATEGORY_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {status ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            status.includes('失敗') ||
            status.includes('超える') ||
            status.includes('取得できません')
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-primary/20 bg-primary/5 text-foreground'
          }`}
        >
          {status}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((pack) => (
          <TemplateCard
            key={pack.id}
            pack={pack}
            installing={installingId === pack.id}
            disabled={installingId !== null || currentSeriesCount + pack.series.length > 25}
            previouslyInstalled={pack.series.every((item) =>
              hasTemplateKey(installedKeys, item.key),
            )}
            onInstall={() => install(pack)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
          条件に一致するTemplateはありません。
        </div>
      ) : null}
    </div>
  );
}

function TemplateCard({
  pack,
  installing,
  disabled,
  previouslyInstalled,
  onInstall,
}: {
  pack: AchievementTemplatePack;
  installing: boolean;
  disabled: boolean;
  previouslyInstalled: boolean;
  onInstall: () => void;
}) {
  const stats = templatePackStats(pack);
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-transparent p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="text-3xl" aria-hidden="true">
              {pack.icon}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{pack.name}</h3>
                {pack.recommended ? (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    おすすめ
                  </span>
                ) : null}
                {previouslyInstalled ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                    <Check className="h-3 w-3" /> 導入済み
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted">{CATEGORY_LABELS[pack.category]}</p>
            </div>
          </div>
          <Layers3 className="h-5 w-5 shrink-0 text-primary" />
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">{pack.description}</p>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap gap-2 text-[11px] text-muted">
          <Badge>{stats.seriesCount} Series</Badge>
          <Badge>{stats.stageCount} Stages</Badge>
          <Badge>{stats.pointTotal.toLocaleString()}pt</Badge>
          {stats.metrics.map((metric) => (
            <Badge key={metric}>{METRIC_LABELS[metric] ?? metric}</Badge>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {pack.series.map((series) => (
            <div key={series.key} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{series.name}</p>
                <span className="text-[10px] text-muted">{series.stages.length} stages</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {series.stages.map((stage) => (
                  <span
                    key={stage.key}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px]"
                    title={stage.description}
                  >
                    {stage.emoji} {stage.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onInstall}
          disabled={disabled}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {installing ? (
            '追加中…'
          ) : (
            <>
              <Plus className="h-4 w-4" />{' '}
              {previouslyInstalled ? 'もう1セット追加' : 'このPackを追加'}
            </>
          )}
        </button>
      </div>
    </article>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg border border-border bg-background px-2 py-1">{children}</span>
  );
}

function readKeys(series: unknown[]): string[] {
  return series.flatMap((item) => {
    if (!isRecord(item) || typeof item.key !== 'string') return [];
    return [item.key];
  });
}

function hasTemplateKey(keys: string[], base: string): boolean {
  return keys.some(
    (key) => key === base || new RegExp(`^${escapeRegExp(base)}-\\d+$`, 'u').test(key),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function readApiError(result: PluginResponse | null): string {
  if (typeof result?.error === 'string') return result.error;
  return 'Achievements設定の保存に失敗しました';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
