'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, UserRound, X } from 'lucide-react';
import type { GuildMemberOption } from '@/lib/bot-guild-members';

type PickerValue = string | string[] | null;

export function DiscordUserPicker({
  guildId,
  value,
  onChange,
  multiple = false,
  placeholder = 'ユーザー名・表示名・IDで検索',
  includeBots = true,
}: {
  guildId: string;
  value: PickerValue;
  onChange(value: PickerValue): void;
  multiple?: boolean;
  placeholder?: string;
  includeBots?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GuildMemberOption[]>([]);
  const [knownMembers, setKnownMembers] = useState<Record<string, GuildMemberOption>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selectedIds = useMemo(
    () => (Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []),
    [value],
  );

  const normalizedQuery = query.trim();
  const queryAllowed = /^\d{17,20}$/u.test(normalizedQuery) || normalizedQuery.length >= 2;

  useEffect(() => {
    if (!queryAllowed) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ query: normalizedQuery, limit: '20' });
      void fetch(`/api/guilds/${guildId}/discord/members?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('ユーザー候補を取得できませんでした');
          const payload = (await response.json()) as { members?: GuildMemberOption[] };
          const members = Array.isArray(payload.members) ? payload.members : [];
          const filtered = includeBots ? members : members.filter((member) => !member.bot);
          setResults(filtered);
          setKnownMembers((current) => {
            const next = { ...current };
            for (const member of filtered) next[member.id] = member;
            return next;
          });
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError(requestError instanceof Error ? requestError.message : '検索に失敗しました');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [guildId, includeBots, normalizedQuery, queryAllowed]);

  function selectUser(userId: string) {
    if (multiple) {
      if (selectedIds.includes(userId)) return;
      onChange([...selectedIds, userId]);
    } else {
      onChange(userId);
    }
    setQuery('');
    setResults([]);
  }

  function removeUser(userId: string) {
    if (multiple) {
      onChange(selectedIds.filter((candidate) => candidate !== userId));
    } else {
      onChange(null);
    }
  }

  const manualIdAvailable =
    includeBots &&
    /^\d{17,20}$/u.test(normalizedQuery) &&
    !selectedIds.includes(normalizedQuery) &&
    !results.some((member) => member.id === normalizedQuery);

  return (
    <div className="space-y-2">
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedIds.map((userId) => {
            const member = knownMembers[userId];
            return (
              <span
                key={userId}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs"
              >
                <UserRound className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 truncate">
                  {member ? member.displayName : userId}
                  {member?.bot ? ' · Bot' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => removeUser(userId)}
                  aria-label={`${member?.displayName ?? userId}を選択解除`}
                  className="rounded-full p-0.5 text-muted hover:bg-surface hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-10 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
        ) : null}
      </div>

      {normalizedQuery && !queryAllowed ? (
        <p className="text-xs text-muted">2文字以上、またはDiscordユーザーIDを入力してください。</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {queryAllowed && (results.length > 0 || manualIdAvailable) ? (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">
          {results.map((member) => {
            const selected = selectedIds.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                disabled={selected}
                onClick={() => selectUser(member.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-background disabled:cursor-default disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {member.displayName}{' '}
                    {member.bot ? <span className="text-xs text-primary">BOT</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    @{member.username} · {member.id}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {selected ? '選択済み' : '選択'}
                </span>
              </button>
            );
          })}
          {manualIdAvailable ? (
            <button
              type="button"
              onClick={() => selectUser(normalizedQuery)}
              className="w-full rounded-lg border-t border-border px-3 py-2.5 text-left text-sm hover:bg-background"
            >
              <span className="block font-medium">IDを直接使用</span>
              <span className="block font-mono text-xs text-muted">{normalizedQuery}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
