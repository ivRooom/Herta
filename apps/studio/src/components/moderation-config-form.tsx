'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  Ban,
  CheckCircle2,
  Code2,
  ListChecks,
  Pencil,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  appendCustomRule,
  customRuleSelector,
  customRuleValues,
  isBuiltInRuleEnabled,
  removeCustomRule,
  setAutoCaseRule,
  setBuiltInRuleEnabled,
  toModerationConfigDraft,
  updateCustomRule,
  type CustomRuleKind,
  type ModerationConfigDraft,
} from '@/lib/moderation-config-ui';

type PluginUpdateResponse = {
  error?: unknown;
  details?: unknown;
  config?: Record<string, unknown>;
};

type SectionId = 'basic' | 'rules' | 'cases' | 'exemptions' | 'json';
type BuiltInRuleKind = 'invite_link' | 'mention_burst' | 'message_burst' | 'duplicate_message';

type EditingRule = {
  kind: CustomRuleKind;
  index: number;
  value: string;
};

const SECTION_ITEMS: Array<{
  id: SectionId;
  label: string;
  icon: typeof Settings2;
}> = [
  { id: 'basic', label: '基本設定', icon: Settings2 },
  { id: 'rules', label: '検知ルール', icon: SlidersHorizontal },
  { id: 'cases', label: '自動Case化', icon: ListChecks },
  { id: 'exemptions', label: '除外設定', icon: Ban },
  { id: 'json', label: '高度なJSON', icon: Code2 },
];

const CUSTOM_RULE_META: Record<
  CustomRuleKind,
  { label: string; shortLabel: string; description: string; limit: number }
> = {
  word_exact: {
    label: '完全一致',
    shortLabel: '完全一致',
    description: '正規化後のメッセージ全文が一致した場合に検知します。',
    limit: 100,
  },
  word_contains: {
    label: '部分一致',
    shortLabel: '部分一致',
    description: '正規化後のメッセージに指定文字列が含まれる場合に検知します。',
    limit: 100,
  },
  word_regex: {
    label: '正規表現',
    shortLabel: '正規表現',
    description: '制限付きの正規表現で一致したメッセージを検知します。',
    limit: 20,
  },
};

const BUILT_IN_RULE_META: Array<{
  kind: BuiltInRuleKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'invite_link',
    label: 'Discord招待リンク',
    description: '許可リストにないDiscord招待リンクを検知します。',
  },
  {
    kind: 'mention_burst',
    label: '大量メンション',
    description: '1メッセージ内のUser・Role・everyoneメンション合計を監視します。',
  },
  {
    kind: 'message_burst',
    label: '短時間の連投',
    description: '同一ユーザーが指定時間内に大量投稿した場合に検知します。',
  },
  {
    kind: 'duplicate_message',
    label: '同一内容の連続投稿',
    description: '同一ユーザーが同じ内容を繰り返した場合に検知します。',
  },
];

export function ModerationConfigForm({
  guildId,
  initialEnabled,
  initialConfig,
}: {
  guildId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
}) {
  const initialDraft = useMemo(() => toModerationConfigDraft(initialConfig), [initialConfig]);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [config, setConfigState] = useState<ModerationConfigDraft>(initialDraft);
  const [activeSection, setActiveSection] = useState<SectionId>('basic');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [jsonText, setJsonText] = useState(JSON.stringify(initialConfig, null, 2));
  const [jsonDirty, setJsonDirty] = useState(false);
  const [newRuleKind, setNewRuleKind] = useState<CustomRuleKind>('word_contains');
  const [newRuleValue, setNewRuleValue] = useState('');
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null);
  const [ruleStatus, setRuleStatus] = useState('');

  const customRuleCount =
    config.autoExactWords.length +
    config.autoContainsWords.length +
    config.autoRegexPatterns.length;
  const enabledBuiltInCount = BUILT_IN_RULE_META.filter((rule) =>
    isBuiltInRuleEnabled(config, rule.kind),
  ).length;

  function setConfig(next: ModerationConfigDraft) {
    setConfigState(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonDirty(false);
    setStatus('未保存の変更があります');
  }

  function patchConfig(patch: Partial<ModerationConfigDraft>) {
    setConfig({ ...config, ...patch });
  }

  async function save() {
    setSaving(true);
    setStatus('保存中…');
    try {
      let payloadConfig: Record<string, unknown> = config;
      if (jsonDirty) {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!isObject(parsed)) {
          setStatus('設定JSONはオブジェクト形式で入力してください');
          return;
        }
        payloadConfig = parsed;
      }

      const response = await fetch(`/api/guilds/${guildId}/plugins/moderation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, config: payloadConfig }),
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(formatApiError(result, '保存に失敗しました'));

      const saved = result?.config ?? payloadConfig;
      setConfigState(toModerationConfigDraft(saved));
      setJsonText(JSON.stringify(saved, null, 2));
      setJsonDirty(false);
      setStatus('保存しました');
    } catch (error) {
      setStatus(
        error instanceof SyntaxError
          ? 'JSONの形式が不正です'
          : error instanceof Error
            ? error.message
            : '保存に失敗しました',
      );
    } finally {
      setSaving(false);
    }
  }

  function applyJsonToGui() {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (!isObject(parsed)) {
        setStatus('設定JSONはオブジェクト形式で入力してください');
        return;
      }
      const next = toModerationConfigDraft(parsed);
      setConfigState(next);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonDirty(false);
      setStatus('JSONをGUIへ反映しました。保存すると本番設定へ適用されます');
    } catch {
      setStatus('JSONの形式が不正です');
    }
  }

  function addRule() {
    const value = newRuleValue.trim();
    const validation = validateRuleValue(newRuleKind, value, config);
    if (validation) {
      setRuleStatus(validation);
      return;
    }
    setConfig(appendCustomRule(config, newRuleKind, value));
    setNewRuleValue('');
    setRuleStatus(`${CUSTOM_RULE_META[newRuleKind].label}ルールを追加しました`);
  }

  function saveEditingRule() {
    if (!editingRule) return;
    const value = editingRule.value.trim();
    const validation = validateRuleValue(editingRule.kind, value, config, editingRule.index);
    if (validation) {
      setRuleStatus(validation);
      return;
    }
    setConfig(updateCustomRule(config, editingRule.kind, editingRule.index, value));
    setEditingRule(null);
    setRuleStatus('ルールを更新しました');
  }

  function deleteRule(kind: CustomRuleKind, index: number) {
    const value = customRuleValues(config, kind)[index] ?? '';
    if (!window.confirm(`「${value}」を削除しますか？`)) return;
    setConfig(removeCustomRule(config, kind, index));
    setEditingRule(null);
    setRuleStatus('ルールを削除しました。自動Case化の紐付けも安全に更新しました');
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Moderation 設定</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            通常はこの画面だけで設定できます。JSONを直接編集する必要はありません。自動検知はobserveのみで、ここからメッセージ削除・Timeout・Kick・BANは実行しません。
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 lg:min-w-56">
          <div>
            <p className="text-sm font-medium">Plugin</p>
            <p className="text-xs text-muted">{enabled ? '有効' : '無効'}</p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Moderation Plugin" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {SECTION_ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:border-primary/40'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {activeSection === 'basic' ? (
          <BasicSection config={config} patchConfig={patchConfig} setConfig={setConfig} />
        ) : null}
        {activeSection === 'rules' ? (
          <RulesSection
            config={config}
            setConfig={setConfig}
            patchConfig={patchConfig}
            newRuleKind={newRuleKind}
            setNewRuleKind={setNewRuleKind}
            newRuleValue={newRuleValue}
            setNewRuleValue={setNewRuleValue}
            addRule={addRule}
            editingRule={editingRule}
            setEditingRule={setEditingRule}
            saveEditingRule={saveEditingRule}
            deleteRule={deleteRule}
            ruleStatus={ruleStatus}
          />
        ) : null}
        {activeSection === 'cases' ? (
          <AutoCaseSection config={config} setConfig={setConfig} patchConfig={patchConfig} />
        ) : null}
        {activeSection === 'exemptions' ? (
          <ExemptionsSection config={config} patchConfig={patchConfig} />
        ) : null}
        {activeSection === 'json' ? (
          <AdvancedJsonSection
            jsonText={jsonText}
            jsonDirty={jsonDirty}
            setJsonText={(value) => {
              setJsonText(value);
              setJsonDirty(true);
              setStatus('JSONに未保存の変更があります');
            }}
            applyJsonToGui={applyJsonToGui}
          />
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm text-muted" aria-live="polite">
          <p>{status || '変更後は保存してください'}</p>
          <p className="mt-1 text-xs">
            カスタムルール {customRuleCount}件 · 有効な既存ルール {enabledBuiltInCount}件
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中…' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}

function BasicSection({
  config,
  patchConfig,
  setConfig,
}: {
  config: ModerationConfigDraft;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
  setConfig: (config: ModerationConfigDraft) => void;
}) {
  return (
    <SectionPanel
      title="基本設定"
      description="手動モデレーションと自動検知全体の動作を設定します。"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingCard title="自動検知モード" description="observeは検知履歴だけを記録します。">
          <select
            value={config.automaticMode}
            onChange={(event) =>
              patchConfig({
                automaticMode: event.target.value === 'observe' ? 'observe' : 'disabled',
              })
            }
            className={inputClassName}
          >
            <option value="disabled">無効</option>
            <option value="observe">Observe（記録のみ）</option>
          </select>
        </SettingCard>
        <SettingCard
          title="検査する本文の最大文字数"
          description="この文字数を超える本文は自動検知対象外です。100〜4000。"
        >
          <NumberInput
            value={config.autoMaxMessageLength}
            min={100}
            max={4000}
            onChange={(value) => patchConfig({ autoMaxMessageLength: value })}
          />
        </SettingCard>
        <ToggleSetting
          title="理由を必須にする"
          description="warn・timeout・kick・banで理由入力を必須にします。"
          checked={config.requireReason}
          onChange={(checked) => patchConfig({ requireReason: checked })}
        />
        <ToggleSetting
          title="対象ユーザーへDM通知"
          description="手動モデレーション時に対象ユーザーへDMを送ります。"
          checked={config.dmTarget}
          onChange={(checked) => patchConfig({ dmTarget: checked })}
        />
        <ToggleSetting
          title="コマンド応答を本人だけに表示"
          description="Discordコマンド結果をEphemeralで返します。"
          checked={config.defaultResponseEphemeral}
          onChange={(checked) => patchConfig({ defaultResponseEphemeral: checked })}
        />
        <SettingCard
          title="ログ送信先チャンネルID"
          description="未指定ならDiscordへの追加ログ送信を行いません。"
        >
          <input
            value={config.logChannelId ?? ''}
            inputMode="numeric"
            placeholder="例: 123456789012345678"
            onChange={(event) => patchConfig({ logChannelId: event.target.value.trim() || null })}
            className={inputClassName}
          />
        </SettingCard>
        <SettingCard title="理由の最大文字数" description="1〜1000文字。">
          <NumberInput
            value={config.maxReasonLength}
            min={1}
            max={1000}
            onChange={(value) => patchConfig({ maxReasonLength: value })}
          />
        </SettingCard>
        <SettingCard title="Case保持日数" description="30〜3650日。">
          <NumberInput
            value={config.caseRetentionDays}
            min={30}
            max={3650}
            onChange={(value) => patchConfig({ caseRetentionDays: value })}
          />
        </SettingCard>
      </div>
      <div className="mt-4">
        <IdListEditor
          title="実行を許可するモデレーターロールID"
          description="空の場合はDiscord権限だけで判定します。"
          values={config.allowedModeratorRoleIds}
          onChange={(values) => setConfig({ ...config, allowedModeratorRoleIds: values })}
        />
      </div>
    </SectionPanel>
  );
}

function RulesSection({
  config,
  setConfig,
  patchConfig,
  newRuleKind,
  setNewRuleKind,
  newRuleValue,
  setNewRuleValue,
  addRule,
  editingRule,
  setEditingRule,
  saveEditingRule,
  deleteRule,
  ruleStatus,
}: {
  config: ModerationConfigDraft;
  setConfig: (config: ModerationConfigDraft) => void;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
  newRuleKind: CustomRuleKind;
  setNewRuleKind: (kind: CustomRuleKind) => void;
  newRuleValue: string;
  setNewRuleValue: (value: string) => void;
  addRule: () => void;
  editingRule: EditingRule | null;
  setEditingRule: (rule: EditingRule | null) => void;
  saveEditingRule: () => void;
  deleteRule: (kind: CustomRuleKind, index: number) => void;
  ruleStatus: string;
}) {
  return (
    <div className="space-y-6">
      <SectionPanel
        title="カスタムルール"
        description="完全一致・部分一致・制限付き正規表現をGUIから作成できます。"
      >
        <div className="rounded-xl border border-border bg-background p-4">
          <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">ルール種類</span>
              <select
                value={newRuleKind}
                onChange={(event) => setNewRuleKind(event.target.value as CustomRuleKind)}
                className={inputClassName}
              >
                <option value="word_exact">完全一致</option>
                <option value="word_contains">部分一致</option>
                <option value="word_regex">正規表現</option>
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium">検知する文字列・パターン</span>
              <input
                value={newRuleValue}
                onChange={(event) => setNewRuleValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addRule();
                  }
                }}
                maxLength={120}
                placeholder={newRuleKind === 'word_regex' ? '例: foo.*bar' : '例: 検知したい文字列'}
                className={inputClassName}
              />
            </label>
            <button
              type="button"
              onClick={addRule}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> 追加
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            1ルール120文字まで。完全一致・部分一致は各100件、正規表現は20件までです。
          </p>
          {ruleStatus ? <p className="mt-2 text-sm text-muted">{ruleStatus}</p> : null}
        </div>

        <div className="mt-4 space-y-3">
          {(['word_exact', 'word_contains', 'word_regex'] as CustomRuleKind[]).flatMap((kind) =>
            customRuleValues(config, kind).map((value, index) => {
              const selector = customRuleSelector(kind, index);
              const selectedForCase = config.autoCaseOnConfirmedRules.includes(selector);
              const isEditing = editingRule?.kind === kind && editingRule.index === index;
              return (
                <div key={selector} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium">
                          {CUSTOM_RULE_META[kind].shortLabel}
                        </span>
                        <span className="text-xs text-muted">#{index + 1}</span>
                        {selectedForCase ? (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <CheckCircle2 className="h-3.5 w-3.5" /> 自動Case対象
                          </span>
                        ) : null}
                      </div>
                      {isEditing ? (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <input
                            value={editingRule.value}
                            onChange={(event) =>
                              setEditingRule({ ...editingRule, value: event.target.value })
                            }
                            maxLength={120}
                            className={inputClassName}
                          />
                          <button
                            type="button"
                            onClick={saveEditingRule}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                          >
                            更新
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingRule(null)}
                            className="rounded-lg border border-border px-4 py-2 text-sm"
                          >
                            キャンセル
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 break-all font-mono text-sm leading-6">{value}</p>
                      )}
                    </div>
                    {!isEditing ? (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingRule({ kind, index, value })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/40"
                        >
                          <Pencil className="h-4 w-4" /> 編集
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(kind, index)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:border-red-400"
                        >
                          <Trash2 className="h-4 w-4" /> 削除
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }),
          )}
          {config.autoExactWords.length +
            config.autoContainsWords.length +
            config.autoRegexPatterns.length ===
          0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              カスタムルールはまだありません。上のフォームから追加できます。
            </div>
          ) : null}
        </div>
      </SectionPanel>

      <SectionPanel
        title="既存ルール"
        description="Hertaに組み込まれている検知をON/OFFし、閾値を設定します。"
      >
        <div className="space-y-4">
          <BuiltInRuleCard
            title="Discord招待リンク"
            description="許可リスト以外のdiscord.gg / discord.com/inviteリンクを検知します。"
            enabled={config.autoInviteFilterEnabled}
            onEnabledChange={(checked) =>
              setConfig(setBuiltInRuleEnabled(config, 'invite_link', checked))
            }
          >
            <StringListEditor
              title="許可する招待コード"
              description="discord.gg/ より後ろのコードだけを入力します。"
              values={config.autoInviteAllowlist}
              placeholder="例: abcDEF12"
              validate={(value) =>
                /^[A-Za-z0-9-]{2,64}$/.test(value)
                  ? null
                  : '2〜64文字の英数字・ハイフンで入力してください'
              }
              onChange={(values) => patchConfig({ autoInviteAllowlist: values })}
            />
          </BuiltInRuleCard>

          <BuiltInRuleCard
            title="大量メンション"
            description="User・Role・everyoneの合計メンション数が閾値以上なら検知します。"
            enabled={config.autoMentionLimit > 0}
            onEnabledChange={(checked) =>
              setConfig(setBuiltInRuleEnabled(config, 'mention_burst', checked))
            }
          >
            <NumberSetting
              label="検知するメンション数"
              value={config.autoMentionLimit}
              min={1}
              max={100}
              disabled={config.autoMentionLimit === 0}
              onChange={(value) => patchConfig({ autoMentionLimit: value })}
            />
          </BuiltInRuleCard>

          <BuiltInRuleCard
            title="短時間の連投"
            description="指定秒数の間に同一ユーザーが一定数以上投稿した場合に検知します。"
            enabled={config.autoBurstMessageLimit > 0}
            onEnabledChange={(checked) =>
              setConfig(setBuiltInRuleEnabled(config, 'message_burst', checked))
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberSetting
                label="メッセージ数"
                value={config.autoBurstMessageLimit}
                min={1}
                max={50}
                disabled={config.autoBurstMessageLimit === 0}
                onChange={(value) => patchConfig({ autoBurstMessageLimit: value })}
              />
              <NumberSetting
                label="監視時間（秒）"
                value={config.autoBurstWindowSeconds}
                min={1}
                max={300}
                disabled={config.autoBurstMessageLimit === 0}
                onChange={(value) => patchConfig({ autoBurstWindowSeconds: value })}
              />
            </div>
          </BuiltInRuleCard>

          <BuiltInRuleCard
            title="同一内容の連続投稿"
            description="同じ内容を指定時間内に繰り返した場合に検知します。"
            enabled={config.autoDuplicateMessageLimit > 0}
            onEnabledChange={(checked) =>
              setConfig(setBuiltInRuleEnabled(config, 'duplicate_message', checked))
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberSetting
                label="同一投稿数"
                value={config.autoDuplicateMessageLimit}
                min={1}
                max={20}
                disabled={config.autoDuplicateMessageLimit === 0}
                onChange={(value) => patchConfig({ autoDuplicateMessageLimit: value })}
              />
              <NumberSetting
                label="監視時間（秒）"
                value={config.autoDuplicateWindowSeconds}
                min={1}
                max={600}
                disabled={config.autoDuplicateMessageLimit === 0}
                onChange={(value) => patchConfig({ autoDuplicateWindowSeconds: value })}
              />
            </div>
          </BuiltInRuleCard>
        </div>
      </SectionPanel>
    </div>
  );
}

function AutoCaseSection({
  config,
  setConfig,
  patchConfig,
}: {
  config: ModerationConfigDraft;
  setConfig: (config: ModerationConfigDraft) => void;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
}) {
  return (
    <SectionPanel
      title="正検知確定時の自動Case化"
      description="人が「正検知」として保存した後だけ、選択したルールを非処罰のflag Caseへ記録します。"
    >
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">自動Case化を有効にする</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              Case記録のみです。メッセージ削除・警告・Timeout・Kick・BANは実行しません。
            </p>
          </div>
          <Toggle
            checked={config.autoCaseOnConfirmedEnabled}
            onChange={(checked) => patchConfig({ autoCaseOnConfirmedEnabled: checked })}
            label="正検知確定時の自動Case化"
          />
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">カスタムルール</h3>
        <div className="mt-2 space-y-2">
          {(['word_exact', 'word_contains', 'word_regex'] as CustomRuleKind[]).flatMap((kind) =>
            customRuleValues(config, kind).map((value, index) => {
              const selector = customRuleSelector(kind, index);
              return (
                <CaseRuleRow
                  key={selector}
                  title={`${CUSTOM_RULE_META[kind].label} #${index + 1}`}
                  description={value}
                  checked={config.autoCaseOnConfirmedRules.includes(selector)}
                  disabled={!config.autoCaseOnConfirmedEnabled}
                  onChange={(checked) => setConfig(setAutoCaseRule(config, selector, checked))}
                />
              );
            }),
          )}
          {config.autoExactWords.length +
            config.autoContainsWords.length +
            config.autoRegexPatterns.length ===
          0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
              カスタムルールがありません。「検知ルール」から作成してください。
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">既存ルール</h3>
        <div className="mt-2 space-y-2">
          {BUILT_IN_RULE_META.map((rule) => {
            const ruleEnabled = isBuiltInRuleEnabled(config, rule.kind);
            return (
              <CaseRuleRow
                key={rule.kind}
                title={rule.label}
                description={
                  ruleEnabled
                    ? rule.description
                    : `${rule.description} 現在この検知ルールは無効です。`
                }
                checked={config.autoCaseOnConfirmedRules.includes(rule.kind)}
                disabled={!config.autoCaseOnConfirmedEnabled || !ruleEnabled}
                onChange={(checked) => setConfig(setAutoCaseRule(config, rule.kind, checked))}
              />
            );
          })}
        </div>
      </div>
    </SectionPanel>
  );
}

function ExemptionsSection({
  config,
  patchConfig,
}: {
  config: ModerationConfigDraft;
  patchConfig: (patch: Partial<ModerationConfigDraft>) => void;
}) {
  return (
    <SectionPanel
      title="自動検知の除外設定"
      description="ここに登録した対象は自動検知から除外されます。手動モデレーションには影響しません。"
    >
      <div className="space-y-4">
        <IdListEditor
          title="除外チャンネルID"
          description="Botコマンド用や管理者専用など、監視しないチャンネルを登録します。"
          values={config.autoExemptChannelIds}
          onChange={(values) => patchConfig({ autoExemptChannelIds: values })}
        />
        <IdListEditor
          title="除外ロールID"
          description="このロールを1つでも持つユーザーを自動検知から除外します。"
          values={config.autoExemptRoleIds}
          onChange={(values) => patchConfig({ autoExemptRoleIds: values })}
        />
        <IdListEditor
          title="除外ユーザーID"
          description="Bot・管理者など個別ユーザーを自動検知から除外します。"
          values={config.autoExemptUserIds}
          onChange={(values) => patchConfig({ autoExemptUserIds: values })}
        />
      </div>
    </SectionPanel>
  );
}

function AdvancedJsonSection({
  jsonText,
  jsonDirty,
  setJsonText,
  applyJsonToGui,
}: {
  jsonText: string;
  jsonDirty: boolean;
  setJsonText: (value: string) => void;
  applyJsonToGui: () => void;
}) {
  return (
    <SectionPanel
      title="高度なJSON設定"
      description="従来どおりJSONを直接編集できます。通常の設定はGUIの利用を推奨します。"
    >
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm leading-6 text-muted">
        JSONのキー構造は従来と同じです。ここで変更した内容は保存時にそのままAPIへ送信され、サーバー側Schemaで検証されます。
      </div>
      <textarea
        value={jsonText}
        onChange={(event) => setJsonText(event.target.value)}
        rows={24}
        spellCheck={false}
        aria-label="Moderation設定JSON"
        className="mt-4 w-full rounded-xl border border-border bg-background p-4 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {jsonDirty ? 'JSONに未反映の変更があります。' : 'GUIとJSONは同期しています。'}
        </p>
        <button
          type="button"
          onClick={applyJsonToGui}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-primary/40"
        >
          JSONをGUIへ反映
        </button>
      </div>
    </SectionPanel>
  );
}

function SectionPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function SettingCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 min-h-10 text-xs leading-5 text-muted">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ToggleSetting({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-background p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

function BuiltInRuleCard({
  title,
  description,
  enabled,
  onEnabledChange,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        </div>
        <Toggle checked={enabled} onChange={onEnabledChange} label={title} />
      </div>
      {enabled ? <div className="mt-4 border-t border-border pt-4">{children}</div> : null}
    </div>
  );
}

function CaseRuleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-border p-3 ${
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-primary/40'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-border accent-current"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block break-all text-xs leading-5 text-muted">{description}</span>
      </span>
    </label>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <NumberInput value={value} min={min} max={max} disabled={disabled} onChange={onChange} />
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(event) => {
        const next = Number.parseInt(event.target.value, 10);
        if (Number.isFinite(next)) onChange(next);
      }}
      className={`${inputClassName} disabled:cursor-not-allowed disabled:opacity-50`}
    />
  );
}

function IdListEditor({
  title,
  description,
  values,
  onChange,
}: {
  title: string;
  description: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <StringListEditor
      title={title}
      description={description}
      values={values}
      placeholder="Discord IDを入力"
      validate={(value) => (/^\d+$/.test(value) ? null : 'Discord IDは数字のみで入力してください')}
      onChange={onChange}
    />
  );
}

function StringListEditor({
  title,
  description,
  values,
  placeholder,
  validate,
  onChange,
}: {
  title: string;
  description: string;
  values: string[];
  placeholder: string;
  validate: (value: string) => string | null;
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  function add() {
    const value = input.trim();
    if (!value) return;
    const validation = validate(value);
    if (validation) {
      setError(validation);
      return;
    }
    if (values.includes(value)) {
      setError('すでに登録されています');
      return;
    }
    onChange([...values, value]);
    setInput('');
    setError('');
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={inputClassName}
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-primary/40"
        >
          <Plus className="h-4 w-4" /> 追加
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
      {values.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs"
            >
              <span className="break-all">{value}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== value))}
                aria-label={`${value}を削除`}
                className="shrink-0 text-muted hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">登録なし</p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
        checked ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function validateRuleValue(
  kind: CustomRuleKind,
  value: string,
  config: ModerationConfigDraft,
  editingIndex?: number,
): string | null {
  if (!value) return '検知する文字列・パターンを入力してください';
  if (value.length > 120) return '120文字以内で入力してください';
  const values = customRuleValues(config, kind);
  if (values.some((item, index) => item === value && index !== editingIndex)) {
    return '同じルールがすでに登録されています';
  }
  if (editingIndex === undefined && values.length >= CUSTOM_RULE_META[kind].limit) {
    return `${CUSTOM_RULE_META[kind].label}ルールは最大${CUSTOM_RULE_META[kind].limit}件です`;
  }
  if (kind === 'word_regex') {
    try {
      new RegExp(value, 'iu');
    } catch {
      return '正規表現の形式が不正です';
    }
  }
  return null;
}

async function readResponse(response: Response): Promise<PluginUpdateResponse | null> {
  try {
    return (await response.json()) as PluginUpdateResponse;
  } catch {
    return null;
  }
}

function formatApiError(result: PluginUpdateResponse | null, fallback: string): string {
  const message = typeof result?.error === 'string' ? result.error : fallback;
  if (!Array.isArray(result?.details)) return message;

  const details = result.details
    .map((detail) => {
      if (!isObject(detail)) return null;
      const path = typeof detail.instancePath === 'string' ? detail.instancePath : '';
      const description = typeof detail.message === 'string' ? detail.message : '';
      if (!path && !description) return null;
      return `${path || '設定'} ${description}`.trim();
    })
    .filter((detail): detail is string => Boolean(detail));

  return details.length > 0 ? `${message}: ${details.join('、')}` : message;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const inputClassName =
  'h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ring';
