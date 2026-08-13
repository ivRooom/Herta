'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import { DiscordUserPicker } from './discord-user-picker';
import type { XpAdminGuildSummary, XpAdminProfile, XpAdminResult } from '@/lib/xp-admin-core';

type XpRoleSweepStatus = {
  requestId: string;
  status: 'queued' | 'completed' | 'failed';
  reason: string | null;
  createdAt: string;
  result: Record<string, unknown> | null;
};

type XpAdminPayload = {
  error?: string;
  summary?: XpAdminGuildSummary;
  profile?: XpAdminProfile | null;
  result?: XpAdminResult;
  rewardRoleSyncPublished?: boolean;
  rewardRoleSweep?: { requestId: string; queued: boolean } | null;
};

type XpRoleSweepPayload = {
  error?: string;
  request?: { requestId: string; queued: boolean };
  status?: XpRoleSweepStatus | null;
};

export function LeaderboardXpAdmin({
  guildId,
  initialSummary,
}: {
  guildId: string;
  initialSummary: XpAdminGuildSummary;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<XpAdminProfile | null>(null);
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [roleSweepStatus, setRoleSweepStatus] = useState<XpRoleSweepStatus | null>(null);

  useEffect(() => {
    let active = true;
    void fetchRoleSweepStatus(guildId).then((next) => {
      if (active) setRoleSweepStatus(next);
    });
    return () => {
      active = false;
    };
  }, [guildId]);

  useEffect(() => {
    if (roleSweepStatus?.status !== 'queued') return;

    let active = true;
    const refresh = async () => {
      const next = await fetchRoleSweepStatus(guildId);
      if (active && next) setRoleSweepStatus(next);
    };
    const interval = window.setInterval(() => void refresh(), 2_000);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [guildId, roleSweepStatus?.requestId, roleSweepStatus?.status]);

  async function selectUser(value: string | string[] | null) {
    const userId = typeof value === 'string' ? value : null;
    setSelectedUserId(userId);
    setProfile(null);
    setStatus('');
    if (!userId) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/leaderboard/xp?userId=${encodeURIComponent(userId)}`,
        { cache: 'no-store' },
      );
      const payload = (await response.json().catch(() => null)) as XpAdminPayload | null;
      if (!response.ok) throw new Error(payload?.error ?? 'XP情報を取得できませんでした');
      if (payload?.summary) setSummary(payload.summary);
      setProfile(payload?.profile ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'XP情報の取得に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function operate(action: 'add' | 'subtract' | 'set' | 'reset_user') {
    if (!selectedUserId) return;
    if (action === 'reset_user') {
      const confirmed = window.confirm(
        'このメンバーのXP履歴を0へリセットします。元に戻せません。実行しますか？',
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setStatus('XPを更新中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/leaderboard/xp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          userId: selectedUserId,
          amount: action === 'reset_user' ? null : amount,
          reason: reason.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as XpAdminPayload | null;
      if (!response.ok) throw new Error(payload?.error ?? 'XP操作に失敗しました');
      if (payload?.summary) setSummary(payload.summary);
      setProfile(payload?.profile ?? null);
      const result = payload?.result;
      if (result?.rewardRoleSyncRequired) {
        setStatus(
          payload?.rewardRoleSyncPublished
            ? 'XPを更新し、Level報酬Roleの自動再同期イベントをBotへ送信しました。'
            : 'XPは更新済みですが、Botが再同期イベントを購読していないためRoleは未同期です。',
        );
      } else {
        setStatus(
          result?.changed
            ? 'XPを更新しました。Audit Logへ記録済みです。'
            : '値に変化はありませんでした。操作履歴はAudit Logへ記録済みです。',
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'XP操作に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function runRoleSweep() {
    setSweepBusy(true);
    setStatus('全メンバーのXP報酬Role修復をキューへ送信中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/leaderboard/xp/roles/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: reason.trim() || null }),
      });
      const payload = (await response.json().catch(() => null)) as XpRoleSweepPayload | null;
      if (payload?.status !== undefined) setRoleSweepStatus(payload.status ?? null);
      if (!response.ok) {
        setStatus(payload?.error ?? 'XP報酬Role一括修復を開始できませんでした');
        return;
      }
      setStatus('XP報酬Role一括修復をBotへ送信しました。完了まで状態を自動更新します。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'XP報酬Role一括修復に失敗しました');
    } finally {
      setSweepBusy(false);
    }
  }

  async function resetGuild() {
    if (confirmation !== `RESET ${guildId}` || reason.trim().length < 3) return;
    const confirmed = window.confirm(
      `このサーバーのXPプロフィール ${summary.profiles.toLocaleString()} 件をすべて削除します。本当に実行しますか？`,
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus('サーバー全体のXPをリセット中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/leaderboard/xp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_guild',
          reason: reason.trim(),
          confirmation,
        }),
      });
      const payload = (await response.json().catch(() => null)) as XpAdminPayload | null;
      if (!response.ok) throw new Error(payload?.error ?? 'サーバー全体XPリセットに失敗しました');
      if (payload?.summary) setSummary(payload.summary);
      setProfile(selectedUserId ? { userId: selectedUserId, xp: 0, level: 0, rank: null } : null);
      setConfirmation('');
      const sweep = payload?.rewardRoleSweep;
      setStatus(
        sweep?.queued
          ? 'サーバー全体のXPをリセットし、Level報酬Roleの全体修復もBotへ送信しました。'
          : 'サーバー全体のXPはリセットしましたが、Botが一括修復イベントを購読していないためRoleは未同期です。',
      );
      setRoleSweepStatus(await fetchRoleSweepStatus(guildId));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'サーバー全体XPリセットに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">XP Admin Controls</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            メンバーXPの加算・減算・直接設定・リセットを行います。すべてAudit Logへ記録されます。
          </p>
        </div>
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted">
          個人XP変更は即時Role再同期、全体操作は追跡可能な一括修復キューで処理します。
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat icon={Users} label="XPプロフィール" value={summary.profiles.toLocaleString()} />
        <Stat icon={Sparkles} label="総XP" value={summary.totalXp.toLocaleString()} />
        <Stat icon={Gauge} label="最高XP" value={summary.highestXp.toLocaleString()} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <div>
          <label className="mb-2 block text-xs font-medium text-muted">対象メンバー</label>
          <DiscordUserPicker
            guildId={guildId}
            value={selectedUserId}
            onChange={(value) => void selectUser(value)}
            includeBots={false}
            placeholder="ユーザー名・表示名・Discord IDで検索"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium text-muted">操作理由（任意）</label>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 240))}
            placeholder="例: イベント報酬の補正"
            className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {profile ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Stat icon={Sparkles} label="現在XP" value={profile.xp.toLocaleString()} />
          <Stat icon={Gauge} label="Level" value={`Lv.${profile.level}`} />
          <Stat icon={Users} label="順位" value={profile.rank ? `#${profile.rank}` : '未ランク'} />
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-border bg-background p-4">
        <label className="text-xs font-medium text-muted">XP値</label>
        <input
          type="number"
          min={0}
          max={100000000}
          step={1}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring"
        />
        <p className="mt-2 text-xs text-muted">
          加算・減算は1回最大10,000,000 XP、直接設定は0〜100,000,000 XPです。
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <ActionButton
            icon={Plus}
            label="加算"
            disabled={!selectedUserId || busy}
            onClick={() => void operate('add')}
          />
          <ActionButton
            icon={Minus}
            label="減算"
            disabled={!selectedUserId || busy}
            onClick={() => void operate('subtract')}
          />
          <ActionButton
            icon={Save}
            label="直接設定"
            disabled={!selectedUserId || busy}
            onClick={() => void operate('set')}
          />
          <ActionButton
            icon={RotateCcw}
            label="個人リセット"
            disabled={!selectedUserId || busy}
            destructive
            onClick={() => void operate('reset_user')}
          />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Level Role Health</h3>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Guild全体のXPとLevel Roleを照合し、足りないRoleを付与、不要なRoleを剥奪します。
              完全な全件修復にはBotのGuild Members Intentが必要です。
            </p>
          </div>
          <button
            type="button"
            disabled={sweepBusy || roleSweepStatus?.status === 'queued'}
            onClick={() => void runRoleSweep()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-surface px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sweepBusy || roleSweepStatus?.status === 'queued' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            全メンバーを再同期
          </button>
        </div>
        <RoleSweepStatusView status={roleSweepStatus} />
      </div>

      <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h3 className="font-semibold text-destructive">Danger Zone — サーバー全体XPリセット</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              全XPプロフィールを削除し、続けてLevel報酬Roleの全体修復を自動要求します。実行理由を3文字以上入力し、確認欄へ
              <code className="mx-1 rounded bg-background px-1.5 py-0.5">RESET {guildId}</code>
              と完全一致で入力してください。
            </p>
          </div>
        </div>
        <input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={`RESET ${guildId}`}
          className="mt-4 w-full rounded-xl border border-destructive/30 bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-destructive/20"
        />
        <button
          type="button"
          disabled={busy || confirmation !== `RESET ${guildId}` || reason.trim().length < 3}
          onClick={() => void resetGuild()}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          サーバー全体XPをリセット
        </button>
      </div>

      {status ? (
        <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3 text-sm">
          {status}
        </div>
      ) : null}
    </section>
  );
}

function RoleSweepStatusView({ status }: { status: XpRoleSweepStatus | null }) {
  if (!status) {
    return <p className="mt-4 text-xs text-muted">一括修復の実行履歴はまだありません。</p>;
  }

  const result = status.result;
  const statusLabel =
    status.status === 'completed' ? '完了' : status.status === 'failed' ? '失敗' : '実行待ち';
  const StatusIcon =
    status.status === 'completed' ? CheckCircle2 : status.status === 'failed' ? XCircle : Loader2;

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusIcon
          className={`h-4 w-4 ${status.status === 'queued' ? 'animate-spin text-primary' : ''}`}
        />
        <span className="font-semibold">{statusLabel}</span>
        <span className="text-muted">{new Date(status.createdAt).toLocaleString('ja-JP')}</span>
        <code className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted">
          {status.requestId.slice(0, 8)}
        </code>
      </div>
      {status.status === 'completed' && result ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <MiniStat label="対象" value={numericResult(result, 'candidates')} />
          <MiniStat label="処理済み" value={numericResult(result, 'processed')} />
          <MiniStat label="Role付与" value={numericResult(result, 'addedRoles')} />
          <MiniStat label="Role剥奪" value={numericResult(result, 'removedRoles')} />
          <MiniStat label="Skip" value={numericResult(result, 'skippedRoles')} />
          <MiniStat label="失敗" value={numericResult(result, 'failedRoles')} />
        </div>
      ) : status.status === 'failed' ? (
        <p className="mt-2 text-xs text-muted">
          BotのGuild Members Intent、XP / Level Pluginの有効状態、Redis接続を確認してください。
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Botが順番に修復しています。完了状態を自動更新します。
        </p>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background px-2.5 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function numericResult(result: Record<string, unknown>, key: string): string {
  const value = result[key];
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';
}

async function fetchRoleSweepStatus(guildId: string): Promise<XpRoleSweepStatus | null> {
  try {
    const response = await fetch(`/api/guilds/${guildId}/leaderboard/xp/roles/reconcile`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as XpRoleSweepPayload | null;
    return payload?.status ?? null;
  } catch {
    return null;
  }
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-3 text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  disabled,
  destructive = false,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  disabled: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        destructive
          ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
          : 'border-border bg-surface hover:border-primary/40 hover:text-primary'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
