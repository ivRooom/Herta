'use client';

import { useState, type FormEvent } from 'react';
import { ExternalLink, LoaderCircle, Music2, Search } from 'lucide-react';

interface SpotifyTrackResult {
  id: string;
  name: string;
  artists: string[];
  url: string;
  imageUrl: string | null;
  presenceText: string;
}

export function SpotifyPresencePicker({
  onSelect,
}: {
  onSelect: (presenceText: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<SpotifyTrackResult[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || loading) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/bot/presence/spotify?q=${encodeURIComponent(normalized)}`, {
        cache: 'no-store',
      });
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
            曲名・歌手名、またはSpotify Track URLで検索します。再生連携ではなくPresence表示用です。
          </p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="mt-4 flex gap-2">
        <label htmlFor="spotify-presence-query" className="sr-only">
          Spotify楽曲検索
        </label>
        <input
          id="spotify-presence-query"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 160))}
          maxLength={160}
          placeholder="例: YOASOBI アイドル / Spotify Track URL"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
        <button
          type="submit"
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
      </form>

      {configured === false ? (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">
          Spotify連携は未設定です。手動のActivity入力はそのまま利用できます。
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      {configured !== false && !error && tracks.length === 0 && !loading && query.trim() ? (
        <p className="mt-3 text-xs text-muted">一致する楽曲がない場合は検索語を変えてください。</p>
      ) : null}

      {tracks.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-label="Spotify検索結果">
          {tracks.map((track) => (
            <li key={track.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
              {track.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.imageUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Music2 className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{track.name}</p>
                <p className="truncate text-xs text-muted">{track.artists.join(', ') || 'Unknown Artist'}</p>
              </div>
              <a
                href={track.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${track.name}をSpotifyで開く`}
                className="rounded-lg p-2 text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={() => onSelect(track.presenceText)}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                使用
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Spotify検索に失敗しました';
}
