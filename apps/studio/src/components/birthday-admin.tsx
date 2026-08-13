'use client';

import { useState } from 'react';
import { DiscordUserPicker } from './discord-user-picker';
import type { BirthdayRegistration } from '@/lib/birthday-admin-core';

export function BirthdayAdmin({ guildId, initialRegistrations }: { guildId: string; initialRegistrations: BirthdayRegistration[] }) {
  const [registrations, setRegistrations] = useState(initialRegistrations);
  const [userId, setUserId] = useState<string | null>(null);
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [status, setStatus] = useState('');

  async function update(action: 'set' | 'remove') {
    if (!userId) return;
    const response = await fetch(`/api/guilds/${guildId}/birthday`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'set' ? { action, userId, month, day } : { action, userId }),
    });
    const payload = (await response.json()) as { error?: string; registrations?: BirthdayRegistration[] };
    if (!response.ok) {
      setStatus(payload.error ?? '更新に失敗しました');
      return;
    }
    setRegistrations(payload.registrations ?? registrations);
    setStatus(action === 'set' ? '保存しました' : '登録解除しました');
  }

  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
    <div><h2 className="font-semibold">Member Birthday</h2><p className="mt-1 text-sm text-muted">生年は保存せず、誕生日の月日だけを管理します。登録済み {registrations.length} 人。</p></div>
    <DiscordUserPicker guildId={guildId} value={userId} onChange={(value) => setUserId(typeof value === 'string' ? value : null)} includeBots={false} />
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">月<input type="number" min={1} max={12} value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2" /></label><label className="text-sm">日<input type="number" min={1} max={31} value={day} onChange={(event) => setDay(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2" /></label></div>
    <div className="flex gap-2"><button type="button" onClick={() => void update('set')} disabled={!userId} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">保存</button><button type="button" onClick={() => void update('remove')} disabled={!userId} className="rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50">登録解除</button></div>
    <p className="text-sm text-muted" aria-live="polite">{status}</p>
  </section>;
}
