'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2, UserPlus } from 'lucide-react';

interface GroupView {
  id: string;
  name: string;
  description: string | null;
}

interface GroupMemberView {
  groupId: string;
  userId: string;
}

export function AccessGroupManager({
  guildId,
  groups,
  members,
  canEdit,
}: {
  guildId: string;
  groups: GroupView[];
  members: GroupMemberView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? 'new');
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const [name, setName] = useState(selectedGroup?.name ?? '');
  const [description, setDescription] = useState(selectedGroup?.description ?? '');
  const [userId, setUserId] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const next = groups.find((group) => group.id === selectedGroupId) ?? null;
    if (!next && selectedGroupId !== 'new') return;
    setName(next?.name ?? '');
    setDescription(next?.description ?? '');
    setNotice(null);
  }, [groups, selectedGroupId]);

  const selectedMembers = members.filter((member) => member.groupId === selectedGroupId);

  async function saveGroup() {
    if (!canEdit || pending || !name.trim()) return;
    setPending(true);
    setNotice(null);
    try {
      const isNew = selectedGroupId === 'new';
      const response = await fetch(`/api/guilds/${guildId}/access-groups`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(isNew ? {} : { groupId: selectedGroupId }), name, description }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        group?: GroupView;
      } | null;
      if (!response.ok) throw new Error(result?.error || 'Groupの保存に失敗しました');
      if (isNew && result?.group?.id) setSelectedGroupId(result.group.id);
      setNotice({ kind: 'success', text: isNew ? 'Groupを作成しました。' : 'Groupを更新しました。' });
      router.refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Groupの保存に失敗しました。' });
    } finally {
      setPending(false);
    }
  }

  async function deleteGroup() {
    if (!canEdit || !selectedGroup || pending) return;
    if (!window.confirm(`Group「${selectedGroup.name}」を削除しますか？MemberとAttachmentも削除されます。`)) return;
    setPending(true);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/access-groups?groupId=${encodeURIComponent(selectedGroup.id)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || 'Groupの削除に失敗しました');
      setSelectedGroupId('new');
      setNotice({ kind: 'success', text: 'Groupを削除しました。' });
      router.refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Groupの削除に失敗しました。' });
    } finally {
      setPending(false);
    }
  }

  async function changeMember(targetUserId: string, add: boolean) {
    if (!canEdit || !selectedGroup || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/access-groups/members`, {
        method: add ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: selectedGroup.id, userId: targetUserId }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || 'Group Member更新に失敗しました');
      if (add) setUserId('');
      setNotice({ kind: 'success', text: add ? 'Memberを追加しました。' : 'Memberを削除しました。' });
      router.refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Group Member更新に失敗しました。' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Groups</p>
          <h2 className="mt-1 text-xl font-semibold">Herta Group</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Discord Roleとは独立したHerta内の権限グループです。UserをまとめてPolicyへAttachできます。</p>
        </div>
        <button type="button" onClick={() => setSelectedGroupId('new')} disabled={!canEdit || pending} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"><Plus className="h-4 w-4" aria-hidden="true" />新規Group</button>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-background p-3">
          <div className="space-y-1" role="list" aria-label="Herta Group一覧">
            {groups.map((group) => <button key={group.id} type="button" onClick={() => setSelectedGroupId(group.id)} aria-pressed={selectedGroupId === group.id} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${selectedGroupId === group.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface'}`}>{group.name}</button>)}
            {groups.length === 0 ? <p className="px-2 py-3 text-sm text-muted">Groupはまだありません。</p> : null}
          </div>
        </aside>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Group名<input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit || pending} maxLength={100} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
            <label className="text-sm font-semibold">説明<input value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit || pending} maxLength={500} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
          </div>
          {selectedGroup ? (
            <div className="rounded-xl border border-border bg-background p-4">
              <h3 className="text-sm font-semibold">Members</h3>
              <div className="mt-3 flex gap-2">
                <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Discord User ID" inputMode="numeric" disabled={!canEdit || pending} className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <button type="button" onClick={() => void changeMember(userId.trim(), true)} disabled={!canEdit || pending || !/^\d{17,20}$/u.test(userId.trim())} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"><UserPlus className="h-4 w-4" aria-hidden="true" />追加</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedMembers.map((member) => <button key={member.userId} type="button" onClick={() => void changeMember(member.userId, false)} disabled={!canEdit || pending} className="rounded-full border border-border px-3 py-1 font-mono text-xs hover:border-red-500/40 hover:text-red-600">{member.userId} ×</button>)}
                {selectedMembers.length === 0 ? <span className="text-xs text-muted">Memberなし</span> : null}
              </div>
            </div>
          ) : null}
          {notice ? <p role="status" className={`rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'}`}>{notice.text}</p> : null}
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <button type="button" onClick={() => void saveGroup()} disabled={!canEdit || pending || !name.trim()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" aria-hidden="true" />{selectedGroup ? '更新' : '作成'}</button>
            {selectedGroup ? <button type="button" onClick={() => void deleteGroup()} disabled={!canEdit || pending} className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden="true" />Group削除</button> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
