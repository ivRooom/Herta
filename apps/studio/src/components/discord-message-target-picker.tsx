'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, MessageSquareText } from 'lucide-react';

import type { GuildChannelOption } from '@/lib/bot-guild-options';
import {
  buildDiscordMessageUrl,
  normalizeDiscordMessageTarget,
  parseDiscordMessageReference,
  type DiscordMessageTarget,
} from '@/lib/discord-message-target';
import { DiscordChannelPicker } from './discord-entity-picker';

export function DiscordMessageTargetPicker({
  guildId,
  channels,
  value,
  onChange,
}: {
  guildId: string;
  channels: GuildChannelOption[];
  value: unknown;
  onChange: (value: DiscordMessageTarget) => void;
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

  function applyReference(input: string) {
    const parsed = parseDiscordMessageReference(input, guildId, target.channelId);
    if (!parsed) {
      setError(
        target.channelId
          ? 'Message IDまたは同じGuildのDiscordメッセージURLを入力してください。'
          : '先にChannelを選択するか、同じGuildのDiscordメッセージURLを貼り付けてください。',
      );
      setReferenceText(target.messageId);
      return;
    }
    if (!channelIds.has(parsed.channelId)) {
      setError('Botが閲覧・履歴参照できるテキストChannelのメッセージを指定してください。');
      setReferenceText(target.messageId);
      return;
    }
    setError('');
    setReferenceText(parsed.messageId);
    onChange(parsed);
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
              setReferenceText('');
              onChange({ channelId, messageId: '' });
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
                if (target.messageId) onChange({ channelId: target.channelId, messageId: '' });
                return;
              }
              if (next.includes('/channels/')) applyReference(next);
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
    </div>
  );
}
