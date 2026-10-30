'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';

export interface VcRecapChatMessage {
  segmentId: string | null;
  speaker: { id: string; displayName: string; avatarUrl: string | null };
  text: string;
  startedAt: string;
  endedAt: string;
}

interface SpeakerGroup {
  speaker: VcRecapChatMessage['speaker'];
  messages: VcRecapChatMessage[];
}

const PAGE_SIZE = 100;
const GROUP_GAP_MS = 2 * 60 * 1000;

function groupConsecutiveMessages(messages: readonly VcRecapChatMessage[]): SpeakerGroup[] {
  const groups: SpeakerGroup[] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    const previous = last?.messages[last.messages.length - 1];
    const gap = previous
      ? Date.parse(message.startedAt) - Date.parse(previous.endedAt)
      : Number.POSITIVE_INFINITY;

    if (last && last.speaker.id === message.speaker.id && gap >= 0 && gap <= GROUP_GAP_MS) {
      last.messages.push(message);
    } else {
      groups.push({ speaker: message.speaker, messages: [message] });
    }
  }
  return groups;
}

function timeLabel(dateTime: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(dateTime));
}

/**
 * Already-authorized segments only. This component never fetches transcript data directly.
 * The parent page enforces the Guild boundary and the existing VC Recap view permission.
 */
export function VcRecapTranscriptChat({ messages }: { messages: VcRecapChatMessage[] }) {
  const [speakerId, setSpeakerId] = useState('');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const speakers = useMemo(() => {
    const map = new Map<string, VcRecapChatMessage['speaker']>();
    for (const message of messages) map.set(message.speaker.id, message.speaker);
    return [...map.values()];
  }, [messages]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return messages.filter(
      (message) =>
        (!speakerId || message.speaker.id === speakerId) &&
        (!term ||
          message.text.toLocaleLowerCase().includes(term) ||
          message.speaker.displayName.toLocaleLowerCase().includes(term)),
    );
  }, [messages, search, speakerId]);

  const visible = filtered.slice(0, visibleCount);
  const groups = groupConsecutiveMessages(visible);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <Search className="h-4 w-4" aria-hidden="true" />
            発言を検索
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="発言本文・表示名"
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="block text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <Users className="h-4 w-4" aria-hidden="true" />
            発言者
          </span>
          <select
            value={speakerId}
            onChange={(event) => {
              setSpeakerId(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="">すべての発言者</option>
            {speakers.map((speaker) => (
              <option key={speaker.id} value={speaker.id}>
                {speaker.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 text-xs text-muted" role="status" aria-live="polite">
        {filtered.length}件の発言が一致（{visible.length}件表示）
      </p>

      {groups.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
          条件に一致する発言がありません。
        </p>
      ) : (
        <ol className="mt-5 space-y-5" aria-label="発言の文字起こし">
          {groups.map((group, groupIndex) => (
            <li key={group.messages[0]?.segmentId ?? `group-${groupIndex}`} className="flex min-w-0 items-start gap-3">
              <div className="shrink-0">
                {group.speaker.avatarUrl ? (
                  <Image
                    src={group.speaker.avatarUrl}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary"
                  >
                    {group.speaker.displayName.slice(0, 1)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-2 text-sm font-semibold text-foreground">{group.speaker.displayName}</p>
                <ol className="space-y-1.5">
                  {group.messages.map((message, index) => (
                    <li
                      key={message.segmentId ?? `${message.startedAt}-${index}`}
                      id={message.segmentId ? `vc-segment-${message.segmentId}` : undefined}
                      className="flex min-w-0 flex-col items-start"
                    >
                      <div className="max-w-full rounded-2xl rounded-tl-sm border border-border bg-background px-4 py-2.5">
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
                      </div>
                      <time
                        dateTime={message.startedAt}
                        className="mt-1 pl-1 text-[11px] tabular-nums text-muted"
                      >
                        {timeLabel(message.startedAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              </div>
            </li>
          ))}
        </ol>
      )}

      {filtered.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          className="mt-5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/50"
        >
          次の{Math.min(PAGE_SIZE, filtered.length - visibleCount)}件を表示
        </button>
      ) : null}
    </div>
  );
}
