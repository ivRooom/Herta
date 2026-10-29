'use client';

import { useState } from 'react';
import { VALORANT_AGENTS } from '@herta/plugin-catalog';

type SaveResult = {
  enabled?: boolean;
  config?: Record<string, unknown>;
  error?: string;
};

function readRegisteredAgents(config: Record<string, unknown>): string[] {
  const stored = config.enabledAgents;
  if (
    !Array.isArray(stored) ||
    stored.length === 0 ||
    stored.some((agent) => !VALORANT_AGENTS.includes(agent as (typeof VALORANT_AGENTS)[number]))
  ) {
    return [...VALORANT_AGENTS];
  }
  const saved = new Set(stored as string[]);
  return VALORANT_AGENTS.filter((agent) => saved.has(agent));
}

function sameAgents(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((agent, index) => agent === b[index]);
}

/** 全項目のread/writeとPlugin ON/OFF権限を持つユーザーだけが利用する。 */
export function ValorantConfigForm({
  guildId,
  initialEnabled,
  initialConfig,
}: {
  guildId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
}) {
  const [pluginEnabled, setPluginEnabled] = useState(initialEnabled);
  const [commandsEnabled, setCommandsEnabled] = useState(initialConfig.enabled !== false);
  const [registeredAgents, setRegisteredAgents] = useState<string[]>(() => readRegisteredAgents(initialConfig));
  const [saved, setSaved] = useState(() => ({
    pluginEnabled: initialEnabled,
    commandsEnabled: initialConfig.enabled !== false,
    registeredAgents: readRegisteredAgents(initialConfig),
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const dirty =
    pluginEnabled !== saved.pluginEnabled ||
    commandsEnabled !== saved.commandsEnabled ||
    !sameAgents(registeredAgents, saved.registeredAgents);

  function toggleAgent(agent: string) {
    setRegisteredAgents((current) => {
      const next = new Set(current);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return VALORANT_AGENTS.filter((value) => next.has(value));
    });
    setMessage('');
  }

  async function save() {
    if (saving || !dirty || registeredAgents.length === 0) return;
    setSaving(true);
    setMessage('');
    try {
      // configPatchは他の設定を維持し、既存のStudio側権限・schema検証・監査を通す。
      const response = await fetch(`/api/guilds/${guildId}/plugins/valorant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: pluginEnabled,
          configPatch: {
            enabled: commandsEnabled,
            enabledAgents: registeredAgents,
          },
        }),
      });
      const result = (await response.json()) as SaveResult;
      if (!response.ok) {
        setMessage(typeof result.error === 'string' ? result.error : '保存に失敗しました。');
        return;
      }
      const next = {
        pluginEnabled: result.enabled ?? pluginEnabled,
        commandsEnabled: result.config?.enabled !== false,
        registeredAgents: readRegisteredAgents(result.config ?? { enabledAgents: registeredAgents }),
      };
      setSaved(next);
      setPluginEnabled(next.pluginEnabled);
      setCommandsEnabled(next.commandsEnabled);
      setRegisteredAgents(next.registeredAgents);
      setMessage('保存しました。Botへの設定反映はRuntime同期によって行われます。');
    } catch {
      setMessage('通信に失敗しました。接続を確認して再試行してください。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <h2 className="text-lg font-semibold">VALORANT Plugin設定</h2>
        <p className="mt-1 text-sm text-muted">Riot ID連携・戦績確認とVCランダム抽選をサーバー単位で管理します。</p>
        <div className="mt-5 space-y-4">
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-4">
            <span>
              <span className="block font-medium">Pluginを有効にする</span>
              <span className="mt-1 block text-xs text-muted">DiscordへのSlash Command登録を制御します。</span>
            </span>
            <input
              type="checkbox"
              checked={pluginEnabled}
              onChange={(event) => setPluginEnabled(event.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-4">
            <span>
              <span className="block font-medium">VALORANTコマンドを有効にする</span>
              <span className="mt-1 block text-xs text-muted">Plugin内の全サブコマンドを有効化します。</span>
            </span>
            <input
              type="checkbox"
              checked={commandsEnabled}
              onChange={(event) => setCommandsEnabled(event.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">エージェント登録・管理</h2>
            <p className="mt-1 text-sm text-muted">
              /valorant random の候補に含めるエージェントを選択してください。
            </p>
            <p className="mt-2 text-sm font-medium">
              登録済み: {registeredAgents.length} / {VALORANT_AGENTS.length} 名
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setRegisteredAgents([...VALORANT_AGENTS]); setMessage(''); }}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-background"
            >
              全員登録
            </button>
            <button
              type="button"
              onClick={() => { setRegisteredAgents([]); setMessage(''); }}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-background"
            >
              選択解除
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {VALORANT_AGENTS.map((agent) => {
            const checked = registeredAgents.includes(agent);
            return (
              <label
                key={agent}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm transition-colors ${checked ? 'border-primary/50 bg-primary/10' : 'border-border bg-background hover:border-primary/30'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAgent(agent)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="break-words">{agent}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-muted">
          Agentは重複せず割り当てます。VC参加人数以上のAgentを登録してください。Riot ID連携や外部API Keyは抽選に不要です。
        </p>
      </section>

      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border border-border bg-surface/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-sm ${registeredAgents.length === 0 ? 'text-red-300' : 'text-muted'}`} role="status" aria-live="polite">
          {registeredAgents.length === 0
            ? 'エージェントを最低1名登録してください。'
            : message || (dirty ? '未保存の変更があります。' : '設定は保存済みです。')}
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || registeredAgents.length === 0}
          className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}
