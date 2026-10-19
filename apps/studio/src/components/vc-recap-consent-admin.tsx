'use client';

import { useState } from 'react';
import { DiscordUserPicker } from './discord-user-picker';

type ConsentPayload = {
  error?: string;
  member?: { userId: string; displayName: string; avatarUrl: string | null };
  consent?: { voiceTranscriptionConsent: boolean; updatedAt: string };
};

export function VcRecapConsentAdmin({ guildId, canEdit }: { guildId: string; canEdit: boolean }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [result, setResult] = useState<ConsentPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function selectUser(value: string | string[] | null) {
    const nextUserId = typeof value === 'string' ? value : null;
    setUserId(nextUserId);
    setResult(null);
    setStatus('');
    if (!nextUserId) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/guilds/${guildId}/vc-recap/consent?userId=${nextUserId}`);
      const payload = (await response.json().catch(() => null)) as ConsentPayload | null;
      setResult(payload ?? { error: '取得に失敗しました' });
    } catch {
      setResult({ error: '取得に失敗しました' });
    } finally {
      setBusy(false);
    }
  }

  async function updateConsent(consent: boolean) {
    if (!userId) return;
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch(`/api/guilds/${guildId}/vc-recap/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, consent }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ConsentPayload | null;
        setStatus(payload?.error ?? '更新に失敗しました');
        return;
      }
      setStatus(consent ? '同意済みに変更しました' : '未同意に変更しました');
      setResult((prev) =>
        prev
          ? {
              ...prev,
              consent: { voiceTranscriptionConsent: consent, updatedAt: new Date().toISOString() },
            }
          : prev,
      );
    } catch {
      setStatus('更新に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <DiscordUserPicker guildId={guildId} value={userId} onChange={selectUser} />

      {result?.error ? <p className="text-sm text-red-600">{result.error}</p> : null}

      {result?.member && result.consent ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <p className="font-medium">{result.member.displayName}</p>
          <p className="mt-1">
            現在の状態:{' '}
            <strong>{result.consent.voiceTranscriptionConsent ? '同意済み' : '未同意'}</strong>
          </p>
          {canEdit ? (
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => updateConsent(true)}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                同意済みにする
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => updateConsent(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
              >
                未同意にする
              </button>
            </div>
          ) : null}
          {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
