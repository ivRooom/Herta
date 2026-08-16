import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BOT_PRESENCE_CONFIG,
  createBotPresenceUpdateEvent,
  normalizeBotPresenceConfig,
  parseBotPresenceConfig,
  parseBotPresenceUpdateEvent,
} from '@herta/shared';

test('有効なBot Presence設定を正規化できる', () => {
  assert.deepEqual(
    parseBotPresenceConfig({
      status: 'idle',
      activityType: 'watching',
      activityText: '  Herta Studio  ',
    }),
    {
      status: 'idle',
      activityType: 'watching',
      activityText: 'Herta Studio',
    },
  );
});

test('不正なstatus・activity type・空Activityを拒否する', () => {
  assert.equal(
    parseBotPresenceConfig({ status: 'offline', activityType: 'playing', activityText: 'Herta' }),
    null,
  );
  assert.equal(
    parseBotPresenceConfig({ status: 'online', activityType: 'streaming', activityText: 'Herta' }),
    null,
  );
  assert.equal(
    parseBotPresenceConfig({ status: 'online', activityType: 'playing', activityText: '   ' }),
    null,
  );
});

test('Presence mediaはProviderに対応するActivityだけ許可する', () => {
  const spotifyMedia = {
    provider: 'spotify',
    providerId: 'spotify-track-id',
    title: 'Herta Theme',
    creator: 'ivRooom',
    artworkUrl: 'https://i.scdn.co/image/example',
    externalUrl: 'https://open.spotify.com/track/example',
  };
  const youtubeMedia = {
    provider: 'youtube',
    providerId: 'dQw4w9WgXcQ',
    title: 'Herta Guide',
    creator: 'ivRooom',
    artworkUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  };

  assert.notEqual(
    parseBotPresenceConfig({
      status: 'online',
      activityType: 'listening',
      activityText: 'Herta Theme — ivRooom',
      media: spotifyMedia,
    }),
    null,
  );
  assert.notEqual(
    parseBotPresenceConfig({
      status: 'online',
      activityType: 'watching',
      activityText: 'Herta Guide — ivRooom',
      media: youtubeMedia,
    }),
    null,
  );
  assert.equal(
    parseBotPresenceConfig({
      status: 'online',
      activityType: 'watching',
      activityText: 'Herta Theme — ivRooom',
      media: spotifyMedia,
    }),
    null,
  );
  assert.equal(
    parseBotPresenceConfig({
      status: 'online',
      activityType: 'listening',
      activityText: 'Herta Guide — ivRooom',
      media: youtubeMedia,
    }),
    null,
  );
});

test('保存済み不正値は安全なデフォルトへフォールバックする', () => {
  assert.deepEqual(normalizeBotPresenceConfig(null), DEFAULT_BOT_PRESENCE_CONFIG);
});

test('Presence更新イベントを生成・再検証できる', () => {
  const event = createBotPresenceUpdateEvent({
    status: 'dnd',
    activityType: 'competing',
    activityText: 'Season Challenge',
  });
  const parsed = parseBotPresenceUpdateEvent(JSON.stringify(event));

  assert.deepEqual(parsed?.config, event.config);
  assert.equal(parseBotPresenceUpdateEvent('{'), null);
  assert.equal(parseBotPresenceUpdateEvent('x'.repeat(4097)), null);
});
