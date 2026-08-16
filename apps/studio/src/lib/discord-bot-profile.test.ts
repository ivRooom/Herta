import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DiscordBotProfileError,
  getDiscordBotGuildProfile,
  updateDiscordBotGuildProfile,
} from './discord-bot-profile.ts';

const GUILD_ID = '123456789012345678';
const USER_ID = '987654321098765432';
const SECRET = '0123456789abcdef0123456789abcdef';

function withBotInternalEnv<T>(callback: () => Promise<T>): Promise<T> {
  const previousHealthUrl = process.env.BOT_HEALTH_URL;
  const previousSecret = process.env.BOT_INTERNAL_API_SECRET;
  process.env.BOT_HEALTH_URL = 'http://bot:3000/healthz';
  process.env.BOT_INTERNAL_API_SECRET = SECRET;

  return callback().finally(() => {
    if (previousHealthUrl === undefined) delete process.env.BOT_HEALTH_URL;
    else process.env.BOT_HEALTH_URL = previousHealthUrl;
    if (previousSecret === undefined) delete process.env.BOT_INTERNAL_API_SECRET;
    else process.env.BOT_INTERNAL_API_SECRET = previousSecret;
  });
}

test('Bot内部APIへBearer認証付きGETを送信する', async () => {
  await withBotInternalEnv(async () => {
    let capturedUrl = '';
    let capturedAuthorization = '';
    let capturedSignal: AbortSignal | null | undefined;
    const profile = await getDiscordBotGuildProfile(GUILD_ID, async (input, init) => {
      capturedUrl = String(input);
      capturedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      capturedSignal = init?.signal;
      return Response.json({
        profile: {
          userId: USER_ID,
          username: 'Herta',
          nickname: 'Herta Bot',
          avatarUrl: null,
          guildAvatar: false,
        },
      });
    });

    assert.equal(capturedUrl, `http://bot:3000/internal/guilds/${GUILD_ID}/bot-profile`);
    assert.equal(capturedAuthorization, `Bearer ${SECRET}`);
    assert.ok(capturedSignal instanceof AbortSignal);
    assert.equal(profile.nickname, 'Herta Bot');
  });
});

test('PATCHではNicknameとAvatar操作をJSONで送信しmutation完了を待つ', async () => {
  await withBotInternalEnv(async () => {
    let capturedMethod = '';
    let capturedBody = '';
    let capturedSignal: AbortSignal | null | undefined = null;
    const profile = await updateDiscordBotGuildProfile(
      GUILD_ID,
      { nickname: 'New Herta', avatar: null },
      async (_input, init) => {
        capturedMethod = init?.method ?? '';
        capturedBody = String(init?.body ?? '');
        capturedSignal = init?.signal;
        return Response.json({
          profile: {
            userId: USER_ID,
            username: 'Herta',
            nickname: 'New Herta',
            avatarUrl: null,
            guildAvatar: false,
          },
        });
      },
    );

    assert.equal(capturedMethod, 'PATCH');
    assert.deepEqual(JSON.parse(capturedBody), { nickname: 'New Herta', avatar: null });
    assert.equal(capturedSignal, undefined);
    assert.equal(profile.nickname, 'New Herta');
  });
});

test('内部Secret未設定時はBot Tokenへフォールバックせず503扱いにする', async () => {
  const previousHealthUrl = process.env.BOT_HEALTH_URL;
  const previousSecret = process.env.BOT_INTERNAL_API_SECRET;
  process.env.BOT_HEALTH_URL = 'http://bot:3000/healthz';
  delete process.env.BOT_INTERNAL_API_SECRET;

  try {
    await assert.rejects(
      () => getDiscordBotGuildProfile(GUILD_ID, async () => Response.json({})),
      (error: unknown) => error instanceof DiscordBotProfileError && error.status === 503,
    );
  } finally {
    if (previousHealthUrl === undefined) delete process.env.BOT_HEALTH_URL;
    else process.env.BOT_HEALTH_URL = previousHealthUrl;
    if (previousSecret === undefined) delete process.env.BOT_INTERNAL_API_SECRET;
    else process.env.BOT_INTERNAL_API_SECRET = previousSecret;
  }
});

test('Bot内部APIの不正レスポンスを502扱いで拒否する', async () => {
  await withBotInternalEnv(async () => {
    await assert.rejects(
      () => getDiscordBotGuildProfile(GUILD_ID, async () => Response.json({ profile: {} })),
      (error: unknown) => error instanceof DiscordBotProfileError && error.status === 502,
    );
  });
});
