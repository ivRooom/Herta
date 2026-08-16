'use client';

import { useState } from 'react';
import { ExternalLink, LoaderCircle, Search, Youtube } from 'lucide-react';
import type { BotPresenceMedia } from '@herta/shared';

interface YouTubeVideoResult {
  id: string;
  title: string;
  channelTitle: string;
  url: string;
  imageUrl: string | null;
  presenceText: string;
}

interface YouTubePresencePickerProps {
  selectedMedia: BotPresenceMedia | null;
  onSelect: (presenceText: string, media: BotPresenceMedia) => void;
}

export function YouTubePresencePicker({ selectedMedia, onSelect }: YouTubePresencePickerProps) {
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState<YouTubeVideoResult[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    const normalized = query.trim();
    if (!normalized || loading) return;

    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const response = await fetch(`/api/bot/presence/youtube?q=${encodeURIComponent(normalized)}`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        configured?: boolean;
        videos?: YouTubeVideoResult[];
        error?: string;
      };
      setConfigured(body.configured ?? true);
      if (!response.ok) throw new Error(body.error || 'YouTubeを検索できませんでした');
      setVideos(body.videos ?? []);
    } catch (searchError) {
      setVideos([]);
      setError(toMessage(searchError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-400/10 text-red-400">
          <Youtube className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">YouTubeからWatching表示を選択</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            動画タイトル・チャンネル名、YouTube URL、Video IDで検索できます。サムネイルはStudioのPresenceプレビューに保存されます。
          </p>
        </div>
      </div>

      {selectedMedia?.provider === 'youtube' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-red-400/20 bg-red-400/5 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-300">
            Selected on YouTube
          </p>
          <div className="flex items-center gap-3">
            {selectedMedia.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedMedia.artworkUrl}
                alt={`${selectedMedia.title}のサムネイル`}
                className="h-20 w-32 shrink-0 rounded-xl border border-white/10 object-cover shadow-lg"
              />
            ) : (
              <span className="flex h-20 w-32 shrink-0 items-center justify-center rounded-xl bg-red-400/10 text-red-300">
                <Youtube className="h-6 w-6" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold">{selectedMedia.title}</p>
              <p className="mt-1 truncate text-xs text-muted">
                {selectedMedia.creator || 'Unknown Channel'}
              </p>
              {selectedMedia.externalUrl ? (
                <a
                  href={selectedMedia.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  YouTubeで開く <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2" role="search">
        <label htmlFor="youtube-presence-query" className="sr-only">
          YouTube動画検索
        </label>
        <input
          id="youtube-presence-query"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 160))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void handleSearch();
          }}
          maxLength={160}
          placeholder="例: Minecraft 建築 / YouTube URL"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading || query.trim().length === 0}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {loading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          検索
        </button>
      </div>

      {configured === false ? (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">
          YouTube連携は未設定です。手動のWatching入力はそのまま利用できます。
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {configured !== false && !error && videos.length === 0 && !loading && searched ? (
        <p className="mt-3 text-xs text-muted">一致する動画がありません。検索語を変えてください。</p>
      ) : null}

      {videos.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="YouTube検索結果">
          {videos.map((video) => (
            <li
              key={video.id}
              className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-surface p-3"
            >
              {video.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={video.imageUrl}
                  alt={`${video.title}のサムネイル`}
                  className="h-16 w-28 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-red-400/10 text-red-300">
                  <Youtube className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold">{video.title}</p>
                <p className="mt-1 truncate text-xs text-muted">
                  {video.channelTitle || 'Unknown Channel'}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onSelect(video.presenceText, {
                        provider: 'youtube',
                        providerId: video.id,
                        title: video.title,
                        creator: video.channelTitle,
                        artworkUrl: video.imageUrl,
                        externalUrl: video.url,
                      })
                    }
                    className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Presenceに使用
                  </button>
                  <a
                    href={video.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${video.title}をYouTubeで開く`}
                    className="rounded-lg p-1.5 text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-[11px] leading-5 text-muted">
        キーワード検索にはYouTube Data APIの検索クォータを使用します。同じ検索は短時間キャッシュし、URL/Video ID指定は動画取得APIを使います。
      </p>
    </div>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'YouTube検索に失敗しました';
}
