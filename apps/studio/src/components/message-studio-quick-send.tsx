'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Bold,
  Code2,
  Eye,
  FolderOpen,
  ImagePlus,
  Italic,
  Link2,
  ListPlus,
  MessageSquareText,
  Mic2,
  Quote,
  Save,
  Send,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react';
import type { GuildChannelOption, GuildConfigurationOptions } from '@/lib/bot-guild-options';
import type { MessageStudioDraftPayload } from '@/lib/message-studio-drafts';
import {
  MESSAGE_STUDIO_IMAGE_MAX_BYTES,
  MESSAGE_STUDIO_IMAGE_MIME_TYPES,
  MESSAGE_STUDIO_VOICE_MAX_BYTES,
  type MessageStudioImmediateEmbedField,
} from '@/lib/message-studio-discord';
import { resolveMessageStudioPreviewTarget } from '@/lib/message-studio-preview-target';
import { DiscordChannelPicker } from './discord-entity-picker';

const INPUT_CLASS_NAME =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring';

type MessageFormat = 'text' | 'embed' | 'voice';

interface DraftRecord {
  id: string;
  name: string;
  payload: MessageStudioDraftPayload;
  updatedAt: string;
}

interface VoiceMetadata {
  durationSeconds: number;
  waveform: string;
}

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
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const [channelId, setChannelId] = useState('');
  const [resolvedChannel, setResolvedChannel] = useState<GuildChannelOption | null>(null);
  const [forumTitle, setForumTitle] = useState('');
  const [content, setContent] = useState('');
  const [messageFormat, setMessageFormat] = useState<MessageFormat>('text');
  const [embedTitle, setEmbedTitle] = useState('');
  const [embedDescription, setEmbedDescription] = useState('');
  const [embedColor, setEmbedColor] = useState('#5865F2');
  const [embedImageUrl, setEmbedImageUrl] = useState('');
  const [embedThumbnailUrl, setEmbedThumbnailUrl] = useState('');
  const [embedFooterText, setEmbedFooterText] = useState('');
  const [embedFields, setEmbedFields] = useState<MessageStudioImmediateEmbedField[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [voice, setVoice] = useState<File | null>(null);
  const [voiceMetadata, setVoiceMetadata] = useState<VoiceMetadata | null>(null);
  const [voiceAnalyzing, setVoiceAnalyzing] = useState(false);
  const [publishAnnouncement, setPublishAnnouncement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  const imagePreviewUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  const voicePreviewUrl = useMemo(() => (voice ? URL.createObjectURL(voice) : null), [voice]);

  const loadDrafts = useCallback(async () => {
    try {
      const response = await fetch(`/api/guilds/${guildId}/message-studio/drafts`, {
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as {
        drafts?: DraftRecord[];
      } | null;
      if (response.ok && Array.isArray(payload?.drafts)) setDrafts(payload.drafts);
    } catch {
      // Draft一覧が取れなくても即時投稿は継続できる。
    }
  }, [guildId]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    };
  }, [voicePreviewUrl]);

  const selectedChannel = resolveMessageStudioPreviewTarget(
    discordOptions?.channels ?? [],
    channelId,
    resolvedChannel,
  );
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
  const hasVoice = messageFormat === 'voice' && Boolean(voice && voiceMetadata);

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

  async function selectVoice(file: File | null) {
    setError(null);
    setVoice(null);
    setVoiceMetadata(null);
    if (!file) return;
    if (!file.type.toLowerCase().startsWith('audio/')) {
      setError('ボイスメッセージには音声ファイルを選択してください');
      if (voiceInputRef.current) voiceInputRef.current.value = '';
      return;
    }
    if (file.size <= 0 || file.size > MESSAGE_STUDIO_VOICE_MAX_BYTES) {
      setError('ボイスメッセージは20MiB以下にしてください');
      if (voiceInputRef.current) voiceInputRef.current.value = '';
      return;
    }
    setVoiceAnalyzing(true);
    try {
      const metadata = await analyzeVoiceFile(file);
      setVoice(file);
      setVoiceMetadata(metadata);
    } catch {
      setError(
        'この音声ファイルを解析できませんでした。ブラウザで再生可能な音声を選択してください',
      );
      if (voiceInputRef.current) voiceInputRef.current.value = '';
    } finally {
      setVoiceAnalyzing(false);
    }
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

  function currentDraftPayload(): MessageStudioDraftPayload {
    return {
      channelId,
      forumTitle,
      content,
      messageFormat,
      embedTitle,
      embedDescription,
      embedColor: validColor(embedColor),
      embedImageUrl,
      embedThumbnailUrl,
      embedFooterText,
      embedFields,
      publishAnnouncement,
    };
  }

  function applyDraft(payload: MessageStudioDraftPayload) {
    setChannelId(payload.channelId);
    setForumTitle(payload.forumTitle);
    setContent(payload.content.slice(0, maxContentLength));
    setMessageFormat(payload.messageFormat);
    setEmbedTitle(payload.embedTitle);
    setEmbedDescription(payload.embedDescription);
    setEmbedColor(validColor(payload.embedColor));
    setEmbedImageUrl(payload.embedImageUrl);
    setEmbedThumbnailUrl(payload.embedThumbnailUrl);
    setEmbedFooterText(payload.embedFooterText);
    setEmbedFields(payload.embedFields);
    setPublishAnnouncement(payload.publishAnnouncement);
    setImage(null);
    setVoice(null);
    setVoiceMetadata(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (voiceInputRef.current) voiceInputRef.current.value = '';
  }

  async function saveDraft() {
    const name = draftName.trim();
    if (!name) {
      setError('下書き名を入力してください');
      return;
    }
    setDraftBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/message-studio/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedDraftId || undefined,
          name,
          payload: currentDraftPayload(),
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        draft?: DraftRecord;
      } | null;
      if (!response.ok || !result?.draft)
        throw new Error(result?.error || '下書きの保存に失敗しました');
      setSelectedDraftId(result.draft.id);
      setDraftName(result.draft.name);
      setNotice(
        messageFormat === 'voice' && voice
          ? '下書きを保存しました。音声ファイル本体は保存されないため、送信時に再選択してください。'
          : '下書きを保存しました。',
      );
      await loadDrafts();
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : '下書きの保存に失敗しました');
    } finally {
      setDraftBusy(false);
    }
  }

  function loadSelectedDraft() {
    const draft = drafts.find((candidate) => candidate.id === selectedDraftId);
    if (!draft) return;
    applyDraft(draft.payload);
    setDraftName(draft.name);
    setNotice(
      draft.payload.messageFormat === 'voice'
        ? '下書きを読み込みました。ボイスメッセージの音声ファイルを再選択してください。'
        : '下書きを読み込みました。',
    );
    setError(null);
  }

  async function deleteSelectedDraft() {
    if (!selectedDraftId) return;
    setDraftBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/guilds/${guildId}/message-studio/drafts?id=${encodeURIComponent(selectedDraftId)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || '下書きの削除に失敗しました');
      setSelectedDraftId('');
      setDraftName('');
      setNotice('下書きを削除しました。');
      await loadDrafts();
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : '下書きの削除に失敗しました');
    } finally {
      setDraftBusy(false);
    }
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
    if (messageFormat === 'voice' && isForum) {
      setError(
        'ボイスメッセージはForum新規投稿ではなく、通常チャンネルまたは既存Threadへ送信してください',
      );
      return;
    }
    if (messageFormat === 'voice' && !hasVoice) {
      setError('音声ファイルを選択してください');
      return;
    }
    if (messageFormat !== 'voice' && !content.trim() && !image && !hasEmbed) {
      setError('本文・Embed・画像のいずれかを入力してください');
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.set('channelId', channelId);
      body.set('forumTitle', messageFormat === 'voice' ? '' : forumTitle);
      body.set('content', messageFormat === 'voice' ? '' : content);
      body.set(
        'publishAnnouncement',
        String(messageFormat === 'voice' ? false : publishAnnouncement),
      );
      if (messageFormat !== 'voice' && hasEmbed) {
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
      if (messageFormat !== 'voice' && image) body.set('image', image);
      if (messageFormat === 'voice' && voice && voiceMetadata) {
        body.set('voice', voice);
        body.set('voiceDurationSeconds', String(voiceMetadata.durationSeconds));
        body.set('voiceWaveform', voiceMetadata.waveform);
      }
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
        messageFormat === 'voice'
          ? 'Botでボイスメッセージを送信しました'
          : payload.threadId
            ? 'ForumへBot投稿を作成しました'
            : 'Botでメッセージを送信しました',
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
    setVoice(null);
    setVoiceMetadata(null);
    setPublishAnnouncement(false);
    setSelectedDraftId('');
    setDraftName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (voiceInputRef.current) voiceInputRef.current.value = '';
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border p-5">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">今すぐBotで発言</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">
          通常・Embed・Voice
          Messageを送信できます。下書きはアカウント単位で保存され、別端末からも復元できます。
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-background/50 p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value.slice(0, 100))}
                className={INPUT_CLASS_NAME}
                placeholder="下書き名（例: 月曜メンテ告知）"
                aria-label="下書き名"
              />
              <select
                value={selectedDraftId}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelectedDraftId(id);
                  const draft = drafts.find((candidate) => candidate.id === id);
                  if (draft) setDraftName(draft.name);
                }}
                className={INPUT_CLASS_NAME}
                aria-label="保存済み下書き"
              >
                <option value="">新規下書き</option>
                {drafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-1">
                <IconTextButton
                  label="読込"
                  icon={<FolderOpen />}
                  disabled={!selectedDraftId || draftBusy}
                  onClick={loadSelectedDraft}
                />
                <IconTextButton
                  label="保存"
                  icon={<Save />}
                  disabled={!draftName.trim() || draftBusy}
                  onClick={() => void saveDraft()}
                />
                <button
                  type="button"
                  disabled={!selectedDraftId || draftBusy}
                  onClick={() => void deleteSelectedDraft()}
                  className="inline-flex items-center justify-center rounded-lg border border-destructive/30 p-2 text-destructive disabled:opacity-40"
                  aria-label="下書きを削除"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              セキュリティと容量保護のため、画像・音声ファイル本体は下書きに保存しません。
            </p>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="投稿先">
              <DiscordChannelPicker
                options={discordOptions?.channels ?? []}
                guildId={guildId}
                value={channelId || null}
                placeholder="チャンネル / Forum / Threadを検索"
                onResolvedTarget={setResolvedChannel}
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
                disabled={!isForum || messageFormat === 'voice'}
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
              <FormatButton
                active={messageFormat === 'voice'}
                onClick={() => {
                  setMessageFormat('voice');
                  setPublishAnnouncement(false);
                }}
                label="Voice"
              />
            </div>
          </div>

          {messageFormat === 'voice' ? (
            <section className="space-y-3 rounded-2xl border border-border bg-background/50 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Mic2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Discord Voice Message</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    音声ファイルから再生時間と波形を生成して送信します。本文・Embed・画像との併用はできません。
                  </p>
                </div>
              </div>
              <label
                htmlFor="message-studio-voice-file"
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted hover:border-primary/40 hover:text-foreground"
              >
                <Mic2 className="h-4 w-4" aria-hidden="true" />
                {voiceAnalyzing
                  ? '音声を解析中…'
                  : voice
                    ? `${voice.name} (${formatDuration(voiceMetadata?.durationSeconds ?? 0)})`
                    : '音声ファイルを選択（20MiBまで）'}
                <input
                  id="message-studio-voice-file"
                  ref={voiceInputRef}
                  type="file"
                  accept="audio/*"
                  className="sr-only"
                  disabled={voiceAnalyzing}
                  onChange={(event) => void selectVoice(event.target.files?.[0] ?? null)}
                />
              </label>
              {voicePreviewUrl ? <audio className="w-full" controls src={voicePreviewUrl} /> : null}
              {isForum ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                  Forumの新規投稿にはVoice
                  Messageを送れません。通常チャンネルまたは既存Threadを選択してください。
                </p>
              ) : null}
            </section>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
                <div
                  className="flex flex-wrap gap-1 border-b border-border p-2"
                  aria-label="Discord書式ツール"
                >
                  <ToolbarButton label="太字" onClick={() => wrapMarkdown('**')} icon={<Bold />} />
                  <ToolbarButton label="斜体" onClick={() => wrapMarkdown('*')} icon={<Italic />} />
                  <ToolbarButton
                    label="下線"
                    onClick={() => wrapMarkdown('__')}
                    icon={<Underline />}
                  />
                  <ToolbarButton
                    label="取消"
                    onClick={() => wrapMarkdown('~~')}
                    icon={<Strikethrough />}
                  />
                  <ToolbarButton
                    label="コード"
                    onClick={() => wrapMarkdown('`')}
                    icon={<Code2 />}
                  />
                  <ToolbarButton
                    label="スポイラー"
                    onClick={() => wrapMarkdown('||')}
                    icon={<Eye />}
                  />
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
                                setEmbedFields(
                                  embedFields.filter((_, fieldIndex) => fieldIndex !== index),
                                )
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
            </>
          )}

          {messageFormat !== 'voice' && isAnnouncement && allowAnnouncementCrosspost ? (
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
              {messageFormat === 'voice'
                ? 'Voice Message送信にはBotのSend Voice Messages / Attach Files権限が必要です。'
                : allowUserMentions
                  ? 'User mentionのみ通知可能です。@everyone / @here / Role mentionは通知しません。'
                  : 'Mention通知は安全のため無効化されています。'}
            </p>
            <button
              type="submit"
              disabled={
                busy ||
                voiceAnalyzing ||
                !channelId ||
                (messageFormat === 'voice'
                  ? !hasVoice || isForum
                  : !content.trim() && !image && !hasEmbed)
              }
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
              {messageFormat === 'voice' ? (
                <div className="mt-2 rounded-xl bg-[#2b2d31] p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Mic2 className="h-4 w-4 text-[#5865f2]" aria-hidden="true" />
                    <span>{voice ? voice.name : 'Voice Message'}</span>
                    {voiceMetadata ? (
                      <span className="text-[#949ba4]">
                        {formatDuration(voiceMetadata.durationSeconds)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 h-6 rounded bg-white/10" aria-hidden="true" />
                </div>
              ) : (
                <>
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
                        {embedTitle ? (
                          <p className="font-semibold text-white">{embedTitle}</p>
                        ) : null}
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
                                  <p className="whitespace-pre-wrap text-xs">
                                    {field.value || '—'}
                                  </p>
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
                </>
              )}
            </div>
          </div>
          <div className="mt-4 border-t border-white/10 pt-3 text-xs text-[#949ba4]">
            <p>{selectedChannel ? `# ${selectedChannel.name}` : '投稿先未選択'}</p>
            <p className="mt-1">
              形式:{' '}
              {messageFormat === 'embed'
                ? 'Embed'
                : messageFormat === 'voice'
                  ? 'Voice Message'
                  : '通常'}
            </p>
            {isForum && messageFormat !== 'voice' ? (
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

function IconTextButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs disabled:opacity-40"
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}

function validColor(value: string): string {
  return /^#[0-9A-Fa-f]{6}$/u.test(value) ? value : '#5865F2';
}

async function analyzeVoiceFile(file: File): Promise<VoiceMetadata> {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) throw new Error('AudioContext is unavailable');
  const context = new AudioContextConstructor();
  try {
    const bytes = await file.arrayBuffer();
    const audio = await context.decodeAudioData(bytes.slice(0));
    if (!Number.isFinite(audio.duration) || audio.duration <= 0)
      throw new Error('invalid duration');
    const samples = audio.getChannelData(0);
    const pointCount = Math.max(1, Math.min(256, Math.ceil(audio.duration * 10)));
    const waveform = new Uint8Array(pointCount);
    let peak = 0;
    const amplitudes = new Float32Array(pointCount);
    for (let point = 0; point < pointCount; point += 1) {
      const start = Math.floor((point * samples.length) / pointCount);
      const end = Math.max(start + 1, Math.floor(((point + 1) * samples.length) / pointCount));
      let amplitude = 0;
      for (let index = start; index < end && index < samples.length; index += 1) {
        amplitude = Math.max(amplitude, Math.abs(samples[index] ?? 0));
      }
      amplitudes[point] = amplitude;
      peak = Math.max(peak, amplitude);
    }
    const normalizer = peak > 0 ? 255 / peak : 0;
    for (let point = 0; point < pointCount; point += 1) {
      waveform[point] = Math.min(255, Math.round((amplitudes[point] ?? 0) * normalizer));
    }
    let binary = '';
    for (const value of waveform) binary += String.fromCharCode(value);
    return { durationSeconds: audio.duration, waveform: window.btoa(binary) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
