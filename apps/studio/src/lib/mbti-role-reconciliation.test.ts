import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MbtiRoleReconciliationError,
  reconcileMbtiRoleForWebQuiz,
} from './mbti-role-reconciliation.ts';

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

test('Bot内部APIへBearer認証付きPATCHを送信し結果を返す', async () => {
  await withBotInternalEnv(async () => {
    let capturedUrl = '';
    let capturedAuthorization = '';
    let capturedBody = '';
    const result = await reconcileMbtiRoleForWebQuiz(
      GUILD_ID,
      USER_ID,
      'INTJ',
      async (input, init) => {
        capturedUrl = String(input);
        capturedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
        capturedBody = String(init?.body ?? '');
        return Response.json({
          result: {
            type: 'INTJ',
            addedRoleId: '111111111111111111',
            addedRoleName: 'INTJ',
            removedRoleIds: [],
            skippedRoleIds: [],
            failedRoleIds: [],
          },
        });
      },
    );

    assert.equal(
      capturedUrl,
      `http://bot:3000/internal/guilds/${GUILD_ID}/mbti/role-reconciliation`,
    );
    assert.equal(capturedAuthorization, `Bearer ${SECRET}`);
    assert.deepEqual(JSON.parse(capturedBody), { discordUserId: USER_ID, resultType: 'INTJ' });
    assert.equal(result.addedRoleId, '111111111111111111');
  });
});

test('404応答はMbtiRoleReconciliationError(404)を投げる', async () => {
  await withBotInternalEnv(async () => {
    await assert.rejects(
      reconcileMbtiRoleForWebQuiz(
        GUILD_ID,
        USER_ID,
        'INTJ',
        async () => new Response(null, { status: 404 }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof MbtiRoleReconciliationError);
        assert.equal(error.status, 404);
        return true;
      },
    );
  });
});

test('secret未設定時はMbtiRoleReconciliationError(503)を投げる', async () => {
  const previousSecret = process.env.BOT_INTERNAL_API_SECRET;
  const previousHealthUrl = process.env.BOT_HEALTH_URL;
  process.env.BOT_HEALTH_URL = 'http://bot:3000/healthz';
  delete process.env.BOT_INTERNAL_API_SECRET;
  try {
    await assert.rejects(
      reconcileMbtiRoleForWebQuiz(
        GUILD_ID,
        USER_ID,
        'INTJ',
        async () => new Response(null, { status: 200 }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof MbtiRoleReconciliationError);
        assert.equal(error.status, 503);
        return true;
      },
    );
  } finally {
    if (previousSecret === undefined) delete process.env.BOT_INTERNAL_API_SECRET;
    else process.env.BOT_INTERNAL_API_SECRET = previousSecret;
    if (previousHealthUrl === undefined) delete process.env.BOT_HEALTH_URL;
    else process.env.BOT_HEALTH_URL = previousHealthUrl;
  }
});
