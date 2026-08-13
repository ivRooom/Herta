'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Gauge,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import { DiscordUserPicker } from './discord-user-picker';
import type { XpAdminGuildSummary, XpAdminProfile, XpAdminResult } from '@/lib/xp-admin-core';

type XpAdminPayload = {
  error?: string;
  summary?: XpAdminGuildSummary;
  profile?: XpAdminProfile | null;
  result?: XpAdminResult;
  rewardRoleSyncPublished?: boolean;
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
  const [status, setStatus] = useState('');

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
      setStatus(
        'サーバー全体のXPをリセットしました。全メンバーのLevel報酬Role一括再同期は別タスクで対応します。',
      );
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
          個人XP変更でLevelが変化した場合、報酬RoleをBotへ自動再同期します。
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

      <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h3 className="font-semibold text-destructive">Danger Zone — サーバー全体XPリセット</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              全XPプロフィールを削除します。実行理由を3文字以上入力し、確認欄へ
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
