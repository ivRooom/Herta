'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Hash, Search, Shield, Smile, X } from 'lucide-react';
import type {
  GuildChannelOption,
  GuildEmojiOption,
  GuildRoleOption,
} from '@/lib/bot-guild-options';

type PickerOption = {
  id: string;
  name: string;
  meta?: string;
  disabled?: boolean;
  color?: string;
};

type PickerProps = {
  options: PickerOption[];
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  placeholder: string;
  emptyMessage: string;
  icon: 'channel' | 'role' | 'emoji';
};

function channelKindLabel(kind: GuildChannelOption['kind']): string {
  if (kind === 'announcement') return 'アナウンス';
  if (kind === 'forum') return 'フォーラム';
  if (kind === 'thread') return 'スレッド';
  return 'テキスト';
}

export function DiscordChannelPicker({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'チャンネル名またはIDを検索',
}: {
  options: GuildChannelOption[];
  value: string | string[] | null;
  onChange: (value: string | string[] | null) => void;
  multiple?: boolean;
  placeholder?: string;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = options.map((option) => ({
    id: option.id,
    name: option.name,
    meta: channelKindLabel(option.kind),
  }));
  return (
    <DiscordEntityPicker
      options={normalized}
      value={selected}
      onChange={(values) => onChange(multiple ? values : (values[0] ?? null))}
      multiple={multiple}
      placeholder={placeholder}
      emptyMessage="利用できるチャンネル・フォーラム・スレッドが見つかりません"
      icon="channel"
    />
  );
}

export function DiscordRolePicker({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'ロール名またはIDを検索',
  editableOnly = false,
  mentionableOnly = false,
}: {
  options: GuildRoleOption[];
  value: string | string[] | null;
  onChange: (value: string | string[] | null) => void;
  multiple?: boolean;
  placeholder?: string;
  editableOnly?: boolean;
  mentionableOnly?: boolean;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = options.map((option) => ({
    id: option.id,
    name: option.name,
    color: option.color,
    disabled:
      (editableOnly && (!option.editable || option.managed)) ||
      (mentionableOnly && !option.mentionable),
    meta: option.managed
      ? 'Discord管理ロール'
      : editableOnly && !option.editable
        ? 'Botより上位のため操作不可'
        : mentionableOnly && !option.mentionable
          ? 'メンション不可'
          : option.mentionable
            ? 'メンション可'
            : undefined,
  }));
  return (
    <DiscordEntityPicker
      options={normalized}
      value={selected}
      onChange={(values) => onChange(multiple ? values : (values[0] ?? null))}
      multiple={multiple}
      placeholder={placeholder}
      emptyMessage="利用できるロールが見つかりません"
      icon="role"
    />
  );
}

export function DiscordEmojiPicker({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'Emoji名またはIDを検索',
}: {
  options: GuildEmojiOption[];
  value: string | string[] | null;
  onChange: (value: string | string[] | null) => void;
  multiple?: boolean;
  placeholder?: string;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = options.map((option) => ({
    id: option.id,
    name: option.name,
    disabled: !option.available,
    meta: !option.available
      ? '現在利用不可'
      : option.managed
        ? option.animated
          ? '管理Emoji・アニメーション'
          : '管理Emoji'
        : option.animated
          ? 'アニメーション'
          : undefined,
  }));
  return (
    <DiscordEntityPicker
      options={normalized}
      value={selected}
      onChange={(values) => onChange(multiple ? values : (values[0] ?? null))}
      multiple={multiple}
      placeholder={placeholder}
      emptyMessage="利用できるGuild Emojiが見つかりません"
      icon="emoji"
    />
  );
}

function DiscordEntityPicker({
  options,
  value,
  onChange,
  multiple = false,
  placeholder,
  emptyMessage,
  icon,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const optionMap = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const normalizedQuery = query.trim().toLocaleLowerCase('ja');
  const filtered = useMemo(
    () =>
      options.filter((option) => {
        if (!normalizedQuery) return true;
        return (
          option.name.toLocaleLowerCase('ja').includes(normalizedQuery) ||
          option.id.includes(normalizedQuery)
        );
      }),
    [normalizedQuery, options],
  );

  function toggle(option: PickerOption) {
    if (option.disabled) return;
    if (!multiple) {
      onChange([option.id]);
      setQuery('');
      setOpen(false);
      return;
    }
    onChange(
      value.includes(option.id) ? value.filter((id) => id !== option.id) : [...value, option.id],
    );
    setQuery('');
  }

  function remove(id: string) {
    onChange(value.filter((candidate) => candidate !== id));
  }

  function commitManualId() {
    const id = query.replace(/\D/gu, '');
    if (!id || optionMap.get(id)?.disabled) return;
    if (multiple) {
      if (!value.includes(id)) onChange([...value, id]);
    } else {
      onChange([id]);
      setOpen(false);
    }
    setQuery('');
  }

  const Icon = icon === 'channel' ? Hash : icon === 'role' ? Shield : Smile;
  const singleOption = !multiple && value[0] ? optionMap.get(value[0]) : undefined;

  return (
    <div
      className="relative min-w-0"
      onBlur={(event) => {
        const container = event.currentTarget;
        const next = event.relatedTarget;
        if (next instanceof Node && container.contains(next)) return;

        window.setTimeout(() => {
          const active = document.activeElement;
          if (active instanceof Node && container.contains(active)) return;
          setOpen(false);
        }, 0);
      }}
    >
      {multiple && value.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((id) => {
            const option = optionMap.get(id);
            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{option?.name ?? id}</span>
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="rounded p-0.5 text-muted hover:bg-background hover:text-foreground"
                  aria-label={`${option?.name ?? id} を選択解除`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
        {singleOption && !open && !query ? (
          <Icon className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-muted" />
        )}
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const first = filtered.find((option) => !option.disabled);
              if (first) toggle(first);
              else commitManualId();
            }
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder={singleOption && !open ? singleOption.name : placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted"
          role="combobox"
          aria-expanded={open}
        />
        {!multiple && value.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setQuery('');
              setOpen(true);
            }}
            className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
            aria-label="選択解除"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
          aria-label="候補を表示"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open ? (
        <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-2xl">
          {filtered.length > 0 ? (
            filtered.map((option) => {
              const selected = value.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => toggle(option)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-background disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {icon === 'role' ? (
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-white/10"
                      style={{ backgroundColor: option.color || undefined }}
                    />
                  ) : (
                    <Hash className="h-4 w-4 shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.name}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {option.meta ? `${option.meta} · ` : ''}
                      {option.id}
                    </span>
                  </span>
                  {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-4 text-sm text-muted">
              <p>{emptyMessage}</p>
              {/\d/u.test(query) ? (
                <button
                  type="button"
                  onClick={commitManualId}
                  className="mt-2 text-primary hover:underline"
                >
                  入力したIDをそのまま使用
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
