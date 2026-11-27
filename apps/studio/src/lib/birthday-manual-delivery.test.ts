import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import {
  authorizeBirthdayManualDelivery,
  BirthdayManualDeliveryError,
  BIRTHDAY_MANUAL_DELIVERY_PATH,
  BIRTHDAY_MANUAL_DELIVERY_PURPOSE,
  parseBirthdayManualDeliveryResult,
  requestBirthdayManualDelivery,
} from './birthday-manual-delivery.ts';

const FIXTURE_TOKEN = ['fixture-token', '0123456789abcdef0123456789abcdef'].join('-');
const FIXTURE_BOT_SECRET = ['fixture-secret', '0123456789abcdef0123456789abcdef'].join('-');

const environment = {
  IVRM_INTEGRATION_GUILD_ID: '100000000000000001',
  IVRM_INTEGRATION_TOKEN: FIXTURE_TOKEN,
};
const input = {
  guildId: environment.IVRM_INTEGRATION_GUILD_ID,
  discordUserId: '100000000000000002',
  localDate: '2026-11-22',
};

function signed(
  value: unknown = input,
  timestamp = new Date().toISOString(),
  secret = FIXTURE_TOKEN,
) {
  const body = JSON.stringify(value),
    event = randomUUID(),
    key = createHmac('sha256', secret).update(BIRTHDAY_MANUAL_DELIVERY_PURPOSE).digest();
  return new Request(`https://studio.test${BIRTHDAY_MANUAL_DELIVERY_PATH}`, {
    method: 'POST',
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': createHmac('sha256', key)
        .update(`${timestamp}.${event}.POST.${BIRTHDAY_MANUAL_DELIVERY_PATH}.${body}`)
        .digest('hex'),
    },
    body,
  });
}

test('authenticates exact service body and binds Guild', async () => {
  assert.deepEqual(await authorizeBirthdayManualDelivery(signed(), environment), input);
  for (const value of [
    { ...input, memberId: 'extra-key' },
    { ...input, guildId: '100000000000000099' },
    { ...input, discordUserId: 'not-an-id' },
    { ...input, localDate: '2026-02-30' },
    { ...input, localDate: '2026/11/22' },
  ]) {
    const response = await authorizeBirthdayManualDelivery(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});

test('rejects expired signature and wrong key, fails closed while unconfigured', async () => {
  const expired = await authorizeBirthdayManualDelivery(
    signed(input, new Date(Date.now() - 600_000).toISOString()),
    environment,
  );
  assert.ok(expired instanceof Response);
  assert.equal(expired.status, 401);

  const wrongKey = await authorizeBirthdayManualDelivery(
    signed(input, new Date().toISOString(), 'b'.repeat(40)),
    environment,
  );
  assert.ok(wrongKey instanceof Response);
  assert.equal(wrongKey.status, 401);

  const unconfigured = await authorizeBirthdayManualDelivery(signed(), {});
  assert.ok(unconfigured instanceof Response);
  assert.equal(unconfigured.status, 503);
});

test('a read-purpose signature cannot be replayed as a manual delivery', async () => {
  const body = JSON.stringify(input),
    timestamp = new Date().toISOString(),
    event = randomUUID(),
    key = createHmac('sha256', environment.IVRM_INTEGRATION_TOKEN)
      .update('herta-birthday-deliveries-read-v1')
      .digest();
  const request = new Request(`https://studio.test${BIRTHDAY_MANUAL_DELIVERY_PATH}`, {
    method: 'POST',
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': createHmac('sha256', key)
        .update(`${timestamp}.${event}.POST.${BIRTHDAY_MANUAL_DELIVERY_PATH}.${body}`)
        .digest('hex'),
    },
    body,
  });
  const response = await authorizeBirthdayManualDelivery(request, environment);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 401);
});

test('parseBirthdayManualDeliveryResult accepts the contract shapes', () => {
  assert.deepEqual(
    parseBirthdayManualDeliveryResult({
      status: 'ok',
      reason: null,
      deliveries: [
        { category: 'role_assign', outcome: 'delivered', reason: null },
        { category: 'card', outcome: 'failed', reason: 'channel_unavailable' },
      ],
    }),
    {
      status: 'ok',
      reason: null,
      deliveries: [
        { category: 'role_assign', outcome: 'delivered', reason: null },
        { category: 'card', outcome: 'failed', reason: 'channel_unavailable' },
      ],
    },
  );
  // A bare error-class summary is an allowed per-kind failure reason.
  assert.ok(
    parseBirthdayManualDeliveryResult({
      status: 'ok',
      reason: null,
      deliveries: [{ category: 'card', outcome: 'failed', reason: 'DiscordAPIError' }],
    }),
  );
  assert.deepEqual(
    parseBirthdayManualDeliveryResult({
      status: 'rejected',
      reason: 'date_out_of_range',
      deliveries: [],
    }),
    { status: 'rejected', reason: 'date_out_of_range', deliveries: [] },
  );
});

test('parseBirthdayManualDeliveryResult fails closed on anything unexpected', () => {
  for (const value of [
    null,
    'ok',
    { status: 'ok', reason: null, deliveries: [], extra: true },
    { status: 'ok', reason: 'date_out_of_range', deliveries: [] },
    { status: 'rejected', reason: 'unknown_reason', deliveries: [] },
    { status: 'rejected', reason: null, deliveries: [] },
    {
      status: 'rejected',
      reason: 'not_a_recipient',
      deliveries: [{ category: 'card', outcome: 'delivered', reason: null }],
    },
    {
      status: 'ok',
      reason: null,
      deliveries: [{ category: 'role-removed:1', outcome: 'delivered', reason: null }],
    },
    {
      status: 'ok',
      reason: null,
      deliveries: [{ category: 'card', outcome: 'delivered', reason: 'should_be_null' }],
    },
    {
      status: 'ok',
      reason: null,
      deliveries: [{ category: 'card', outcome: 'failed', reason: 'raw free text!' }],
    },
    {
      status: 'ok',
      reason: null,
      deliveries: [
        { category: 'card', outcome: 'delivered', reason: null },
        { category: 'card', outcome: 'delivered', reason: null },
      ],
    },
    { status: 'ok', reason: null, deliveries: [{ category: 'card', outcome: 'delivered' }] },
  ]) {
    assert.equal(parseBirthdayManualDeliveryResult(value), null, JSON.stringify(value));
  }
});

const BOT_ENV = {
  BOT_HEALTH_URL: 'http://bot.internal:3000/healthz',
  BOT_INTERNAL_API_SECRET: FIXTURE_BOT_SECRET,
};

function withBotEnv<T>(run: () => Promise<T>): Promise<T> {
  const keys = ['BOT_HEALTH_URL', 'BOT_INTERNAL_API_SECRET'] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) previous.set(key, process.env[key]);
  process.env['BOT_HEALTH_URL'] = BOT_ENV.BOT_HEALTH_URL;
  process.env['BOT_INTERNAL_API_SECRET'] = BOT_ENV.BOT_INTERNAL_API_SECRET;
  return run().finally(() => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('requestBirthdayManualDelivery posts to the bot internal API and returns the result', async () => {
  await withBotEnv(async () => {
    const expected = {
      status: 'ok',
      reason: null,
      deliveries: [{ category: 'card', outcome: 'delivered', reason: null }],
    };
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return Response.json({ result: expected });
    }) as typeof fetch;
    const result = await requestBirthdayManualDelivery(
      input.guildId,
      { discordUserId: input.discordUserId, localDate: input.localDate },
      fetchImpl,
    );
    assert.deepEqual(result, expected);
    assert.equal(
      seenUrl,
      `http://bot.internal:3000/internal/guilds/${input.guildId}/birthday/manual-delivery`,
    );
    assert.equal(seenInit?.method, 'POST');
    assert.equal(
      (seenInit?.headers as Record<string, string>)['Authorization'],
      `Bearer ${BOT_ENV.BOT_INTERNAL_API_SECRET}`,
    );
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      discordUserId: input.discordUserId,
      localDate: input.localDate,
    });
  });
});

test('requestBirthdayManualDelivery maps upstream failures to statuses', async () => {
  await withBotEnv(async () => {
    const fails = async (fetchImpl: typeof fetch) =>
      requestBirthdayManualDelivery(
        input.guildId,
        { discordUserId: input.discordUserId, localDate: input.localDate },
        fetchImpl,
      ).then(
        () => null,
        (error: unknown) => error,
      );

    const unavailable = (async () =>
      new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const botDown = await fails(unavailable);
    assert.ok(botDown instanceof BirthdayManualDeliveryError);
    assert.equal(botDown.status, 503);

    const networkError = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const network = await fails(networkError);
    assert.ok(network instanceof BirthdayManualDeliveryError);
    assert.equal(network.status, 502);

    const badPayload = (async () =>
      Response.json({
        result: { status: 'ok', reason: null, deliveries: 'nope' },
      })) as unknown as typeof fetch;
    const invalid = await fails(badPayload);
    assert.ok(invalid instanceof BirthdayManualDeliveryError);
    assert.equal(invalid.status, 502);
  });
});

test('requestBirthdayManualDelivery fails closed while the internal API is unconfigured', async () => {
  const previous = process.env['BOT_INTERNAL_API_SECRET'];
  delete process.env['BOT_INTERNAL_API_SECRET'];
  try {
    const error = await requestBirthdayManualDelivery(input.guildId, {
      discordUserId: input.discordUserId,
      localDate: input.localDate,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof BirthdayManualDeliveryError);
    assert.equal(error.status, 503);
  } finally {
    if (previous !== undefined) process.env['BOT_INTERNAL_API_SECRET'] = previous;
  }
});
