import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSpotifyPresenceText, parseSpotifyTrackId } from './spotify-catalog';

describe('Spotify catalog helpers', () => {
  it('Spotify Track URLまたはIDだけを受理する', () => {
    const id = '4uLU6hMCjMI75M1A2tKUQC';
    assert.equal(parseSpotifyTrackId(id), id);
    assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${id}`), id);
    assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${id}?si=abc`), id);
    assert.equal(parseSpotifyTrackId(`http://open.spotify.com/track/${id}`), null);
    assert.equal(parseSpotifyTrackId(`https://example.com/track/${id}`), null);
    assert.equal(parseSpotifyTrackId('YOASOBI アイドル'), null);
  });

  it('Presence文字列を128文字以内に正規化する', () => {
    assert.equal(formatSpotifyPresenceText('アイドル', ['YOASOBI']), 'アイドル — YOASOBI');
    const longValue = formatSpotifyPresenceText('a'.repeat(120), ['b'.repeat(40)]);
    assert.equal(longValue.length, 128);
  });
});
