'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Bold,
  Code2,
  Eye,
  ImagePlus,
  Italic,
  Link2,
  MessageSquareText,
  Quote,
  Send,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react';
import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import {
  MESSAGE_STUDIO_IMAGE_MAX_BYTES,
  MESSAGE_STUDIO_IMAGE_MIME_TYPES,
} from '@/lib/message-studio-discord';
import { DiscordChannelPicker } from './discord-entity-picker';

const INPUT_CLASS_NAME =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring';

export function MessageStudioQuickSend({
  guildId,
  maxContentLength,
  allowAnnouncementCrosspost,
  allowUserMentions,
  discordOptions,
}: {
  guildId: string;
  maxContentLength: number;
  allowAnnouncementCrosspost: boolean;
  allowUserMentions: boolean;
  discordOptions?: GuildConfigurationOptions | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [channelId, setChannelId] = useState('');
  const [forumTitle, setForumTitle] = useState('');
  const [content, setContent] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [publishAnnouncement, setPublishAnnouncement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const imagePreviewUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const selectedChannel = discordOptions?.channels.find((channel) => channel.id === channelId) ?? null;
  const isForum = selectedChannel?.kind === 'forum';
  const isAnnouncement = selectedChannel?.kind === 'announcement';

  function wrapMarkdown(before: string, after = before, placeholder = 'テキスト') {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? content.length;
    const end = textarea?.selectionEnd ?? content.length;
    const selected = content.slice(start, end) || placeholder;
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
    setContent(next.slice(0, maxContentLength));
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function selectImage(file: File | null) {
    setError(null);
    if (!file) {
      setImage(null);
      return;
    }
    if (!MESSAGE_STUDIO_IMAGE_MIME_TYPES.includes(file.type as never)) {
      setError('画像はPNG / JPEG / GIF / WebPを選択してください');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size <= 0 || file.size > MESSAGE_STUDIO_IMAGE_MAX_BYTES) {
      setError('画像は8MiB以下にしてください');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setImage(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!channelId) {
      setError('投稿先を選択してください');
      return;
    }
    if (!content.trim() && !image) {
      setError('本文または画像を入力してください');
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.set('channelId', channelId);
      body.set('forumTitle', forumTitle);
      body.set('content', content);
      body.set('publishAnnouncement', String(publishAnnouncement));
      if (image) body.set('image', image);
      const response = await fetch(`/api/guilds/${guildId}/message-studio/send`, {
        method: 'POST',
        body,
      });
      const payload = (await response.json()) as { error?: string; messageId?: string; threadId?: string };
      if (!response.ok) throw new Error(payload.error || 'Botでの発言に失敗しました');
      setNotice(payload.threadId ? 'ForumへBot投稿を作成しました' : 'Botでメッセージを送信しました');
      setContent('');
      setForumTitle('');
      setImage(null);
      setPublishAnnouncement(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Botでの発言に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border p-5">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">今すぐBotで発言</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">
          ユーザーがDiscordへ投稿する感覚で、チャンネル・Thread・Forumへ即時送信できます。Discord Markdownと画像添付に対応します。
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="投稿先">
              <DiscordChannelPicker
                options={discordOptions?.channels ?? []}
                value={channelId || null}
                placeholder="チャンネル / Forum / Threadを検索"
                onChange={(next) => {
                  const value = Array.isArray(next) ? (next[0] ?? '') : (next ?? '');
                  setChannelId(value);
                  setPublishAnnouncement(false);
                }}
              />
            </Field>
            <Field label="Forumタイトル">
              <input
                value={forumTitle}
                onChange={(event) => setForumTitle(event.target.value.slice(0, 100))}
                disabled={!isForum}
                className={INPUT_CLASS_NAME}
                placeholder={isForum ? '投稿タイトル' : 'Forum選択時に使用'}
              />
            </Field>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
            <div className="flex flex-wrap gap-1 border-b border-border p-2" aria-label="Discord書式ツール">
              <ToolbarButton label="太字" onClick={() => wrapMarkdown('**')} icon={<Bold />} />
              <ToolbarButton label="斜体" onClick={() => wrapMarkdown('*')} icon={<Italic />} />
              <ToolbarButton label="下線" onClick={() => wrapMarkdown('__')} icon={<Underline />} />
              <ToolbarButton label="取消" onClick={() => wrapMarkdown('~~')} icon={<Strikethrough />} />
              <ToolbarButton label="コード" onClick={() => wrapMarkdown('`')} icon={<Code2 />} />
              <ToolbarButton label="スポイラー" onClick={() => wrapMarkdown('||')} icon={<Eye />} />
              <ToolbarButton label="引用" onClick={() => wrapMarkdown('> ', '', '引用文')} icon={<Quote />} />
              <ToolbarButton label="リンク" onClick={() => wrapMarkdown('[', '](https://)', '表示名')} icon={<Link2 />} />
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => setContent(event.target.value.slice(0, maxContentLength))}
              rows={8}
              maxLength={maxContentLength}
              className="w-full resize-y bg-transparent px-3 py-3 text-sm outline-none"
              placeholder="Discordへ送るメッセージを入力…"
            />
          </div>
          <p className="text-right text-xs text-muted">{content.length} / {maxContentLength}</p>

          <div>
            <label
              htmlFor="message-studio-quick-image"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-4 text-sm text-muted transition hover:border-primary/40 hover:text-foreground focus-within:ring-2 focus-within:ring-ring"
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              {image ? image.name : '画像を添付（PNG / JPEG / GIF / WebP、8MiBまで）'}
              <input
                id="message-studio-quick-image"
                ref={fileInputRef}
                type="file"
                accept={MESSAGE_STUDIO_IMAGE_MIME_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => selectImage(event.target.files?.[0] ?? null)}
              />
            </label>
            {image ? (
              <button
                type="button"
                onClick={() => {
                  setImage(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> 添付を解除
              </button>
            ) : null}
          </div>

          {isAnnouncement && allowAnnouncementCrosspost ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={publishAnnouncement}
                onChange={(event) => setPublishAnnouncement(event.target.checked)}
              />
              Announcement Channelへ送信後にCrosspostする
            </label>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] leading-5 text-muted">
              {allowUserMentions
                ? 'User mentionのみ通知可能です。@everyone / @here / Role mentionは通知しません。'
                : 'Mention通知は安全のため無効化されています。'}
            </p>
            <button
              type="submit"
              disabled={busy || !channelId || (!content.trim() && !image)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {busy ? '送信中…' : '今すぐ送信'}
            </button>
          </div>

          {error ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
          {notice ? <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">{notice}</p> : null}
        </div>

        <aside className="rounded-2xl bg-[#313338] p-4 text-[#dbdee1]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#949ba4]">Discord Preview</p>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">H</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">Herta</span>
                <span className="rounded bg-[#5865f2] px-1 py-0.5 text-[9px] font-bold text-white">APP</span>
              </div>
              {content ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{content}</p> : null}
              {imagePreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagePreviewUrl} alt="添付画像プレビュー" className="mt-3 max-h-64 max-w-full rounded-lg object-contain" />
              ) : null}
            </div>
          </div>
          <div className="mt-4 border-t border-white/10 pt-3 text-xs text-[#949ba4]">
            <p>{selectedChannel ? `# ${selectedChannel.name}` : '投稿先未選択'}</p>
            {isForum ? <p className="mt-1">Forum: {forumTitle || '本文1行目をタイトルに使用'}</p> : null}
          </div>
        </aside>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function ToolbarButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:h-4 [&>svg]:w-4"
    >
      {icon}
    </button>
  );
}
