'use client';

import { Check, Search, UserRound, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { GuildMemberOption } from '@/lib/bot-guild-members';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_TIMEOUT_MS = 12_000;

export function BirthdayCardMemberPicker({
  guildId,
  value,
  onChange,
  disabled = false,
}: {
  guildId: string;
  value: GuildMemberOption | null;
  onChange(member: GuildMemberOption | null): void;
  disabled?: boolean;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<GuildMemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const normalizedQuery = query.trim();
  const canSearch = /^\d{17,20}$/u.test(normalizedQuery) || normalizedQuery.length >= 2;

  useEffect(() => {
    if (!canSearch || disabled) {
      setOptions([]);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const debounce = window.setTimeout(() => {
      const timeout = window.setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
      setLoading(true);
      setError('');

      const endpoint = new URL(`/api/guilds/${guildId}/discord/members`, window.location.origin);
      endpoint.searchParams.set('query', normalizedQuery);
      endpoint.searchParams.set('limit', '12');
      void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as {
            error?: unknown;
            members?: GuildMemberOption[];
          } | null;
          if (!response.ok || !Array.isArray(payload?.members)) {
            throw new Error(
              typeof payload?.error === 'string'
                ? payload.error
                : 'Discordメンバーを検索できませんでした',
            );
          }
          setOptions(payload.members.filter((member) => !member.bot));
        })
        .catch((cause: unknown) => {
          if (cause instanceof Error && cause.name === 'AbortError') return;
          setOptions([]);
          setError(
            cause instanceof Error ? cause.message : 'Discordメンバーを検索できませんでした',
          );
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [canSearch, disabled, guildId, normalizedQuery]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.displayName}</p>
          <p className="truncate text-xs text-muted">
            @{value.username} · {value.id}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setQuery('');
            setOptions([]);
          }}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          aria-label="プレビューメンバーを解除"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="表示名・ユーザー名・Discord IDを検索"
          aria-controls={canSearch ? listboxId : undefined}
          aria-expanded={canSearch}
          aria-autocomplete="list"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-primary disabled:opacity-50"
        />
      </label>

      {normalizedQuery && !canSearch ? (
        <p className="text-xs text-muted">名前検索は2文字以上入力してください。</p>
      ) : null}
      {loading ? (
        <p className="text-xs text-muted" role="status">
          Discordメンバーを検索中…
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {canSearch && !loading && !error ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Birthday Cardプレビューメンバー候補"
          className="max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1"
        >
          {options.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted">
              一致するDiscordメンバーが見つかりません。
            </p>
          ) : (
            options.map((member) => (
              <button
                key={member.id}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => {
                  onChange(member);
                  setQuery('');
                  setOptions([]);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <UserRound className="h-4 w-4 text-muted" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{member.displayName}</span>
                  <span className="block truncate text-xs text-muted">@{member.username}</span>
                </span>
                <Check className="h-4 w-4 text-primary opacity-0" aria-hidden="true" />
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}