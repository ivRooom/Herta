import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import type { GuildMemberOption } from './bot-guild-members.ts';
import { handleIvrmGuildMembers } from './ivrm-guild-members.ts';

const guildId = '111111111111111111';
const userId = '222222222222222222';
const token = 'test-integration-token-with-at-least-32-characters';
const environment = { IVRM_INTEGRATION_GUILD_ID: guildId, IVRM_INTEGRATION_TOKEN: token };
const request = (query = 'query=sample') =>
  new Request(`https://studio.example.test/members?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
const member = (): GuildMemberOption => ({
  id: userId,
  username: 'sample',
  displayName: 'サンプル',
  avatarUrl: 'https://cdn.discordapp.com/fixture.png',
  bot: false,
  roleIds: ['1234567890123456'],
});
const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/herta-guild-members.v1.bundle.json', import.meta.url),
    'utf8',
  ),
);

test('member integration checks auth, scope and bounds before invoking the Bot', async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    return [member()];
  };
  for (const [input, scope, id, env, status] of [
    [request(), guildId, undefined, {}, 503],
    [
      new Request('https://studio.example.test/members?query=sample'),
      guildId,
      undefined,
      environment,
      401,
    ],
    [request(), '333333333333333333', undefined, environment, 404],
    [request('query=a'), guildId, undefined, environment, 400],
    [request(`query=${'x'.repeat(65)}`), guildId, undefined, environment, 400],
    [request('query=sample&limit=21'), guildId, undefined, environment, 400],
    [request(), guildId, 'invalid', environment, 400],
  ] as const) {
    const response = await handleIvrmGuildMembers(input, scope, load, id, env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(calls, 0);
});

test('real handler responses conform to the shared member contract and exclude internal fields', async () => {
  const ajv = new Ajv({ validateFormats: false, strict: false });
  const calls: unknown[][] = [];
  const load = async (...args: [string, string, number]) => {
    calls.push(args);
    return [member()];
  };
  const search = await handleIvrmGuildMembers(
    request('query=%20sample%20&limit=1'),
    guildId,
    load,
    undefined,
    environment,
  );
  const searchBody = await search.json();
  const validateSearch = ajv.compile(bundle.operations.searchGuildMembers.responseSchema);
  assert.equal(validateSearch(searchBody), true, JSON.stringify(validateSearch.errors));
  assert.equal(searchBody.query, 'sample');
  assert.deepEqual(Object.keys(searchBody.members[0]).sort(), [
    'bot',
    'displayName',
    'id',
    'username',
  ]);
  const snapshot = await handleIvrmGuildMembers(request(), guildId, load, userId, environment);
  const body = await snapshot.json();
  const validateSnapshot = ajv.compile(bundle.operations.readGuildMemberSnapshot.responseSchema);
  assert.equal(validateSnapshot(body), true, JSON.stringify(validateSnapshot.errors));
  assert.deepEqual(body.member.roleIds, ['1234567890123456']);
  assert.equal(body.guildId, guildId);
  assert.equal(body.member.id, userId);
  assert.deepEqual(calls, [
    [guildId, 'sample', 1],
    [guildId, userId, 1],
  ]);
  assert.match(body.fetchedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test('empty selection, confirmed absence and unavailable upstream are distinct', async () => {
  assert.equal(
    (await handleIvrmGuildMembers(request(), guildId, async () => [], undefined, environment))
      .status,
    200,
  );
  assert.equal(
    (await handleIvrmGuildMembers(request(), guildId, async () => [], userId, environment)).status,
    404,
  );
  assert.equal(
    (await handleIvrmGuildMembers(request(), guildId, async () => null, userId, environment))
      .status,
    503,
  );
  assert.equal(
    (
      await handleIvrmGuildMembers(
        request(),
        guildId,
        async () => {
          throw new Error('private upstream');
        },
        userId,
        environment,
      )
    ).status,
    503,
  );
  const empty = await handleIvrmGuildMembers(
    request(),
    guildId,
    async () => [{ ...member(), roleIds: [] }],
    userId,
    environment,
  );
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).member.roleIds, []);
});

test('cross-member, duplicate or malformed snapshots never become partial successes', async () => {
  for (const item of [
    { ...member(), id: '333333333333333333' },
    { ...member(), roleIds: ['invalid'] },
    { ...member(), roleIds: ['123', '123'] },
    { ...member(), displayName: '' },
  ])
    assert.equal(
      (await handleIvrmGuildMembers(request(), guildId, async () => [item], userId, environment))
        .status,
      503,
    );
  assert.equal(
    (
      await handleIvrmGuildMembers(
        request(),
        guildId,
        async () => [member(), member()],
        undefined,
        environment,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await handleIvrmGuildMembers(
        request('query=sample&limit=1'),
        guildId,
        async () => [member(), { ...member(), id: '333333333333333333' }],
        undefined,
        environment,
      )
    ).status,
    503,
  );
});
