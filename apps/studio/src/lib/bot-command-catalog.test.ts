import assert from 'node:assert/strict';
import test from 'node:test';
import { BotCommandCatalogError, getBotGuildCommandCatalog } from './bot-command-catalog.ts';

const GUILD_ID = '123456789012345678';
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

test('Bot内部APIからBearer認証付きでCommand Catalogを取得する', async () => {
  await withBotInternalEnv(async () => {
    let capturedUrl = '';
    let authorization = '';
    const catalog = await getBotGuildCommandCatalog(GUILD_ID, async (input, init) => {
      capturedUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({
        guildId: GUILD_ID,
        commands: [
          {
            id: '987654321098765432',
            name: 'amidakuji',
            description: 'あみだくじ',
            source: 'plugin',
            options: [
              {
                name: 'members',
                description: '参加人数',
                type: 'integer',
                required: true,
                minValue: 2,
                maxValue: 20,
              },
            ],
          },
        ],
      });
    });

    assert.equal(capturedUrl, `http://bot:3000/internal/guilds/${GUILD_ID}/commands`);
    assert.equal(authorization, `Bearer ${SECRET}`);
    assert.equal(catalog.commands[0]?.source, 'plugin');
    assert.equal(catalog.commands[0]?.options[0]?.minValue, 2);
  });
});

test('内部Secret未設定時は503扱いにする', async () => {
  const previousHealthUrl = process.env.BOT_HEALTH_URL;
  const previousSecret = process.env.BOT_INTERNAL_API_SECRET;
  process.env.BOT_HEALTH_URL = 'http://bot:3000/healthz';
  delete process.env.BOT_INTERNAL_API_SECRET;

  try {
    await assert.rejects(
      () => getBotGuildCommandCatalog(GUILD_ID, async () => Response.json({})),
      (error: unknown) => error instanceof BotCommandCatalogError && error.status === 503,
    );
  } finally {
    if (previousHealthUrl === undefined) delete process.env.BOT_HEALTH_URL;
    else process.env.BOT_HEALTH_URL = previousHealthUrl;
    if (previousSecret === undefined) delete process.env.BOT_INTERNAL_API_SECRET;
    else process.env.BOT_INTERNAL_API_SECRET = previousSecret;
  }
});

test('不正レスポンスとrate limitを分類する', async () => {
  await withBotInternalEnv(async () => {
    await assert.rejects(
      () => getBotGuildCommandCatalog(GUILD_ID, async () => Response.json({ commands: [] })),
      (error: unknown) => error instanceof BotCommandCatalogError && error.status === 502,
    );

    await assert.rejects(
      () => getBotGuildCommandCatalog(GUILD_ID, async () => new Response(null, { status: 429 })),
      (error: unknown) => error instanceof BotCommandCatalogError && error.status === 429,
    );
  });
});
