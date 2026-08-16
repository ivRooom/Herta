import assert from 'node:assert/strict';
import test from 'node:test';
import { formatYouTubePresenceText, parseYouTubeVideoId } from './youtube-catalog.ts';

test('YouTube Video URLまたはIDだけを受理する', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(parseYouTubeVideoId(id), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${id}?si=example`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/live/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/embed/${id}`), id);

  assert.equal(parseYouTubeVideoId('http://youtu.be/dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/channel/UC123'), null);
  assert.equal(parseYouTubeVideoId('not-a-video-id'), null);
});

test('YouTube Presence文字列を128文字以内に正規化する', () => {
  assert.equal(formatYouTubePresenceText('Herta Guide', 'ivRooom'), 'Herta Guide — ivRooom');
  assert.equal(formatYouTubePresenceText('Herta Guide', ''), 'Herta Guide');
  assert.equal(formatYouTubePresenceText('x'.repeat(200), 'channel').length, 128);
});
