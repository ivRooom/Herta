'use client';

import { useState } from 'react';
import { ExternalLink, LoaderCircle, Music2, Search } from 'lucide-react';
import type { BotPresenceMedia } from '@herta/shared';

interface SpotifyTrackResult {
  id: string;
  name: string;
  artists: string[];
  url: string;
  imageUrl: string | null;
  presenceText: string;
}

interface SpotifyPresencePickerProps {
  selectedMedia: BotPresenceMedia | null;
  onSelect: (presenceText: string, media: BotPresenceMedia) => void;
}

export function SpotifyPresencePicker({ selectedMedia, onSelect }: SpotifyPresencePickerProps) {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<SpotifyTrackResult[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    const normalized = query.trim();
    if (!normalized || loading) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/bot/presence/spotify?q=${encodeURIComponent(normalized)}`,
        {
          cache: 'no-store',
        },
      );
      const body = (await response.json()) as {
        configured?: boolean;
        tracks?: SpotifyTrackResult[];
        error?: string;
      };
      setConfigured(body.configured ?? true);
      if (!response.ok) throw new Error(body.error || 'Spotifyを検索できませんでした');
      setTracks(body.tracks ?? []);
    } catch (searchError) {
      setTracks([]);
      setError(toMessage(searchError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-400">
          <Music2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">SpotifyからListening表示を選択</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            曲名・歌手名、またはSpotify Track URLで検索します。カバーはStudioのPresenceプレビューにも保存されます。
          </p>
        </div>
      </div>

      {selectedMedia?.provider === 'spotify' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
            Selected on Spotify
          </p>
          <div className="flex items-center gap-3">
            {selectedMedia.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedMedia.artworkUrl}
                alt={`${selectedMedia.title}のカバー`}
                className="h-20 w-20 shrink-0 rounded-xl border border-white/10 object-cover shadow-lg"
              />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
                <Music2 className="h-6 w-6" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{selectedMedia.title}</p>
              <p className="mt-1 truncate text-xs text-muted">
                {selectedMedia.creator || 'Unknown Artist'}
              </p>
              {selectedMedia.externalUrl ? (
                <a
                  href={selectedMedia.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Spotifyで開く <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2" role="search">
        <label htmlFor="spotify-presence-query" className="sr-only">
          Spotify楽曲検索
        </label>
        <input
          id="spotify-presence-query"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 160))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void handleSearch();
          }}
          maxLength={160}
          placeholder="例: YOASOBI アイドル / Spotify Track URL"
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
          Spotify連携は未設定です。手動のActivity入力はそのまま利用できます。
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

      {configured !== false && !error && tracks.length === 0 && !loading && query.trim() ? (
        <p className="mt-3 text-xs text-muted">一致する楽曲がない場合は検索語を変えてください。</p>
      ) : null}

      {tracks.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Spotify検索結果">
          {tracks.map((track) => (
            <li
              key={track.id}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface p-3"
            >
              {track.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.imageUrl}
                  alt={`${track.name}のカバー`}
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Music2 className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{track.name}</p>
                <p className="truncate text-xs text-muted">
                  {track.artists.join(', ') || 'Unknown Artist'}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onSelect(track.presenceText, {
                        provider: 'spotify',
                        providerId: track.id,
                        title: track.name,
                        creator: track.artists.join(', '),
                        artworkUrl: track.imageUrl,
                        externalUrl: track.url,
                      })
                    }
                    className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Presenceに使用
                  </button>
                  <a
                    href={track.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${track.name}をSpotifyで開く`}
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
        Discord Bot Presenceには曲名・アーティストを反映し、カバー画像はStudio側のメディアプレビューとして保持します。
      </p>
    </div>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Spotify検索に失敗しました';
}
