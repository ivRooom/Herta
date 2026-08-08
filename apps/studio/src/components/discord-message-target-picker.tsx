'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, MessageSquareText } from 'lucide-react';

import type { GuildChannelOption } from '@/lib/bot-guild-options';
import {
  buildDiscordMessageUrl,
  mergeDiscordMessageTarget,
  normalizeDiscordMessageTarget,
  parseDiscordMessageReference,
  type DiscordMessageTarget,
} from '@/lib/discord-message-target';
import { DiscordChannelPicker } from './discord-entity-picker';

export function DiscordMessageTargetPicker({
  guildId,
  channels,
  value,
  nullable = false,
  onChange,
}: {
  guildId: string;
  channels: GuildChannelOption[];
  value: unknown;
  nullable?: boolean;
  onChange: (value: Record<string, unknown> | null) => void;
}) {
  const target = useMemo(() => normalizeDiscordMessageTarget(value), [value]);
  const [referenceText, setReferenceText] = useState(target.messageId);
  const [error, setError] = useState('');

  useEffect(() => {
    setReferenceText(target.messageId);
  }, [target.messageId]);

  const readableChannels = useMemo(
    () => channels.filter((channel) => channel.viewable && channel.readMessageHistory),
    [channels],
  );
  const channelIds = useMemo(
    () => new Set(readableChannels.map((channel) => channel.id)),
    [readableChannels],
  );
  const jumpUrl = buildDiscordMessageUrl(guildId, target);

  function emitTarget(next: DiscordMessageTarget | null) {
    onChange(mergeDiscordMessageTarget(value, next));
  }

  function restoreLastValidReference(message: string) {
    setError(message);
    setReferenceText(target.messageId);
  }

  function applyReference(input: string) {
    const parsed = parseDiscordMessageReference(input, guildId, target.channelId);
    if (!parsed) {
      restoreLastValidReference(
        target.channelId
          ? 'Message IDまたは同じGuildのDiscordメッセージURLを入力してください。'
          : '先にChannelを選択するか、同じGuildのDiscordメッセージURLを貼り付けてください。',
      );
      return;
    }
    if (!channelIds.has(parsed.channelId)) {
      restoreLastValidReference(
        'Botが閲覧・履歴参照できるテキストChannelのメッセージを指定してください。',
      );
      return;
    }
    setError('');
    setReferenceText(parsed.messageId);
    emitTarget(parsed);
  }

  if (nullable && value === null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
        <span className="text-sm text-muted">未設定（null）</span>
        <button
          type="button"
          onClick={() => emitTarget({ channelId: '', messageId: '' })}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface"
        >
          Targetを設定
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div>
        <p className="text-sm font-medium">Channel</p>
        <div className="mt-2">
          <DiscordChannelPicker
            options={readableChannels}
            value={target.channelId || null}
            placeholder="Botがメッセージ履歴を参照できるChannelを検索"
            onChange={(next) => {
              const channelId = Array.isArray(next) ? (next[0] ?? '') : (next ?? '');
              setError('');
              if (channelId === target.channelId) return;
              setReferenceText('');
              emitTarget({ channelId, messageId: '' });
            }}
          />
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Message ID / URL</span>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
          <MessageSquareText className="h-4 w-4 shrink-0 text-muted" />
          <input
            value={referenceText}
            onChange={(event) => {
              const next = event.target.value;
              setReferenceText(next);
              setError('');
              if (!next.trim()) {
                if (target.messageId) emitTarget({ channelId: target.channelId, messageId: '' });
                return;
              }
              const parsed = parseDiscordMessageReference(next, guildId, target.channelId);
              if (parsed && channelIds.has(parsed.channelId)) applyReference(next);
            }}
            onBlur={() => {
              if (referenceText.trim() && referenceText.trim() !== target.messageId) {
                applyReference(referenceText);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyReference(referenceText);
              }
            }}
            placeholder="Message IDまたはDiscordメッセージURL"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted"
          />
        </div>
      </label>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {jumpUrl ? (
          <a
            href={jumpUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Discordで対象メッセージを開く
          </a>
        ) : (
          <p className="text-xs text-muted">
            ChannelとMessageを指定すると、保存値はChannel ID / Message IDとして保持されます。
          </p>
        )}
        {nullable ? (
          <button
            type="button"
            onClick={() => {
              setError('');
              setReferenceText('');
              emitTarget(null);
            }}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-surface hover:text-foreground"
          >
            未設定に戻す
          </button>
        ) : null}
      </div>
    </div>
  );
}
