'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Bold,
  Code2,
  Eye,
  ImagePlus,
  Italic,
  Link2,
  ListPlus,
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
  type MessageStudioImmediateEmbedField,
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
  const [messageFormat, setMessageFormat] = useState<'text' | 'embed'>('text');
  const [embedTitle, setEmbedTitle] = useState('');
  const [embedDescription, setEmbedDescription] = useState('');
  const [embedColor, setEmbedColor] = useState('#5865F2');
  const [embedImageUrl, setEmbedImageUrl] = useState('');
  const [embedThumbnailUrl, setEmbedThumbnailUrl] = useState('');
  const [embedFooterText, setEmbedFooterText] = useState('');
  const [embedFields, setEmbedFields] = useState<MessageStudioImmediateEmbedField[]>([]);
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

  const selectedChannel =
    discordOptions?.channels.find((channel) => channel.id === channelId) ?? null;
  const isForum = selectedChannel?.kind === 'forum';
  const isAnnouncement = selectedChannel?.kind === 'announcement';
  const hasEmbed =
    messageFormat === 'embed' &&
    Boolean(
      embedTitle.trim() ||
        embedDescription.trim() ||
        embedImageUrl.trim() ||
        embedThumbnailUrl.trim() ||
        embedFooterText.trim() ||
        embedFields.some((field) => field.name.trim() && field.value.trim()),
    );

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

  function addEmbedField() {
    if (embedFields.length >= 25) return;
    setEmbedFields([...embedFields, { name: '', value: '', inline: false }]);
  }

  function updateEmbedField(index: number, patch: Partial<MessageStudioImmediateEmbedField>) {
    setEmbedFields(
      embedFields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    );
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
    if (!content.trim() && !image && !hasEmbed) {
      setError('本文・Embed・画像のいずれかを入力してください');
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.set('channelId', channelId);
      body.set('forumTitle', forumTitle);
      body.set('content', content);
      body.set('publishAnnouncement', String(publishAnnouncement));
      if (hasEmbed) {
        body.set(
          'embed',
          JSON.stringify({
            title: embedTitle.trim(),
            description: embedDescription.trim(),
            color: validColor(embedColor),
            imageUrl: embedImageUrl.trim(),
            thumbnailUrl: embedThumbnailUrl.trim(),
            footerText: embedFooterText.trim(),
            fields: embedFields
              .filter((field) => field.name.trim() && field.value.trim())
              .map((field) => ({
                name: field.name.trim(),
                value: field.value.trim(),
                inline: field.inline,
              })),
          }),
        );
      }
      if (image) body.set('image', image);
      const response = await fetch(`/api/guilds/${guildId}/message-studio/send`, {
        method: 'POST',
        body,
      });
      const payload = (await response.json()) as {
        error?: string;
        messageId?: string;
        threadId?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Botでの発言に失敗しました');
      setNotice(
        payload.threadId ? 'ForumへBot投稿を作成しました' : 'Botでメッセージを送信しました',
      );
      resetComposer();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Botでの発言に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function resetComposer() {
    setContent('');
    setForumTitle('');
    setMessageFormat('text');
    setEmbedTitle('');
    setEmbedDescription('');
    setEmbedColor('#5865F2');
    setEmbedImageUrl('');
    setEmbedThumbnailUrl('');
    setEmbedFooterText('');
    setEmbedFields([]);
    setImage(null);
    setPublishAnnouncement(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border p-5">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">今すぐBotで発言</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">
          チャンネル・Thread・Forumへ、通常メッセージまたはEmbedを即時送信できます。Discord
          Markdown、画像添付、Announcement Crosspostにも対応します。
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

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              メッセージ形式
            </span>
            <div className="inline-flex rounded-xl border border-border p-1">
              <FormatButton
                active={messageFormat === 'text'}
                onClick={() => setMessageFormat('text')}
                label="通常"
              />
              <FormatButton
                active={messageFormat === 'embed'}
                onClick={() => setMessageFormat('embed')}
                label="Embed"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
            <div
              className="flex flex-wrap gap-1 border-b border-border p-2"
              aria-label="Discord書式ツール"
            >
              <ToolbarButton label="太字" onClick={() => wrapMarkdown('**')} icon={<Bold />} />
              <ToolbarButton label="斜体" onClick={() => wrapMarkdown('*')} icon={<Italic />} />
              <ToolbarButton label="下線" onClick={() => wrapMarkdown('__')} icon={<Underline />} />
              <ToolbarButton
                label="取消"
                onClick={() => wrapMarkdown('~~')}
                icon={<Strikethrough />}
              />
              <ToolbarButton label="コード" onClick={() => wrapMarkdown('`')} icon={<Code2 />} />
              <ToolbarButton label="スポイラー" onClick={() => wrapMarkdown('||')} icon={<Eye />} />
              <ToolbarButton
                label="引用"
                onClick={() => wrapMarkdown('> ', '', '引用文')}
                icon={<Quote />}
              />
              <ToolbarButton
                label="リンク"
                onClick={() => wrapMarkdown('[', '](https://)', '表示名')}
                icon={<Link2 />}
              />
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => setContent(event.target.value.slice(0, maxContentLength))}
              rows={7}
              maxLength={maxContentLength}
              className="w-full resize-y bg-transparent px-3 py-3 text-sm outline-none"
              placeholder="通常本文（Embedと併用できます）"
            />
          </div>
          <p className="text-right text-xs text-muted">
            {content.length} / {maxContentLength}
          </p>

          {messageFormat === 'embed' ? (
            <section className="space-y-4 rounded-2xl border border-border bg-background/50 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Embedタイトル">
                  <input
                    value={embedTitle}
                    onChange={(event) => setEmbedTitle(event.target.value.slice(0, 256))}
                    className={INPUT_CLASS_NAME}
                    placeholder="重要なお知らせ"
                  />
                </Field>
                <Field label="Accent Color">
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={validColor(embedColor)}
                      onChange={(event) => setEmbedColor(event.target.value)}
                      className="h-10 w-12 rounded-xl border border-border bg-background p-1"
                      aria-label="Embed色"
                    />
                    <input
                      value={embedColor}
                      onChange={(event) => setEmbedColor(event.target.value.slice(0, 7))}
                      className={INPUT_CLASS_NAME}
                      placeholder="#5865F2"
                    />
                  </div>
                </Field>
              </div>
              <Field label="Embed本文">
                <textarea
                  value={embedDescription}
                  onChange={(event) => setEmbedDescription(event.target.value.slice(0, 4096))}
                  rows={5}
                  className={`${INPUT_CLASS_NAME} resize-y`}
                  placeholder="Embed本文にもDiscord Markdownを利用できます。"
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="画像URL">
                  <input
                    type="url"
                    value={embedImageUrl}
                    onChange={(event) => setEmbedImageUrl(event.target.value)}
                    className={INPUT_CLASS_NAME}
                    placeholder="https://example.com/banner.png"
                  />
                </Field>
                <Field label="サムネイルURL">
                  <input
                    type="url"
                    value={embedThumbnailUrl}
                    onChange={(event) => setEmbedThumbnailUrl(event.target.value)}
                    className={INPUT_CLASS_NAME}
                    placeholder="https://example.com/icon.png"
                  />
                </Field>
              </div>
              <Field label="Footer">
                <input
                  value={embedFooterText}
                  onChange={(event) => setEmbedFooterText(event.target.value.slice(0, 2048))}
                  className={INPUT_CLASS_NAME}
                  placeholder="Herta Operations"
                />
              </Field>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted">
                    Fields ({embedFields.length}/25)
                  </span>
                  <button
                    type="button"
                    onClick={addEmbedField}
                    disabled={embedFields.length >= 25}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs disabled:opacity-40"
                  >
                    <ListPlus className="h-3.5 w-3.5" /> Field追加
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {embedFields.map((field, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-[1fr_2fr_auto]"
                    >
                      <input
                        value={field.name}
                        onChange={(event) =>
                          updateEmbedField(index, { name: event.target.value.slice(0, 256) })
                        }
                        className={INPUT_CLASS_NAME}
                        placeholder="項目名"
                      />
                      <input
                        value={field.value}
                        onChange={(event) =>
                          updateEmbedField(index, { value: event.target.value.slice(0, 1024) })
                        }
                        className={INPUT_CLASS_NAME}
                        placeholder="値"
                      />
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[11px] text-muted">
                          <input
                            type="checkbox"
                            checked={field.inline}
                            onChange={(event) =>
                              updateEmbedField(index, { inline: event.target.checked })
                            }
                          />
                          横並び
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setEmbedFields(embedFields.filter((_, fieldIndex) => fieldIndex !== index))
                          }
                          className="rounded-lg p-2 text-destructive hover:bg-destructive/5"
                          aria-label="Fieldを削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

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
              disabled={busy || !channelId || (!content.trim() && !image && !hasEmbed)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {busy ? '送信中…' : '今すぐ送信'}
            </button>
          </div>

          {error ? (
            <p
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300"
              role="status"
            >
              {notice}
            </p>
          ) : null}
        </div>

        <aside className="rounded-2xl bg-[#313338] p-4 text-[#dbdee1]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#949ba4]">
            Discord Preview
          </p>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              H
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">Herta</span>
                <span className="rounded bg-[#5865f2] px-1 py-0.5 text-[9px] font-bold text-white">
                  APP
                </span>
              </div>
              {content ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{content}</p>
              ) : null}
              {messageFormat === 'embed' && hasEmbed ? (
                <div
                  className="mt-2 max-w-full overflow-hidden rounded bg-[#2b2d31]"
                  style={{ borderLeft: `4px solid ${validColor(embedColor)}` }}
                >
                  <div className="p-3">
                    {embedThumbnailUrl ? (
                      <div
                        className="float-right ml-3 h-16 w-16 rounded bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${JSON.stringify(embedThumbnailUrl).slice(1, -1)})`,
                        }}
                      />
                    ) : null}
                    {embedTitle ? <p className="font-semibold text-white">{embedTitle}</p> : null}
                    {embedDescription ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm">{embedDescription}</p>
                    ) : null}
                    {embedFields.length > 0 ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {embedFields
                          .filter((field) => field.name || field.value)
                          .map((field, index) => (
                            <div key={index} className={field.inline ? '' : 'col-span-2'}>
                              <p className="text-xs font-semibold text-white">
                                {field.name || 'Field'}
                              </p>
                              <p className="whitespace-pre-wrap text-xs">{field.value || '—'}</p>
                            </div>
                          ))}
                      </div>
                    ) : null}
                    {embedImageUrl ? (
                      <div
                        className="mt-3 aspect-video w-full rounded bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${JSON.stringify(embedImageUrl).slice(1, -1)})`,
                        }}
                      />
                    ) : null}
                    {embedFooterText ? (
                      <p className="mt-3 text-[11px] text-[#949ba4]">{embedFooterText}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {imagePreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imagePreviewUrl}
                  alt="添付画像プレビュー"
                  className="mt-3 max-h-64 max-w-full rounded-lg object-contain"
                />
              ) : null}
            </div>
          </div>
          <div className="mt-4 border-t border-white/10 pt-3 text-xs text-[#949ba4]">
            <p>{selectedChannel ? `# ${selectedChannel.name}` : '投稿先未選択'}</p>
            <p className="mt-1">形式: {messageFormat === 'embed' ? 'Embed' : '通常'}</p>
            {isForum ? (
              <p className="mt-1">
                Forum: {forumTitle || embedTitle || '本文1行目をタイトルに使用'}
              </p>
            ) : null}
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

function FormatButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${active ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'}`}
    >
      {label}
    </button>
  );
}

function ToolbarButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
}) {
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

function validColor(value: string): string {
  return /^#[0-9A-Fa-f]{6}$/u.test(value) ? value : '#5865F2';
}
