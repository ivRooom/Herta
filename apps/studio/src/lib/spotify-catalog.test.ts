import { describe, expect, it } from 'vitest';
import { formatSpotifyPresenceText, parseSpotifyTrackId } from './spotify-catalog';

describe('Spotify catalog helpers', () => {
  it('Spotify Track URLまたはIDだけを受理する', () => {
    const id = '4uLU6hMCjMI75M1A2tKUQC';
    expect(parseSpotifyTrackId(id)).toBe(id);
    expect(parseSpotifyTrackId(`https://open.spotify.com/track/${id}`)).toBe(id);
    expect(parseSpotifyTrackId(`https://open.spotify.com/track/${id}?si=abc`)).toBe(id);
    expect(parseSpotifyTrackId(`http://open.spotify.com/track/${id}`)).toBeNull();
    expect(parseSpotifyTrackId(`https://example.com/track/${id}`)).toBeNull();
    expect(parseSpotifyTrackId('YOASOBI アイドル')).toBeNull();
  });

  it('Presence文字列を128文字以内に正規化する', () => {
    expect(formatSpotifyPresenceText('アイドル', ['YOASOBI'])).toBe('アイドル — YOASOBI');
    const longValue = formatSpotifyPresenceText('a'.repeat(120), ['b'.repeat(40)]);
    expect(longValue).toHaveLength(128);
  });
});
