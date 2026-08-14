'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, XCircle } from 'lucide-react';
import {
  evaluateMessageActivity,
  normalizeActivityRulesConfig,
  type MessageActivityBlockingReason,
  type MessageActivityNotice,
} from '@herta/shared/activity-rules';
import { DiscordChannelPicker, DiscordRolePicker } from './discord-entity-picker';
import type { GuildChannelOption, GuildRoleOption } from '@/lib/bot-guild-options';

type Props = {
  activityRulesEnabled: boolean;
  activityRulesConfig: Record<string, unknown>;
  xpEnabled: boolean;
  xpConfig: Record<string, unknown>;
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
};

const BLOCKING_REASON_LABELS: Record<MessageActivityBlockingReason, string> = {
  excluded_text_channel: 'このテキストチャンネルはActivity集計から除外されています。',
  excluded_role: '選択したRoleのいずれかがActivity集計から除外されています。',
  command_prefix: '設定済みのコマンドprefixで始まるメッセージです。',
  minimum_message_length: 'メッセージ文字数が設定された最小文字数を下回っています。',
};

const NOTICE_LABELS: Record<MessageActivityNotice, string> = {
  command_check_skipped_without_content:
    'Message Content Intentなしの想定のため、コマンドprefix判定はスキップされます。',
  length_check_skipped_without_content:
    'Message Content Intentなしの想定のため、最小文字数判定はスキップされます。',
};

export function ActivityRulesDiagnostics({
  activityRulesEnabled,
  activityRulesConfig,
  xpEnabled,
  xpConfig,
  channels,
  roles,
}: Props) {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [content, setContent] = useState('こんにちは！');
  const [contentAvailable, setContentAvailable] = useState(true);
  const [secondsSinceLastCount, setSecondsSinceLastCount] = useState('');

  const rules = useMemo(
    () => normalizeActivityRulesConfig(activityRulesEnabled ? activityRulesConfig : undefined),
    [activityRulesConfig, activityRulesEnabled],
  );

  const evaluation = channelId
    ? evaluateMessageActivity(rules, {
        channelId,
        roleIds,
        content,
        contentLength: content.length,
        contentAvailable,
      })
    : null;

  const cooldownSeconds = rules.messageCooldownSeconds;
  const cooldownInput = parseOptionalNonNegativeNumber(secondsSinceLastCount);
  const cooldownElapsed =
    cooldownInput === null || cooldownSeconds <= 0 || cooldownInput >= cooldownSeconds;
  const messagesCounted = Boolean(evaluation?.counted && cooldownElapsed);

  const xpExcludedChannelIds = normalizedIds(xpConfig['excludedChannelIds']);
  const xpExcludedRoleIds = normalizedIds(xpConfig['excludedRoleIds']);
  const xpOwnChannelBlocked = channelId ? xpExcludedChannelIds.includes(channelId) : false;
  const xpOwnRoleBlocked = roleIds.some((roleId) => xpExcludedRoleIds.includes(roleId));
  const activityRulesAppliedToXp = activityRulesEnabled && rules.applyMessageRulesToXp;
  const xpRulesBlocked = Boolean(activityRulesAppliedToXp && evaluation && !evaluation.counted);
  const xpEligibleByStaticRules = Boolean(
    channelId && xpEnabled && !xpOwnChannelBlocked && !xpOwnRoleBlocked && !xpRulesBlocked,
  );

  return (
    <section className="space-y-6 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Gauge className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-semibold">Message Rule Simulator</h2>
          <p className="mt-1 text-sm text-muted">
            保存済み設定を使い、実際のBotと同じActivity
            Rules判定ロジックで発言集計とXP適用を確認します。
          </p>
        </div>
      </div>

      {!activityRulesEnabled ? (
        <Notice>
          Activity Rules Pluginは現在無効です。Messagesの既定集計は継続しますが、XPへのActivity
          Rules連携は適用されません。
        </Notice>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            対象テキストチャンネル
            <span className="mt-1 block text-xs font-normal text-muted">
              名前またはDiscord IDで選択できます。
            </span>
          </label>
          <DiscordChannelPicker
            options={channels}
            value={channelId}
            onChange={(value) => setChannelId(typeof value === 'string' ? value : null)}
            placeholder="診断するチャンネルを選択"
          />

          <label className="block text-sm font-medium">
            メンバーのRole
            <span className="mt-1 block text-xs font-normal text-muted">
              複数選択すると、除外Roleとの一致を確認します。
            </span>
          </label>
          <DiscordRolePicker
            options={roles}
            value={roleIds}
            onChange={(value) => setRoleIds(Array.isArray(value) ? value : value ? [value] : [])}
            multiple
            placeholder="診断するRoleを選択"
          />

          <label className="block text-sm font-medium" htmlFor="activity-diagnostic-content">
            メッセージ本文
          </label>
          <textarea
            id="activity-diagnostic-content"
            value={content}
            onChange={(event) => setContent(event.target.value.slice(0, 2000))}
            rows={5}
            maxLength={2000}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
          />
          <p className="text-right text-xs text-muted">{content.length} / 2000文字</p>

          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <input
              type="checkbox"
              checked={contentAvailable}
              onChange={(event) => setContentAvailable(event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">Message Content Intentを利用できる想定</span>
              <span className="mt-1 block text-xs text-muted">
                OFFにすると、本番でIntentを無効化した場合の安全なfallbackを再現します。
              </span>
            </span>
          </label>

          <label className="block text-sm font-medium" htmlFor="activity-diagnostic-cooldown">
            前回Messages集計からの経過秒数
            <input
              id="activity-diagnostic-cooldown"
              type="number"
              min={0}
              max={86400}
              step={1}
              inputMode="numeric"
              value={secondsSinceLastCount}
              onChange={(event) => setSecondsSinceLastCount(event.target.value)}
              placeholder="未入力 = 初回 / 履歴なし"
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
            />
          </label>
        </div>

        <div className="space-y-4" aria-live="polite">
          {!channelId ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted">
              チャンネルを選択すると診断結果を表示します。
            </div>
          ) : (
            <>
              <DiagnosticCard
                title="Community Messages"
                passed={messagesCounted}
                summary={
                  messagesCounted
                    ? 'この発言は1件として集計されます。'
                    : 'この発言は集計されません。'
                }
              >
                {evaluation?.blockingReason ? (
                  <Reason>{BLOCKING_REASON_LABELS[evaluation.blockingReason]}</Reason>
                ) : !cooldownElapsed ? (
                  <Reason>
                    Activity RulesのCooldown {cooldownSeconds}秒以内のため集計されません。
                  </Reason>
                ) : (
                  <Reason>除外条件に一致していません。</Reason>
                )}
                {evaluation?.matchedCommandPrefix ? (
                  <Reason>一致prefix: {evaluation.matchedCommandPrefix}</Reason>
                ) : null}
                {evaluation?.notices.map((notice) => (
                  <Notice key={notice}>{NOTICE_LABELS[notice]}</Notice>
                ))}
              </DiagnosticCard>

              <DiagnosticCard
                title="XP / Level"
                passed={xpEligibleByStaticRules}
                summary={xpSummary({
                  xpEnabled,
                  xpOwnChannelBlocked,
                  xpOwnRoleBlocked,
                  xpRulesBlocked,
                })}
              >
                {activityRulesAppliedToXp ? (
                  <Reason>Activity Rulesの発言判定をXPにも適用する設定です。</Reason>
                ) : (
                  <Reason>Activity Rulesの発言判定はXPへ適用しない設定です。</Reason>
                )}
                <Notice>
                  XP固有のCooldownはユーザーごとの最終付与時刻に依存するため、この画面では静的ルールのみ判定します。
                </Notice>
              </DiagnosticCard>

              <div className="rounded-xl border border-border bg-background/50 p-4 text-xs text-muted">
                <p className="font-medium text-foreground">現在の主要設定</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  <dt>Messages Cooldown</dt>
                  <dd className="text-right">{rules.messageCooldownSeconds}秒</dd>
                  <dt>最小文字数</dt>
                  <dd className="text-right">{rules.minimumMessageLength}文字</dd>
                  <dt>Command除外</dt>
                  <dd className="text-right">{rules.excludeCommandMessages ? 'ON' : 'OFF'}</dd>
                  <dt>XP連携</dt>
                  <dd className="text-right">{activityRulesAppliedToXp ? 'ON' : 'OFF'}</dd>
                </dl>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function DiagnosticCard({
  title,
  passed,
  summary,
  children,
}: {
  title: string;
  passed: boolean;
  summary: string;
  children: React.ReactNode;
}) {
  const Icon = passed ? CheckCircle2 : XCircle;
  return (
    <section className="rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <Icon
          className={`mt-0.5 h-5 w-5 shrink-0 ${passed ? 'text-emerald-500' : 'text-red-500'}`}
          aria-hidden="true"
        />
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="mt-1 text-sm">{summary}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2 pl-8 text-xs text-muted">{children}</div>
    </section>
  );
}

function Reason({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && /^\d+$/u.test(item));
}

function parseOptionalNonNegativeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function xpSummary(input: {
  xpEnabled: boolean;
  xpOwnChannelBlocked: boolean;
  xpOwnRoleBlocked: boolean;
  xpRulesBlocked: boolean;
}): string {
  if (!input.xpEnabled) return 'XP / Level Pluginが無効なためXPは付与されません。';
  if (input.xpOwnChannelBlocked) return 'XP Level固有の除外チャンネルに一致しています。';
  if (input.xpOwnRoleBlocked) return 'XP Level固有の除外Roleに一致しています。';
  if (input.xpRulesBlocked) return 'Activity Rulesの発言条件によりXP対象外です。';
  return '静的ルール上はXP付与対象です。';
}
