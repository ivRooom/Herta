'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, BellRing, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  getEnforcementPolicy,
  isBuiltInRuleEnabled,
  setEnforcementPolicy,
  toModerationConfigDraft,
  type AutomaticEnforcementActionDraft,
  type AutomaticModerationSeverityDraft,
  type ModerationConfigDraft,
} from '@/lib/moderation-config-ui';

type RuleDescriptor = {
  selector: string;
  label: string;
  detail: string;
  enabled: boolean;
};

const ACTION_OPTIONS: Array<{
  value: AutomaticEnforcementActionDraft;
  label: string;
  description: string;
}> = [
  { value: 'observe', label: '検知のみ', description: '履歴とAlertだけを残し、Discord上では操作しません。' },
  { value: 'warn', label: '警告', description: '対象ユーザーへDMで警告します。' },
  { value: 'delete', label: '削除', description: '検知したメッセージを削除します。' },
  { value: 'warn_delete', label: '警告 + 削除', description: '警告DMを送り、検知メッセージも削除します。' },
  { value: 'timeout', label: 'タイムアウト', description: '設定した時間だけ発言・参加を制限します。' },
  { value: 'role', label: '指定ロール付与', description: '隔離用・BAN用など指定したロールを付与します。' },
  { value: 'blacklist', label: 'ブラックリスト', description: 'Hertaへ永久登録し、BANして再参加時も自動BANします。' },
  { value: 'kick', label: 'Kick', description: 'サーバーから退出させます。再参加は可能です。' },
  { value: 'ban', label: 'BAN', description: 'DiscordサーバーからBANします。' },
];

const SEVERITY_OPTIONS: Array<{ value: AutomaticModerationSeverityDraft; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'critical', label: '緊急' },
];

export function ModerationEnforcementForm({
  guildId,
  initialConfig,
}: {
  guildId: string;
  initialConfig: Record<string, unknown>;
}) {
  const initialDraft = useMemo(() => toModerationConfigDraft(initialConfig), [initialConfig]);
  const [config, setConfig] = useState<ModerationConfigDraft>(initialDraft);
  const [baseConfig, setBaseConfig] = useState<Record<string, unknown>>(initialConfig);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const rules = useMemo(() => buildRuleDescriptors(config), [config]);

  function patch(patchValue: Partial<ModerationConfigDraft>) {
    setConfig((current) => ({ ...current, ...patchValue }));
    setStatus('未保存の変更があります');
  }

  function updatePolicy(
    selector: string,
    patchValue: Parameters<typeof setEnforcementPolicy>[2],
  ) {
    setConfig((current) => setEnforcementPolicy(current, selector, patchValue));
    setStatus('未保存の変更があります');
  }

  function toggleEnforcement(enabled: boolean) {
    if (
      enabled &&
      !window.confirm(
        '自動対応を有効にすると、ルール設定に応じてメッセージ削除・Timeout・Kick・BAN等が実際に実行されます。続行しますか？',
      )
    ) {
      return;
    }
    patch({ autoEnforcementEnabled: enabled });
  }

  async function save() {
    setSaving(true);
    setStatus('保存中…');
    try {
      const payloadConfig = { ...baseConfig, ...config };
      const response = await fetch(`/api/guilds/${guildId}/plugins/moderation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payloadConfig }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: unknown; config?: Record<string, unknown> }
        | null;
      if (!response.ok) {
        throw new Error(typeof result?.error === 'string' ? result.error : '保存に失敗しました');
      }
      const saved = result?.config ?? payloadConfig;
      setBaseConfig(saved);
      setConfig(toModerationConfigDraft(saved));
      setStatus('自動対応ポリシーを保存しました');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">自動対応の安全スイッチ</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              OFFでは全ルールが検知・履歴・緊急Alertまでで停止します。ONにしても、対応方法が「検知のみ」のルールではDiscord操作を行いません。
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-3 rounded-xl border border-border bg-background px-4 py-3">
            <span className="text-sm font-medium">
              {config.autoEnforcementEnabled ? '自動対応 ON' : '自動対応 OFF'}
            </span>
            <input
              type="checkbox"
              checked={config.autoEnforcementEnabled}
              onChange={(event) => toggleEnforcement(event.target.checked)}
              className="h-5 w-5 accent-current"
            />
          </label>
        </div>
        {!config.autoEnforcementEnabled ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <p>
              現在は安全モードです。下でBAN等を選んでも、保存後にこのスイッチをONにするまでは実行されません。
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">緊急Moderation Alert</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">
          危険度が設定値以上の検知を、Discordの指定チャンネルへ即時通知します。自動対応の失敗は危険度に関係なく通知します。
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Field label="通知チャンネルID" hint="未設定なら緊急Alertは送信しません。">
            <input
              value={config.autoAlertChannelId ?? ''}
              onChange={(event) => patch({ autoAlertChannelId: numericOrNull(event.target.value) })}
              inputMode="numeric"
              placeholder="123456789012345678"
              className={inputClassName}
            />
          </Field>
          <Field label="通知する最低危険度">
            <select
              value={config.autoAlertMinimumSeverity}
              onChange={(event) =>
                patch({
                  autoAlertMinimumSeverity: event.target.value as AutomaticModerationSeverityDraft,
                })
              }
              className={inputClassName}
            >
              {SEVERITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="メンションするRole ID"
            hint="カンマまたは改行区切り。@everyone/@hereは使用しません。"
          >
            <textarea
              value={config.autoAlertMentionRoleIds.join('\n')}
              onChange={(event) => patch({ autoAlertMentionRoleIds: parseIdList(event.target.value) })}
              rows={3}
              className={inputClassName}
              placeholder={'111111111111111111\n222222222222222222'}
            />
          </Field>
          <Field label="同一ユーザー・ルールの通知間隔（秒）" hint="0でCooldown無効。最大3600秒。">
            <input
              type="number"
              min={0}
              max={3600}
              value={config.autoAlertCooldownSeconds}
              onChange={(event) => patch({ autoAlertCooldownSeconds: clampNumber(event.target.value, 0, 3600, 60) })}
              className={inputClassName}
            />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-background p-4">
          <input
            type="checkbox"
            checked={config.autoAlertIncludeExcerpt}
            onChange={(event) => patch({ autoAlertIncludeExcerpt: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-current"
          />
          <span>
            <span className="block text-sm font-medium">本文プレビューをAlertへ含める</span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              デフォルトOFFです。OFFでも元メッセージへのJump Link、ユーザー、チャンネル、検知ルール、Actionは通知されます。
            </span>
          </span>
        </label>
      </section>

      <section>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">ルール別Action Policy</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">
          1メッセージが複数ルールに一致した場合、検知履歴はすべて残し、実際のDiscord操作は最も強いActionを1回だけ実行します。
        </p>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {rules.map((rule) => (
            <PolicyCard
              key={rule.selector}
              rule={rule}
              config={config}
              updatePolicy={updatePolicy}
            />
          ))}
        </div>
        {rules.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
            検知ルールがありません。先にModeration設定の「検知ルール」でルールを追加してください。
          </div>
        ) : null}
      </section>

      <div className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-card backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted" aria-live="polite">
          {status || '変更後は保存してください'}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto"
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中…' : '自動対応設定を保存'}
        </button>
      </div>
    </div>
  );
}

function PolicyCard({
  rule,
  config,
  updatePolicy,
}: {
  rule: RuleDescriptor;
  config: ModerationConfigDraft;
  updatePolicy: (
    selector: string,
    patch: Parameters<typeof setEnforcementPolicy>[2],
  ) => void;
}) {
  const policy = getEnforcementPolicy(config, rule.selector);
  const actionMeta = ACTION_OPTIONS.find((item) => item.value === policy.action)!;

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{rule.label}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                rule.enabled ? 'bg-primary/10 text-primary' : 'bg-background text-muted'
              }`}
            >
              {rule.enabled ? '検知ON' : '検知OFF'}
            </span>
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-muted">{rule.detail}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">{rule.selector}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="危険度">
          <select
            value={policy.severity}
            onChange={(event) =>
              updatePolicy(rule.selector, {
                severity: event.target.value as AutomaticModerationSeverityDraft,
              })
            }
            className={inputClassName}
          >
            {SEVERITY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="検知後の対応">
          <select
            value={policy.action}
            onChange={(event) =>
              updatePolicy(rule.selector, {
                action: event.target.value as AutomaticEnforcementActionDraft,
              })
            }
            className={inputClassName}
          >
            {ACTION_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">{actionMeta.description}</p>

      {policy.action === 'timeout' ? (
        <div className="mt-4">
          <Field label="タイムアウト時間（分）" hint="1〜40320分（最大28日）">
            <input
              type="number"
              min={1}
              max={40320}
              value={policy.timeoutMinutes}
              onChange={(event) =>
                updatePolicy(rule.selector, {
                  timeoutMinutes: clampNumber(event.target.value, 1, 40320, 10),
                })
              }
              className={inputClassName}
            />
          </Field>
        </div>
      ) : null}

      {policy.action === 'role' ? (
        <div className="mt-4">
          <Field label="付与するRole ID" hint="Botの最高ロールより下のRoleだけ指定できます。">
            <input
              value={policy.roleId ?? ''}
              onChange={(event) => updatePolicy(rule.selector, { roleId: numericOrNull(event.target.value) })}
              inputMode="numeric"
              placeholder="123456789012345678"
              className={inputClassName}
            />
          </Field>
        </div>
      ) : null}

      {policy.action === 'warn' || policy.action === 'warn_delete' ? (
        <div className="mt-4">
          <Field label="警告DMメッセージ" hint="空欄ならHertaの標準警告文を使います。最大500文字。">
            <textarea
              rows={3}
              maxLength={500}
              value={policy.warningMessage ?? ''}
              onChange={(event) =>
                updatePolicy(rule.selector, { warningMessage: event.target.value || null })
              }
              className={inputClassName}
            />
          </Field>
        </div>
      ) : null}

      {policy.action === 'ban' || policy.action === 'blacklist' ? (
        <div className="mt-4">
          <Field
            label="BAN時に削除する過去メッセージ（秒）"
            hint="0〜604800秒（最大7日）。0なら過去メッセージを削除しません。"
          >
            <input
              type="number"
              min={0}
              max={604800}
              value={policy.banDeleteMessageSeconds}
              onChange={(event) =>
                updatePolicy(rule.selector, {
                  banDeleteMessageSeconds: clampNumber(event.target.value, 0, 604800, 0),
                })
              }
              className={inputClassName}
            />
          </Field>
        </div>
      ) : null}
    </article>
  );
}

function buildRuleDescriptors(config: ModerationConfigDraft): RuleDescriptor[] {
  const custom: RuleDescriptor[] = [
    ...config.autoExactWords.map((value, index) => ({
      selector: `word_exact:${index}`,
      label: `完全一致 #${index + 1}`,
      detail: value,
      enabled: true,
    })),
    ...config.autoContainsWords.map((value, index) => ({
      selector: `word_contains:${index}`,
      label: `部分一致 #${index + 1}`,
      detail: value,
      enabled: true,
    })),
    ...config.autoRegexPatterns.map((value, index) => ({
      selector: `word_regex:${index}`,
      label: `正規表現 #${index + 1}`,
      detail: value,
      enabled: true,
    })),
  ];
  const builtIn: RuleDescriptor[] = [
    {
      selector: 'invite_link',
      label: 'Discord招待リンク',
      detail: '許可リストにないDiscord招待リンク',
      enabled: isBuiltInRuleEnabled(config, 'invite_link'),
    },
    {
      selector: 'mention_burst',
      label: '大量メンション',
      detail: `1メッセージ ${config.autoMentionLimit || 0}件以上`,
      enabled: isBuiltInRuleEnabled(config, 'mention_burst'),
    },
    {
      selector: 'message_burst',
      label: '短時間の連投',
      detail: `${config.autoBurstWindowSeconds}秒で${config.autoBurstMessageLimit || 0}件以上`,
      enabled: isBuiltInRuleEnabled(config, 'message_burst'),
    },
    {
      selector: 'duplicate_message',
      label: '同一内容の連続投稿',
      detail: `${config.autoDuplicateWindowSeconds}秒で${config.autoDuplicateMessageLimit || 0}件以上`,
      enabled: isBuiltInRuleEnabled(config, 'duplicate_message'),
    },
  ];
  return [...custom, ...builtIn];
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="mt-1 block text-xs leading-5 text-muted">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function numericOrNull(value: string): string | null {
  const normalized = value.replace(/\D/gu, '');
  return normalized || null;
}

function parseIdList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((item) => item.replace(/\D/gu, ''))
        .filter(Boolean),
    ),
  ];
}

function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

const inputClassName =
  'w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring';
