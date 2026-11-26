import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import type { GuildChannelOption, GuildConfigurationOptions } from './bot-guild-options.ts';
import { handleIvrmGuildChannels } from './ivrm-guild-channels.ts';

const guildId = '111111111111111111';
const token = 'test-integration-token-with-at-least-32-characters';
const environment = { IVRM_INTEGRATION_GUILD_ID: guildId, IVRM_INTEGRATION_TOKEN: token };
const request = () =>
  new Request('https://studio.example.test/integration', {
    headers: { Authorization: `Bearer ${token}` },
  });
const channel = (overrides: Partial<GuildChannelOption> = {}): GuildChannelOption => ({
  id: '222222222222222222',
  name: 'announcements',
  kind: 'text',
  position: 1,
  parentId: '333333333333333333',
  viewable: true,
  readMessageHistory: true,
  ...overrides,
});
const options = () =>
  ({
    guildId,
    guildName: 'Fixture guild',
    channels: [
      channel(),
      channel({
        id: '444444444444444444',
        name: 'news',
        kind: 'announcement',
        position: 2,
        parentId: null,
      }),
      channel({ id: '555555555555555555', name: 'forum', kind: 'forum', position: 3 }),
      channel({ id: '666666666666666666', name: 'stage', kind: 'voice', position: 4 }),
      channel({
        id: '777777777777777777',
        name: 'hidden',
        kind: 'text',
        position: 5,
        viewable: false,
      }),
    ],
    emojis: [],
    roles: [],
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
    const response = await handleIvrmGuildChannels(input, scope, load, env);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (expected === 401) assert.match(response.headers.get('www-authenticate')!, /^Bearer/);
  }
  assert.equal(calls, 0);
});

test('actual producer response conforms to the portable contract without internal options', async () => {
  const bundle = JSON.parse(
    readFileSync(
      new URL('../../../../contracts/ivrm/herta-guild-channels.v1.bundle.json', import.meta.url),
      'utf8',
    ),
  );
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validate = ajv.compile(bundle.responseSchema);
  const response = await handleIvrmGuildChannels(
    request(),
    guildId,
    async () => options(),
    environment,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
  assert.deepEqual(Object.keys(body).sort(), ['channels', 'fetchedAt', 'guildId', 'status']);
  assert.deepEqual(
    body.channels.map((entry: { id: string }) => entry.id),
    ['222222222222222222', '444444444444444444'],
  );
  assert.deepEqual(Object.keys(body.channels[0]).sort(), [
    'id',
    'kind',
    'name',
    'parentId',
    'position',
  ]);
  assert.equal(body.channels[1].parentId, null);
  assert.ok(!JSON.stringify(body).includes(token));
  assert.equal(response.headers.get('cache-control'), bundle.cacheControl);
});

test('mismatched guild, duplicate IDs and malformed channel lists fail as a whole', async () => {
  const fixtures = [options(), options(), options(), options()];
  fixtures[0]!.guildId = '333333333333333333';
  const duplicate = options();
  duplicate.channels.push(channel());
  fixtures[1] = duplicate;
  const badParent = options();
  badParent.channels[0] = channel({ parentId: 'not-a-snowflake' });
  fixtures[2] = badParent;
  const badPosition = options();
  badPosition.channels[0] = channel({ position: -1 });
  fixtures[3] = badPosition;
  for (const fixture of fixtures) {
    const response = await handleIvrmGuildChannels(
      request(),
      guildId,
      async () => fixture,
      environment,
    );
    assert.equal(response.status, 503);
  }
  assert.equal(
    (await handleIvrmGuildChannels(request(), guildId, async () => null, environment)).status,
    503,
  );
  assert.equal(
    (
      await handleIvrmGuildChannels(
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
  empty.channels = [];
  const olderChannel = options();
  olderChannel.channels = [channel({ id: '1234567890123456' })];
  assert.equal(
    (await handleIvrmGuildChannels(request(), guildId, async () => olderChannel, environment))
      .status,
    200,
  );
  assert.equal(
    (await handleIvrmGuildChannels(request(), guildId, async () => empty, environment)).status,
    200,
  );
});
