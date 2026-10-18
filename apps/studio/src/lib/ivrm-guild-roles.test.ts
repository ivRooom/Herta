import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import type { GuildConfigurationOptions } from './bot-guild-options.ts';
import { handleIvrmGuildRoles } from './ivrm-guild-roles.ts';

const guildId = '111111111111111111';
const token = 'test-integration-token-with-at-least-32-characters';
const environment = { IVRM_INTEGRATION_GUILD_ID: guildId, IVRM_INTEGRATION_TOKEN: token };
const request = () =>
  new Request('https://studio.example.test/integration', {
    headers: { Authorization: `Bearer ${token}` },
  });
const options = () =>
  ({
    guildId,
    guildName: 'Fixture guild',
    channels: [],
    emojis: [],
    roles: [
      {
        id: '222222222222222222',
        name: 'Member',
        color: '#5ee6b0',
        position: 2,
        managed: false,
        mentionable: true,
        editable: true,
      },
    ],
    fetchedAt: '2026-10-18T00:00:00.000Z',
    bot: { manageRoles: true },
  }) as unknown as GuildConfigurationOptions;

test('integration authorization and guild scope are checked before the Bot is queried', async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    return options();
  };
  for (const [input, scope, env, expected] of [
    [request(), guildId, {}, 503],
    [new Request('https://studio.example.test'), guildId, environment, 401],
    [request(), '333333333333333333', environment, 404],
  ] as const) {
    const response = await handleIvrmGuildRoles(input, scope, load, env);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (expected === 401) assert.match(response.headers.get('www-authenticate')!, /^Bearer/);
  }
  assert.equal(calls, 0);
});

test('actual producer response conforms to the portable contract without internal options', async () => {
  const bundle = JSON.parse(
    readFileSync(
      new URL('../../../../contracts/ivrm/herta-guild-roles.v1.bundle.json', import.meta.url),
      'utf8',
    ),
  );
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validate = ajv.compile(bundle.responseSchema);
  const response = await handleIvrmGuildRoles(
    request(),
    guildId,
    async () => options(),
    environment,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
  assert.equal(body.roles[0].color, 0x5ee6b0);
  assert.deepEqual(Object.keys(body).sort(), ['fetchedAt', 'guildId', 'roles', 'status']);
  assert.deepEqual(Object.keys(body.roles[0]).sort(), [
    'color',
    'id',
    'managed',
    'name',
    'position',
  ]);
  assert.ok(!JSON.stringify(body).includes(token));
  assert.equal(response.headers.get('cache-control'), bundle.cacheControl);
});

test('mismatched guild, duplicate IDs and malformed role lists fail as a whole', async () => {
  const fixtures = [options(), options(), options(), options()];
  fixtures[0]!.guildId = '333333333333333333';
  fixtures[1]!.roles.push({ ...fixtures[1]!.roles[0]! });
  fixtures[2]!.roles[0]!.color = 'invalid';
  fixtures[3]!.roles[0]!.position = -1;
  for (const fixture of fixtures) {
    const response = await handleIvrmGuildRoles(
      request(),
      guildId,
      async () => fixture,
      environment,
    );
    assert.equal(response.status, 503);
  }
  assert.equal(
    (await handleIvrmGuildRoles(request(), guildId, async () => null, environment)).status,
    503,
  );
  assert.equal(
    (
      await handleIvrmGuildRoles(
        request(),
        guildId,
        async () => {
          throw new Error('private upstream details');
        },
        environment,
      )
    ).status,
    503,
  );
  const empty = options();
  empty.roles = [];
  const olderRole = options();
  olderRole.roles[0]!.id = '1234567890123456';
  assert.equal(
    (await handleIvrmGuildRoles(request(), guildId, async () => olderRole, environment)).status,
    200,
  );
  assert.equal(
    (await handleIvrmGuildRoles(request(), guildId, async () => empty, environment)).status,
    200,
  );
});
