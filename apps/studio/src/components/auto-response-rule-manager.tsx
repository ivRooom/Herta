'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';

export interface AutoResponseRuleItem {
  id: string;
  name: string;
  triggerValue: string;
  matchMode: 'exact' | 'partial' | 'prefix' | 'regex';
  responseType: 'text' | 'embed';
  responseContent: string;
  channelIds: string[];
  roleIds: string[];
  cooldownSeconds: number;
  priority: number;
  caseSensitive: boolean;
  enabled: boolean;
  responseCount: number;
  failureCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RuleDraft {
  name: string;
  triggerValue: string;
  matchMode: AutoResponseRuleItem['matchMode'];
  responseType: AutoResponseRuleItem['responseType'];
  responseContent: string;
  channelIds: string;
  roleIds: string;
  cooldownSeconds: number;
  priority: number;
  caseSensitive: boolean;
  enabled: boolean;
}

interface RuleManagerProps {
  guildId: string;
  initialRules: AutoResponseRuleItem[];
  defaultRuleCooldownSeconds: number;
}

function createEmptyRule(defaultRuleCooldownSeconds: number): RuleDraft {
  return {
    name: '',
    triggerValue: '',
    matchMode: 'partial',
    responseType: 'text',
    responseContent: '',
    channelIds: '',
    roleIds: '',
    cooldownSeconds: defaultRuleCooldownSeconds,
    priority: 0,
    caseSensitive: false,
    enabled: true,
  };
}

export function AutoResponseRuleManager({
  guildId,
  initialRules,
  defaultRuleCooldownSeconds,
}: RuleManagerProps) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState<RuleDraft>(() => createEmptyRule(defaultRuleCooldownSeconds));
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setRules(initialRules);
  }, [initialRules]);

  useEffect(() => {
    setDraft(createEmptyRule(defaultRuleCooldownSeconds));
    setMessage(null);
  }, [guildId, defaultRuleCooldownSeconds]);

  async function createRule() {
    setCreating(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/auto-response/rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toRequestBody(draft)),
      });
      const body = (await response.json()) as AutoResponseRuleItem & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'ルールを作成できませんでした');
      setRules((current) => [body, ...current]);
      setDraft(createEmptyRule(defaultRuleCooldownSeconds));
      setMessage('自動応答ルールを作成しました');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ルールを作成できませんでした');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" />
          <h2 className="font-medium">新しいルール</h2>
        </div>
        <div className="mt-4">
          <RuleFields value={draft} onChange={setDraft} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            @everyone・@here・ロールメンションは保存時に拒否されます。
          </p>
          <button
            type="button"
            onClick={() => void createRule()}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            作成
          </button>
        </div>
        {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
      </section>

      <section className="space-y-3">
        {rules.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
            自動応答ルールはまだありません。
          </div>
        ) : (
          rules.map((rule) => (
            <RuleCard
              key={rule.id}
              guildId={guildId}
              rule={rule}
              onUpdated={(updated) => {
                setRules((current) =>
                  current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
                );
                router.refresh();
              }}
              onDeleted={(ruleId) => {
                setRules((current) => current.filter((candidate) => candidate.id !== ruleId));
                router.refresh();
              }}
            />
          ))
        )}
      </section>
    </div>
  );
}

function RuleCard({
  guildId,
  rule,
  onUpdated,
  onDeleted,
}: {
  guildId: string;
  rule: AutoResponseRuleItem;
  onUpdated(rule: AutoResponseRuleItem): void;
  onDeleted(ruleId: string): void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(() => toDraft(rule));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function updateRule() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/auto-response/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toRequestBody(draft)),
      });
      const body = (await response.json()) as AutoResponseRuleItem & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'ルールを更新できませんでした');
      onUpdated(body);
      setDraft(toDraft(body));
      setMessage('更新しました');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ルールを更新できませんでした');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule() {
    if (!window.confirm(`「${rule.name}」を削除しますか？`)) return;
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/auto-response/rules/${rule.id}`, {
        method: 'DELETE',
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'ルールを削除できませんでした');
      onDeleted(rule.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ルールを削除できませんでした');
      setDeleting(false);
    }
  }

  return (
    <details className="group rounded-2xl border border-border bg-surface shadow-card">
      <summary className="cursor-pointer list-none p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{rule.name}</h3>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                {matchModeLabel(rule.matchMode)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  rule.enabled
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted/10 text-muted'
                }`}
              >
                {rule.enabled ? '有効' : '無効'}
              </span>
            </div>
            <p className="mt-2 max-w-3xl truncate font-mono text-xs text-muted">
              {rule.triggerValue}
            </p>
          </div>
          <div className="text-right text-xs text-muted">
            <p>
              成功 {rule.responseCount} / 失敗 {rule.failureCount}
            </p>
            <p className="mt-1">Cooldown {rule.cooldownSeconds}秒</p>
          </div>
        </div>
      </summary>

      <div className="border-t border-border p-5">
        <RuleFields value={draft} onChange={setDraft} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{message}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void deleteRule()}
              disabled={deleting || saving}
              className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              削除
            </button>
            <button
              type="button"
              onClick={() => void updateRule()}
              disabled={saving || deleting}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

function RuleFields({ value, onChange }: { value: RuleDraft; onChange(value: RuleDraft): void }) {
  const update = <K extends keyof RuleDraft>(key: K, next: RuleDraft[K]) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="ルール名">
        <input
          value={value.name}
          onChange={(event) => update('name', event.target.value)}
          className="input"
          maxLength={80}
          placeholder="あいさつ"
        />
      </Field>
      <Field label="トリガー">
        <input
          value={value.triggerValue}
          onChange={(event) => update('triggerValue', event.target.value)}
          className="input font-mono"
          maxLength={200}
          placeholder="こんにちは"
        />
      </Field>
      <Field label="一致方式">
        <select
          value={value.matchMode}
          onChange={(event) => update('matchMode', event.target.value as RuleDraft['matchMode'])}
          className="input"
        >
          <option value="exact">完全一致</option>
          <option value="partial">部分一致</option>
          <option value="prefix">前方一致</option>
          <option value="regex">正規表現</option>
        </select>
      </Field>
      <Field label="応答形式">
        <select
          value={value.responseType}
          onChange={(event) =>
            update('responseType', event.target.value as RuleDraft['responseType'])
          }
          className="input"
        >
          <option value="text">テキスト</option>
          <option value="embed">Embed JSON</option>
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label={value.responseType === 'embed' ? 'Embed JSON' : '応答内容'}>
          <textarea
            value={value.responseContent}
            onChange={(event) => update('responseContent', event.target.value)}
            className="input min-h-28 resize-y font-mono"
            placeholder={
              value.responseType === 'embed'
                ? '{"title":"お知らせ","description":"本文"}'
                : 'こんにちは！'
            }
          />
        </Field>
      </div>
      <Field label="対象チャンネルID（カンマ区切り）">
        <input
          value={value.channelIds}
          onChange={(event) => update('channelIds', event.target.value)}
          className="input font-mono"
          placeholder="123456789, 987654321"
        />
      </Field>
      <Field label="対象ロールID（カンマ区切り）">
        <input
          value={value.roleIds}
          onChange={(event) => update('roleIds', event.target.value)}
          className="input font-mono"
          placeholder="123456789"
        />
      </Field>
      <Field label="Cooldown（秒）">
        <input
          type="number"
          min={0}
          max={86400}
          value={value.cooldownSeconds}
          onChange={(event) => update('cooldownSeconds', Number(event.target.value))}
          className="input"
        />
      </Field>
      <Field label="優先度">
        <input
          type="number"
          min={-1000}
          max={1000}
          value={value.priority}
          onChange={(event) => update('priority', Number(event.target.value))}
          className="input"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.caseSensitive}
          onChange={(event) => update('caseSensitive', event.target.checked)}
        />
        大文字・小文字を区別
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => update('enabled', event.target.checked)}
        />
        ルールを有効化
      </label>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function toDraft(rule: AutoResponseRuleItem): RuleDraft {
  return {
    name: rule.name,
    triggerValue: rule.triggerValue,
    matchMode: rule.matchMode,
    responseType: rule.responseType,
    responseContent: rule.responseContent,
    channelIds: rule.channelIds.join(', '),
    roleIds: rule.roleIds.join(', '),
    cooldownSeconds: rule.cooldownSeconds,
    priority: rule.priority,
    caseSensitive: rule.caseSensitive,
    enabled: rule.enabled,
  };
}

function toRequestBody(draft: RuleDraft) {
  return {
    ...draft,
    channelIds: splitIds(draft.channelIds),
    roleIds: splitIds(draft.roleIds),
  };
}

function splitIds(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchModeLabel(value: AutoResponseRuleItem['matchMode']): string {
  return {
    exact: '完全一致',
    partial: '部分一致',
    prefix: '前方一致',
    regex: '正規表現',
  }[value];
}
