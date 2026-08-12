'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Trophy,
} from 'lucide-react';
import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import { DiscordChannelPicker, DiscordRolePicker } from './discord-entity-picker';

type Metric =
  | 'xp'
  | 'messages'
  | 'reactionsGiven'
  | 'reactionsReceived'
  | 'voiceSeconds'
  | 'minecraftSeconds'
  | 'pollVotes'
  | 'giveawayEntries'
  | 'eventGoing'
  | 'suggestions'
  | 'acceptedSuggestions'
  | 'challengeCompletions'
  | 'seasonPoints';

type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type ConditionMode = 'all' | 'any';

type AchievementCondition = { metric: Metric; target: number };

type AchievementStage = {
  key: string;
  name: string;
  description: string;
  emoji: string;
  rarity: Rarity;
  points: number;
  secret: boolean;
  conditionMode: ConditionMode;
  conditions: AchievementCondition[];
  rewardRoleId: string | null;
  notificationChannelId: string | null;
};

type AchievementSeries = {
  key: string;
  name: string;
  category: string;
  enabled: boolean;
  stages: AchievementStage[];
};

type PluginResponse = {
  error?: unknown;
  config?: Record<string, unknown>;
};

const METRICS: Array<{ value: Metric; label: string; unit: string }> = [
  { value: 'xp', label: 'XP', unit: 'XP' },
  { value: 'messages', label: 'メッセージ送信', unit: '件' },
  { value: 'reactionsGiven', label: 'リアクション送信', unit: '回' },
  { value: 'reactionsReceived', label: 'リアクション獲得', unit: '回' },
  { value: 'voiceSeconds', label: 'VC参加時間', unit: '秒' },
  { value: 'minecraftSeconds', label: 'Minecraft活動時間', unit: '秒' },
  { value: 'pollVotes', label: 'Poll投票', unit: '回' },
  { value: 'giveawayEntries', label: 'Giveaway参加', unit: '回' },
  { value: 'eventGoing', label: 'Event参加', unit: '回' },
  { value: 'suggestions', label: 'Suggestion投稿', unit: '件' },
  { value: 'acceptedSuggestions', label: 'Suggestion採用', unit: '件' },
  { value: 'challengeCompletions', label: 'Challenge達成', unit: '回' },
  { value: 'seasonPoints', label: 'Season Point', unit: 'pt' },
];

const RARITIES: Array<{ value: Rarity; label: string; points: number }> = [
  { value: 'common', label: 'Common', points: 25 },
  { value: 'uncommon', label: 'Uncommon', points: 50 },
  { value: 'rare', label: 'Rare', points: 100 },
  { value: 'epic', label: 'Epic', points: 200 },
  { value: 'legendary', label: 'Legendary', points: 500 },
];

export function AchievementBuilderManager({
  guildId,
  initialConfig,
  discordOptions,
}: {
  guildId: string;
  initialConfig: Record<string, unknown>;
  discordOptions: GuildConfigurationOptions | null;
}) {
  const initialSeries = useMemo(() => normalizeSeries(initialConfig.customAchievements), [initialConfig]);
  const [series, setSeries] = useState<AchievementSeries[]>(initialSeries);
  const [savedSeries, setSavedSeries] = useState<AchievementSeries[]>(initialSeries);
  const [selectedSeries, setSelectedSeries] = useState(0);
  const [selectedStage, setSelectedStage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const validation = useMemo(() => validateSeries(series), [series]);
  const dirty = JSON.stringify(series) !== JSON.stringify(savedSeries);
  const activeSeries = series[selectedSeries];
  const activeStage = activeSeries?.stages[selectedStage];
  const stageCount = series.reduce((total, item) => total + item.stages.length, 0);
  const pointTotal = series.reduce(
    (total, item) => total + item.stages.reduce((sum, stage) => sum + stage.points, 0),
    0,
  );

  function patchSeries(index: number, patch: Partial<AchievementSeries>) {
    setSeries((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setStatus('未保存の変更があります');
  }

  function patchStage(seriesIndex: number, stageIndex: number, patch: Partial<AchievementStage>) {
    setSeries((current) =>
      current.map((item, i) =>
        i === seriesIndex
          ? {
              ...item,
              stages: item.stages.map((stage, j) =>
                j === stageIndex ? { ...stage, ...patch } : stage,
              ),
            }
          : item,
      ),
    );
    setStatus('未保存の変更があります');
  }

  function addSeries() {
    if (series.length >= 25) return;
    const sequence = series.length + 1;
    const next = createSeries(`achievement-${sequence}`, `新しいAchievement ${sequence}`);
    setSeries((current) => [...current, next]);
    setSelectedSeries(series.length);
    setSelectedStage(0);
    setStatus('Seriesを追加しました。保存するまで反映されません');
  }

  function removeSeries(index: number) {
    if (!window.confirm('このSeriesとすべてのStageを削除しますか？')) return;
    setSeries((current) => current.filter((_, i) => i !== index));
    setSelectedSeries((current) => Math.max(0, Math.min(current, series.length - 2)));
    setSelectedStage(0);
    setStatus('Seriesを削除しました。保存するまで反映されません');
  }

  function duplicateSeries(index: number) {
    if (series.length >= 25) return;
    const source = series[index];
    if (!source) return;
    const suffix = nextCopySuffix(series.map((item) => item.key), source.key);
    const copy: AchievementSeries = {
      ...structuredClone(source),
      key: suffix,
      name: `${source.name} Copy`,
    };
    setSeries((current) => [...current, copy]);
    setSelectedSeries(series.length);
    setSelectedStage(0);
    setStatus('Seriesを複製しました。IDを確認してから保存してください');
  }

  function moveSeries(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= series.length) return;
    setSeries((current) => move(current, index, target));
    setSelectedSeries(target);
    setStatus('Seriesの順序を変更しました');
  }

  function addStage(seriesIndex: number) {
    const current = series[seriesIndex];
    if (!current || current.stages.length >= 10) return;
    const sequence = current.stages.length + 1;
    const stage = createStage(`stage-${sequence}`, `Stage ${sequence}`);
    patchSeries(seriesIndex, { stages: [...current.stages, stage] });
    setSelectedStage(current.stages.length);
  }

  function duplicateStage(seriesIndex: number, stageIndex: number) {
    const current = series[seriesIndex];
    const source = current?.stages[stageIndex];
    if (!current || !source || current.stages.length >= 10) return;
    const copy = structuredClone(source);
    copy.key = nextCopySuffix(current.stages.map((stage) => stage.key), source.key);
    copy.name = `${source.name} Copy`;
    patchSeries(seriesIndex, { stages: [...current.stages, copy] });
    setSelectedStage(current.stages.length);
  }

  function removeStage(seriesIndex: number, stageIndex: number) {
    const current = series[seriesIndex];
    if (!current || current.stages.length <= 1) {
      setStatus('Seriesには最低1つのStageが必要です');
      return;
    }
    if (!window.confirm('このStageを削除しますか？')) return;
    patchSeries(seriesIndex, { stages: current.stages.filter((_, i) => i !== stageIndex) });
    setSelectedStage((value) => Math.max(0, Math.min(value, current.stages.length - 2)));
  }

  function moveStage(seriesIndex: number, stageIndex: number, direction: -1 | 1) {
    const current = series[seriesIndex];
    if (!current) return;
    const target = stageIndex + direction;
    if (target < 0 || target >= current.stages.length) return;
    patchSeries(seriesIndex, { stages: move(current.stages, stageIndex, target) });
    setSelectedStage(target);
  }

  function patchCondition(conditionIndex: number, patch: Partial<AchievementCondition>) {
    if (!activeStage) return;
    patchStage(selectedSeries, selectedStage, {
      conditions: activeStage.conditions.map((condition, index) =>
        index === conditionIndex ? { ...condition, ...patch } : condition,
      ),
    });
  }

  function addCondition() {
    if (!activeStage || activeStage.conditions.length >= 8) return;
    patchStage(selectedSeries, selectedStage, {
      conditions: [...activeStage.conditions, { metric: 'messages', target: 100 }],
    });
  }

  function removeCondition(index: number) {
    if (!activeStage || activeStage.conditions.length <= 1) return;
    patchStage(selectedSeries, selectedStage, {
      conditions: activeStage.conditions.filter((_, conditionIndex) => conditionIndex !== index),
    });
  }

  function reset() {
    setSeries(structuredClone(savedSeries));
    setSelectedSeries(0);
    setSelectedStage(0);
    setStatus('未保存の変更を破棄しました');
  }

  async function save() {
    if (validation.length > 0) {
      setStatus(`入力エラーが${validation.length}件あります。修正してから保存してください`);
      return;
    }
    setSaving(true);
    setStatus('保存中…');
    try {
      const latestResponse = await fetch(`/api/guilds/${guildId}/plugins/achievements`, {
        cache: 'no-store',
      });
      const latest = (await latestResponse.json().catch(() => null)) as PluginResponse | null;
      if (!latestResponse.ok || !latest?.config) throw new Error('最新のPlugin設定を取得できませんでした');

      const response = await fetch(`/api/guilds/${guildId}/plugins/achievements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { ...latest.config, customAchievements: series } }),
      });
      const result = (await response.json().catch(() => null)) as PluginResponse | null;
      if (!response.ok) throw new Error(readApiError(result));
      const normalized = normalizeSeries(result?.config?.customAchievements ?? series);
      setSeries(normalized);
      setSavedSeries(structuredClone(normalized));
      setStatus('Achievement Builderの設定を保存しました');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Custom Achievement Builder</h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">
              Series → Stage → 解除条件の順に組み立てます。保存時は最新のPlugin設定へCustom Achievementだけをマージします。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <Stat value={`${series.length}/25`} label="Series" />
            <Stat value={`${stageCount}`} label="Stages" />
            <Stat value={`${pointTotal.toLocaleString()}pt`} label="Total" />
          </div>
        </div>
      </section>

      {validation.length > 0 ? (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-semibold text-destructive">保存前に修正が必要です</p>
          <ul className="mt-2 space-y-1 text-xs text-destructive">
            {validation.slice(0, 8).map((issue) => (
              <li key={issue}>• {issue}</li>
            ))}
            {validation.length > 8 ? <li>• ほか {validation.length - 8}件</li> : null}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="rounded-2xl border border-border bg-surface p-4 shadow-card xl:sticky xl:top-6 xl:self-start">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Series</p>
              <p className="text-xs text-muted">{series.length}/25</p>
            </div>
            <button
              type="button"
              onClick={addSeries}
              disabled={series.length >= 25}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> 追加
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {series.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted">
                Seriesがありません。追加して作成を開始してください。
              </div>
            ) : null}
            {series.map((item, index) => (
              <button
                type="button"
                key={`${item.key}-${index}`}
                onClick={() => {
                  setSelectedSeries(index);
                  setSelectedStage(0);
                }}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selectedSeries === index
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border bg-background hover:border-primary/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{item.name || '名称未設定'}</span>
                  <span className={`h-2 w-2 rounded-full ${item.enabled ? 'bg-emerald-400' : 'bg-muted'}`} />
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted">{item.key || 'series-id'}</p>
                <p className="mt-2 text-[11px] text-muted">{item.stages.length} stages</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {activeSeries ? (
            <>
              <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold">Series設定</h3>
                    <p className="mt-1 text-xs text-muted">Series IDは解除履歴の名前空間になるため、運用開始後の変更は避けてください。</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <IconButton label="上へ" onClick={() => moveSeries(selectedSeries, -1)} disabled={selectedSeries === 0} icon={<ArrowUp />} />
                    <IconButton label="下へ" onClick={() => moveSeries(selectedSeries, 1)} disabled={selectedSeries === series.length - 1} icon={<ArrowDown />} />
                    <IconButton label="複製" onClick={() => duplicateSeries(selectedSeries)} disabled={series.length >= 25} icon={<Copy />} />
                    <IconButton label="削除" onClick={() => removeSeries(selectedSeries)} icon={<Trash2 />} destructive />
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <Field label="Series名">
                    <input value={activeSeries.name} onChange={(event) => patchSeries(selectedSeries, { name: event.target.value })} maxLength={80} className={inputClass} placeholder="Chat Master" />
                  </Field>
                  <Field label="Series ID">
                    <input value={activeSeries.key} onChange={(event) => patchSeries(selectedSeries, { key: slug(event.target.value) })} maxLength={48} className={`${inputClass} font-mono`} placeholder="chat-master" />
                  </Field>
                  <Field label="Category">
                    <input value={activeSeries.category} onChange={(event) => patchSeries(selectedSeries, { category: event.target.value })} maxLength={40} className={inputClass} placeholder="activity" />
                  </Field>
                  <Field label="状態">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeSeries.enabled}
                      onClick={() => patchSeries(selectedSeries, { enabled: !activeSeries.enabled })}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ${activeSeries.enabled ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-background'}`}
                    >
                      <span>{activeSeries.enabled ? '有効' : '無効'}</span>
                      <span className={`h-5 w-9 rounded-full p-0.5 ${activeSeries.enabled ? 'bg-emerald-500' : 'bg-border'}`}>
                        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${activeSeries.enabled ? 'translate-x-4' : ''}`} />
                      </span>
                    </button>
                  </Field>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-semibold">Stages / Levels</h3>
                    <p className="mt-1 text-xs text-muted">Bronze → Silver → Goldのように最大10段階まで作成できます。</p>
                  </div>
                  <button type="button" onClick={() => addStage(selectedSeries)} disabled={activeSeries.stages.length >= 10} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-background disabled:opacity-40">
                    <Plus className="h-4 w-4" /> Stage追加
                  </button>
                </div>

                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                  {activeSeries.stages.map((stage, index) => (
                    <button
                      type="button"
                      key={`${stage.key}-${index}`}
                      onClick={() => setSelectedStage(index)}
                      className={`min-w-36 rounded-xl border px-3 py-2 text-left ${selectedStage === index ? 'border-primary/50 bg-primary/10' : 'border-border bg-background'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{stage.emoji || '🏅'}</span>
                        <span className="truncate text-sm font-medium">{stage.name || `Stage ${index + 1}`}</span>
                      </div>
                      <p className="mt-1 text-[11px] capitalize text-muted">{stage.rarity} · {stage.points}pt</p>
                    </button>
                  ))}
                </div>

                {activeStage ? (
                  <div className="mt-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">Stage {selectedStage + 1}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted">custom:{activeSeries.key || 'series'}:{activeStage.key || 'stage'}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <IconButton label="上へ" onClick={() => moveStage(selectedSeries, selectedStage, -1)} disabled={selectedStage === 0} icon={<ArrowUp />} />
                        <IconButton label="下へ" onClick={() => moveStage(selectedSeries, selectedStage, 1)} disabled={selectedStage === activeSeries.stages.length - 1} icon={<ArrowDown />} />
                        <IconButton label="複製" onClick={() => duplicateStage(selectedSeries, selectedStage)} disabled={activeSeries.stages.length >= 10} icon={<Copy />} />
                        <IconButton label="削除" onClick={() => removeStage(selectedSeries, selectedStage)} disabled={activeSeries.stages.length <= 1} icon={<Trash2 />} destructive />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <Field label="Stage名">
                        <input value={activeStage.name} onChange={(event) => patchStage(selectedSeries, selectedStage, { name: event.target.value })} maxLength={80} className={inputClass} placeholder="Bronze" />
                      </Field>
                      <Field label="Stage ID">
                        <input value={activeStage.key} onChange={(event) => patchStage(selectedSeries, selectedStage, { key: slug(event.target.value) })} maxLength={48} className={`${inputClass} font-mono`} placeholder="bronze" />
                      </Field>
                      <Field label="Badge / Emoji">
                        <input value={activeStage.emoji} onChange={(event) => patchStage(selectedSeries, selectedStage, { emoji: event.target.value })} maxLength={32} className={inputClass} placeholder="🏅" />
                      </Field>
                      <Field label="Rarity">
                        <select value={activeStage.rarity} onChange={(event) => patchStage(selectedSeries, selectedStage, { rarity: event.target.value as Rarity })} className={inputClass}>
                          {RARITIES.map((rarity) => <option key={rarity.value} value={rarity.value}>{rarity.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Badge Point">
                        <input type="number" value={activeStage.points} min={0} max={100000} onChange={(event) => patchStage(selectedSeries, selectedStage, { points: numberValue(event.target.value, 0) })} className={inputClass} />
                      </Field>
                      <Field label="Secret">
                        <button type="button" onClick={() => patchStage(selectedSeries, selectedStage, { secret: !activeStage.secret })} className="flex w-full items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                          <span>{activeStage.secret ? '解除まで非公開' : '公開'}</span>
                          {activeStage.secret ? <EyeOff className="h-4 w-4 text-primary" /> : <Eye className="h-4 w-4 text-muted" />}
                        </button>
                      </Field>
                      <Field label="説明" wide>
                        <textarea value={activeStage.description} onChange={(event) => patchStage(selectedSeries, selectedStage, { description: event.target.value })} maxLength={240} rows={3} className={inputClass} placeholder="このStageの達成内容を説明" />
                      </Field>
                    </div>

                    <div className="mt-6 border-t border-border pt-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">解除条件</p>
                          <p className="mt-1 text-xs text-muted">ALLはすべて、ANYはいずれか1つを満たすと解除します。</p>
                        </div>
                        <div className="flex gap-2">
                          <select value={activeStage.conditionMode} onChange={(event) => patchStage(selectedSeries, selectedStage, { conditionMode: event.target.value as ConditionMode })} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold">
                            <option value="all">ALL</option>
                            <option value="any">ANY</option>
                          </select>
                          <button type="button" onClick={addCondition} disabled={activeStage.conditions.length >= 8} className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium disabled:opacity-40">
                            <Plus className="h-3.5 w-3.5" /> 条件追加
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {activeStage.conditions.map((condition, index) => {
                          const metric = METRICS.find((item) => item.value === condition.metric);
                          return (
                            <div key={`${condition.metric}-${index}`} className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-center">
                              <select value={condition.metric} onChange={(event) => patchCondition(index, { metric: event.target.value as Metric })} className={inputClass}>
                                {METRICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                              </select>
                              <div className="relative">
                                <input type="number" min={1} value={condition.target} onChange={(event) => patchCondition(index, { target: numberValue(event.target.value, 1) })} className={`${inputClass} pr-11`} />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">{metric?.unit}</span>
                              </div>
                              <button type="button" onClick={() => removeCondition(index)} disabled={activeStage.conditions.length <= 1} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted hover:text-destructive disabled:opacity-30" aria-label={`条件${index + 1}を削除`}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-6 grid gap-4 border-t border-border pt-5 md:grid-cols-2">
                      <Field label="解除時Role">
                        <DiscordRolePicker
                          options={discordOptions?.roles ?? []}
                          value={activeStage.rewardRoleId}
                          onChange={(value) => patchStage(selectedSeries, selectedStage, { rewardRoleId: typeof value === 'string' ? value : null })}
                          editableOnly
                          placeholder="Roleを選択（任意）"
                        />
                      </Field>
                      <Field label="Stage専用通知Channel">
                        <DiscordChannelPicker
                          options={discordOptions?.channels ?? []}
                          value={activeStage.notificationChannelId}
                          onChange={(value) => patchStage(selectedSeries, selectedStage, { notificationChannelId: typeof value === 'string' ? value : null })}
                          placeholder="未設定なら共通通知先を使用"
                        />
                      </Field>
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <section className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center shadow-card">
              <Trophy className="mx-auto h-8 w-8 text-muted" />
              <h3 className="mt-3 font-semibold">Custom Achievementを作成しましょう</h3>
              <p className="mt-1 text-sm text-muted">Seriesを追加すると編集画面が表示されます。</p>
              <button type="button" onClick={addSeries} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                <Plus className="h-4 w-4" /> 最初のSeriesを追加
              </button>
            </section>
          )}
        </main>

        <aside className="rounded-2xl border border-border bg-surface p-4 shadow-card xl:sticky xl:top-6 xl:self-start">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Discord Preview</h3>
          </div>
          {activeSeries && activeStage ? (
            <div className="mt-4 rounded-xl border border-border bg-background p-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl">{activeStage.secret ? '🌌' : activeStage.emoji || '🏅'}</div>
                <div className="min-w-0">
                  <p className="font-semibold">{activeStage.secret ? 'Secret Achievement' : activeStage.name || 'Stage名'}</p>
                  <p className="mt-0.5 text-xs text-muted">{activeSeries.name || 'Series'} · {rarityLabel(activeStage.rarity)} · {activeStage.points.toLocaleString()}pt</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">{activeStage.secret ? '条件は解除するまで非公開です。' : activeStage.description || '説明は設定されていません。'}</p>
              {!activeStage.secret ? (
                <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                  <p className="text-[11px] font-semibold text-muted">UNLOCK CONDITION · {activeStage.conditionMode.toUpperCase()}</p>
                  <div className="mt-2 space-y-1.5">
                    {activeStage.conditions.map((condition, index) => (
                      <p key={`${condition.metric}-${index}`} className="text-xs">{conditionLabel(condition)}</p>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="mt-3 break-all font-mono text-[10px] text-muted">custom:{activeSeries.key || 'series'}:{activeStage.key || 'stage'}</p>
            </div>
          ) : (
            <p className="mt-4 text-xs leading-5 text-muted">Stageを選択するとBadge表示と解除条件を確認できます。</p>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs font-semibold">運用チェック</p>
            <ul className="mt-2 space-y-2 text-xs text-muted">
              <li>• Series / Stage IDは運用開始後に変更しない</li>
              <li>• Role報酬はBotより下位のRoleを選択する</li>
              <li>• VC / Minecraftの時間条件は秒単位で設定する</li>
              <li>• Secretは解除通知時に初めて名称が公開される</li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="sticky bottom-4 z-20 rounded-2xl border border-border bg-surface/95 p-3 shadow-card backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className={`truncate text-sm ${status.includes('失敗') || status.includes('エラー') ? 'text-destructive' : 'text-muted'}`}>{status || (dirty ? '未保存の変更があります' : '保存済み')}</p>
            <p className="mt-0.5 text-[11px] text-muted">{validation.length > 0 ? `${validation.length}件の入力エラー` : '保存可能'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={reset} disabled={!dirty || saving} className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-40">変更を破棄</button>
            <button type="button" onClick={save} disabled={!dirty || saving || validation.length > 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              <Save className="h-4 w-4" /> {saving ? '保存中…' : 'Builderを保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring';

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'md:col-span-2' : undefined}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="rounded-xl border border-border bg-background px-3 py-2">
      <strong className="text-foreground">{value}</strong> {label}
    </span>
  );
}

function IconButton({ label, onClick, icon, disabled = false, destructive = false }: { label: string; onClick: () => void; icon: React.ReactElement<{ className?: string }>; disabled?: boolean; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border transition disabled:opacity-30 ${destructive ? 'text-muted hover:border-destructive/40 hover:text-destructive' : 'text-muted hover:bg-background hover:text-foreground'}`}>
      {icon.type ? <icon.type {...icon.props} className="h-4 w-4" /> : icon}
    </button>
  );
}

function createSeries(key: string, name: string): AchievementSeries {
  return { key, name, category: 'custom', enabled: true, stages: [createStage('bronze', 'Bronze')] };
}

function createStage(key: string, name: string): AchievementStage {
  return {
    key,
    name,
    description: '',
    emoji: '🏅',
    rarity: 'common',
    points: 100,
    secret: false,
    conditionMode: 'all',
    conditions: [{ metric: 'messages', target: 100 }],
    rewardRoleId: null,
    notificationChannelId: null,
  };
}

function normalizeSeries(value: unknown): AchievementSeries[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 25).flatMap((rawSeries, seriesIndex) => {
    if (!isRecord(rawSeries)) return [];
    const rawStages = Array.isArray(rawSeries.stages) ? rawSeries.stages : [];
    const stages = rawStages.slice(0, 10).flatMap((rawStage, stageIndex) => {
      if (!isRecord(rawStage)) return [];
      const rawConditions = Array.isArray(rawStage.conditions) ? rawStage.conditions : [];
      const conditions = rawConditions.slice(0, 8).flatMap((rawCondition) => {
        if (!isRecord(rawCondition) || !isMetric(rawCondition.metric)) return [];
        return [{ metric: rawCondition.metric, target: positiveInt(rawCondition.target, 1) }];
      });
      return [{
        key: text(rawStage.key, `stage-${stageIndex + 1}`),
        name: text(rawStage.name, `Stage ${stageIndex + 1}`),
        description: text(rawStage.description, ''),
        emoji: text(rawStage.emoji, '🏅'),
        rarity: isRarity(rawStage.rarity) ? rawStage.rarity : 'common',
        points: boundedInt(rawStage.points, 100, 0, 100000),
        secret: rawStage.secret === true,
        conditionMode: rawStage.conditionMode === 'any' ? 'any' : 'all',
        conditions: conditions.length > 0 ? conditions : [{ metric: 'messages', target: 100 }],
        rewardRoleId: discordId(rawStage.rewardRoleId),
        notificationChannelId: discordId(rawStage.notificationChannelId),
      } satisfies AchievementStage];
    });
    return [{
      key: text(rawSeries.key, `achievement-${seriesIndex + 1}`),
      name: text(rawSeries.name, `Achievement ${seriesIndex + 1}`),
      category: text(rawSeries.category, 'custom'),
      enabled: rawSeries.enabled !== false,
      stages: stages.length > 0 ? stages : [createStage('bronze', 'Bronze')],
    } satisfies AchievementSeries];
  });
}

function validateSeries(series: AchievementSeries[]): string[] {
  const issues: string[] = [];
  if (series.length > 25) issues.push('Seriesは最大25件です');
  const seriesKeys = new Set<string>();
  for (const [seriesIndex, item] of series.entries()) {
    const prefix = `Series ${seriesIndex + 1}`;
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(item.key)) issues.push(`${prefix}: Series IDは小文字英数字とハイフン、48文字以内で入力してください`);
    if (seriesKeys.has(item.key)) issues.push(`${prefix}: Series ID「${item.key}」が重複しています`);
    seriesKeys.add(item.key);
    if (!item.name.trim() || item.name.length > 80) issues.push(`${prefix}: Series名は1〜80文字で入力してください`);
    if (!item.category.trim() || item.category.length > 40) issues.push(`${prefix}: Categoryは1〜40文字で入力してください`);
    if (item.stages.length < 1 || item.stages.length > 10) issues.push(`${prefix}: Stageは1〜10件必要です`);
    const stageKeys = new Set<string>();
    for (const [stageIndex, stage] of item.stages.entries()) {
      const stagePrefix = `${prefix} / Stage ${stageIndex + 1}`;
      if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(stage.key)) issues.push(`${stagePrefix}: Stage IDは小文字英数字とハイフン、48文字以内で入力してください`);
      if (stageKeys.has(stage.key)) issues.push(`${stagePrefix}: Stage ID「${stage.key}」が重複しています`);
      stageKeys.add(stage.key);
      if (!stage.name.trim() || stage.name.length > 80) issues.push(`${stagePrefix}: Stage名は1〜80文字で入力してください`);
      if (stage.description.length > 240) issues.push(`${stagePrefix}: 説明は240文字以内です`);
      if (stage.emoji.length > 32) issues.push(`${stagePrefix}: Badge / Emojiは32文字以内です`);
      if (!Number.isSafeInteger(stage.points) || stage.points < 0 || stage.points > 100000) issues.push(`${stagePrefix}: Badge Pointは0〜100000の整数です`);
      if (stage.conditions.length < 1 || stage.conditions.length > 8) issues.push(`${stagePrefix}: 解除条件は1〜8件必要です`);
      for (const [conditionIndex, condition] of stage.conditions.entries()) {
        if (!Number.isSafeInteger(condition.target) || condition.target < 1 || condition.target > 2147483647) issues.push(`${stagePrefix} / 条件${conditionIndex + 1}: 達成値は1以上の整数です`);
      }
    }
  }
  return issues;
}

function conditionLabel(condition: AchievementCondition): string {
  const metric = METRICS.find((item) => item.value === condition.metric);
  return `${metric?.label ?? condition.metric} ≥ ${condition.target.toLocaleString()}${metric?.unit ?? ''}`;
}

function rarityLabel(value: Rarity): string {
  return RARITIES.find((item) => item.value === value)?.label ?? value;
}

function nextCopySuffix(existing: string[], key: string): string {
  const base = `${key.replace(/-copy-\d+$/u, '').slice(0, 40)}-copy`;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`.slice(0, 48);
    if (!existing.includes(candidate)) return candidate;
  }
  return `copy-${Date.now().toString(36)}`.slice(0, 48);
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/gu, '-').replace(/-+/gu, '-').replace(/^-+/u, '').slice(0, 48);
}

function numberValue(value: string, fallback: number): number {
  if (value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function positiveInt(value: unknown, fallback: number): number {
  return boundedInt(value, fallback, 1, 2147483647);
}

function discordId(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/u.test(value) ? value : null;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function isMetric(value: unknown): value is Metric {
  return METRICS.some((item) => item.value === value);
}

function isRarity(value: unknown): value is Rarity {
  return RARITIES.some((item) => item.value === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readApiError(result: PluginResponse | null): string {
  if (typeof result?.error === 'string') return result.error;
  return 'Achievement Builderの保存に失敗しました';
}
