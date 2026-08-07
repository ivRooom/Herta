import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordApiError } from './discord.ts';
import { discordApiErrorResponse } from './discord-api-response.ts';

test('Discord 401を再ログイン要求として返す', async () => {
  const response = discordApiErrorResponse(new DiscordApiError(401));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Discord の再ログインが必要です' });
});

test('Discord 403をアクセス拒否として返す', async () => {
  const response = discordApiErrorResponse(new DiscordApiError(403));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Discord API へのアクセスが拒否されました' });
});

test('Discord 429をRetry-After付きで返す', async () => {
  const response = discordApiErrorResponse(new DiscordApiError(429, 1_250));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '2');
  assert.deepEqual(await response.json(), {
    error: 'Discord API のレート制限中です。少し待ってから再試行してください',
    retryAfterSeconds: 2,
  });
});

test('Retry-After不明のDiscord 429はヘッダーを付けずに返す', async () => {
  const response = discordApiErrorResponse(new DiscordApiError(429));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), null);
  assert.deepEqual(await response.json(), {
    error: 'Discord API のレート制限中です。少し待ってから再試行してください',
    retryAfterSeconds: null,
  });
});

test('Discord 5xxを503として返す', async () => {
  const response = discordApiErrorResponse(new DiscordApiError(502));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Discord API が一時的に利用できません。しばらく待ってから再試行してください',
  });
});
