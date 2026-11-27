import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeMemberActivityRead,
  MEMBER_ACTIVITY_READ_PATH,
  projectMemberActivityEvent,
} from './member-activity-read.ts';

const environment = {
  IVRM_INTEGRATION_GUILD_ID: '100000000000000001',
  IVRM_INTEGRATION_TOKEN: 'synthetic-service-secret-at-least-32-characters',
};
const guildId = environment.IVRM_INTEGRATION_GUILD_ID;

function request(
  body: unknown,
  options: { token?: string | null; rawBody?: string } = {},
): Request {
  const token = options.token === undefined ? environment.IVRM_INTEGRATION_TOKEN : options.token;
  return new Request(`https://studio.test${MEMBER_ACTIVITY_READ_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: options.rawBody ?? JSON.stringify(body),
  });
}

test('rejects missing and wrong bearer tokens with 401', async () => {
  for (const req of [
    request({ guildId }, { token: null }),
    request({ guildId }, { token: 'wrong-token-wrong-token-wrong-token-00' }),
  ]) {
    const response = await authorizeMemberActivityRead(req, environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
  }
});

test('fails closed with 503 while the integration is unconfigured', async () => {
  for (const env of [
    { IVRM_INTEGRATION_GUILD_ID: guildId },
    { IVRM_INTEGRATION_GUILD_ID: guildId, IVRM_INTEGRATION_TOKEN: 'too-short' },
    { IVRM_INTEGRATION_TOKEN: environment.IVRM_INTEGRATION_TOKEN },
  ]) {
    const response = await authorizeMemberActivityRead(request({ guildId }), env);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 503);
  }
});

test('binds the guild server-side: body guildId is only a consistency check', async () => {
  const input = await authorizeMemberActivityRead(request({ guildId }), environment);
  assert.ok(!(input instanceof Response));
  assert.equal(input.guildId, guildId);
  assert.deepEqual(
    {
      from: input.from,
      toExclusive: input.toExclusive,
      userId: input.userId,
      channelId: input.channelId,
      event: input.event,
      page: input.page,
      pageSize: input.pageSize,
    },
    {
      from: null,
      toExclusive: null,
      userId: null,
      channelId: null,
      event: null,
      page: 1,
      pageSize: 25,
    },
  );

  const mismatch = await authorizeMemberActivityRead(
    request({ guildId: '100000000000000099' }),
    environment,
  );
  assert.ok(mismatch instanceof Response);
  assert.equal(mismatch.status, 400);
  assert.deepEqual(await mismatch.json(), { error: 'guild_mismatch' });
});

test('parses filters including the H1 overwrite event types', async () => {
  const input = await authorizeMemberActivityRead(
    request({
      guildId,
      from: '2026-11-20T00:00:00.000Z',
      to: '2026-11-27T00:00:00.000Z',
      userId: '100000000000000002',
      channelId: '100000000000000003',
      event: 'channel_overwrite_update',
      page: 2,
      pageSize: 200,
    }),
    environment,
  );
  assert.ok(!(input instanceof Response));
  assert.equal(input.from?.toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(input.toExclusive?.toISOString(), '2026-11-27T00:00:00.000Z');
  assert.equal(input.userId, '100000000000000002');
  assert.equal(input.channelId, '100000000000000003');
  assert.equal(input.event, 'channel_overwrite_update');
  assert.equal(input.page, 2);
  // pageSize above the feed cap (50) is accepted here and clamped inside
  // searchMemberActivityEvents; the response reports the effective size.
  assert.equal(input.pageSize, 200);
});

test('rejects malformed bodies with 422', async () => {
  const cases: Request[] = [
    request({ guildId, events: ['channel_overwrite_create'] }),
    request({ guildId, event: 'Channel Overwrite' }),
    request({ guildId, event: 'channel-overwrite-update' }),
    request({ guildId, userId: 'not-a-snowflake' }),
    request({ guildId, from: '2026-11-27T00:00:00.000Z', to: '2026-11-20T00:00:00.000Z' }),
    request({ guildId, from: '2026-11-20' }),
    request({ guildId, page: 0 }),
    request({ guildId, pageSize: 0 }),
    request({ guildId: '100000000000000001', extra: true }),
    request(null, { rawBody: '{not json' }),
    request(null, { rawBody: '[]' }),
  ];
  for (const req of cases) {
    const response = await authorizeMemberActivityRead(req, environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});

test('rejects calendar-invalid timestamps instead of rolling them over', async () => {
  const invalid = [
    '2026-02-30T00:00:00.000Z', // February never has a 30th
    '2025-02-29T00:00:00.000Z', // 2025 is not a leap year
    '2026-04-31T00:00:00.000Z', // April has only 30 days
    '2026-13-01T00:00:00.000Z', // there is no month 13
    '2026-02-30T12:00:00+09:00', // invalid in any offset, not just UTC
  ];
  for (const from of invalid) {
    const response = await authorizeMemberActivityRead(request({ guildId, from }), environment);
    assert.ok(response instanceof Response, from);
    assert.equal(response.status, 422, from);
  }
  // The same rejection applies to the `to` bound.
  const toInvalid = await authorizeMemberActivityRead(
    request({ guildId, to: '2026-02-30T00:00:00.000Z' }),
    environment,
  );
  assert.ok(toInvalid instanceof Response);
  assert.equal(toInvalid.status, 422);
});

test('accepts the leap-day boundary and offset timestamps', async () => {
  const leap = await authorizeMemberActivityRead(
    request({ guildId, from: '2024-02-29T00:00:00.000Z', to: '2024-03-01T00:00:00.000Z' }),
    environment,
  );
  assert.ok(!(leap instanceof Response));
  assert.equal(leap.from?.toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(leap.toExclusive?.toISOString(), '2024-03-01T00:00:00.000Z');

  // Offset input keeps its meaning: 09:00 at +09:00 is 00:00 UTC.
  const offset = await authorizeMemberActivityRead(
    request({ guildId, from: '2026-11-20T09:00:00+09:00' }),
    environment,
  );
  assert.ok(!(offset instanceof Response));
  assert.equal(offset.from?.toISOString(), '2026-11-20T00:00:00.000Z');
});

test('projection never forwards the message body or unknown fields', () => {
  const stored = {
    id: 'cuid-example-1',
    userId: '100000000000000002',
    event: 'channel_overwrite_update',
    channelId: '100000000000000003',
    messageId: null,
    content: 'メッセージ本文は投影しない',
    contentScrubbedAt: null,
    metadata: {
      auditLogEntryId: '100000000000000004',
      targetType: 'role',
      changes: [{ permission: 'ViewChannel', before: 'neutral', after: 'allow' }],
    },
    occurredAt: '2026-11-26T09:55:00.000Z',
  };
  const projected = projectMemberActivityEvent(stored);
  assert.equal('content' in projected, false);
  assert.equal('contentScrubbedAt' in projected, false);
  assert.deepEqual(Object.keys(projected).sort(), [
    'channelId',
    'event',
    'id',
    'messageId',
    'metadata',
    'occurredAt',
    'userId',
  ]);
  assert.deepEqual(projected.metadata, stored.metadata);
  assert.equal(projected.occurredAt, '2026-11-26T09:55:00.000Z');
  assert.throws(() => projectMemberActivityEvent({ ...stored, metadata: ['x'] }));
  assert.throws(() => projectMemberActivityEvent({ ...stored, event: 'Bad Event' }));
  assert.throws(() => projectMemberActivityEvent({ ...stored, userId: 'not-a-snowflake' }));
});
