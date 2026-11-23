import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import {
  authorizeBirthdayDeliveryHistoryRead,
  BIRTHDAY_DELIVERY_HISTORY_PATH,
  BIRTHDAY_DELIVERY_HISTORY_PURPOSE,
  categorizeBirthdayDeliveryKind,
  projectBirthdayDeliveryHistoryRow,
  summarizeBirthdayDeliveryError,
} from './birthday-delivery-history.ts';
const environment = {
  IVRM_INTEGRATION_GUILD_ID: '100000000000000001',
  IVRM_INTEGRATION_TOKEN: 'test-secret-value-that-is-long-enough-32',
};
const input = {
  guildId: environment.IVRM_INTEGRATION_GUILD_ID,
  from: '2026-10-01',
  to: '2026-11-30',
  limit: 50,
  offset: 0,
};
function signed(
  value: unknown = input,
  timestamp = new Date().toISOString(),
  secret = environment.IVRM_INTEGRATION_TOKEN,
) {
  const body = JSON.stringify(value),
    event = randomUUID(),
    key = createHmac('sha256', secret).update(BIRTHDAY_DELIVERY_HISTORY_PURPOSE).digest();
  return new Request(`https://studio.test${BIRTHDAY_DELIVERY_HISTORY_PATH}`, {
    method: 'POST',
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': createHmac('sha256', key)
        .update(`${timestamp}.${event}.POST.${BIRTHDAY_DELIVERY_HISTORY_PATH}.${body}`)
        .digest('hex'),
    },
    body,
  });
}
test('authenticates exact service body and binds Guild', async () => {
  assert.deepEqual(await authorizeBirthdayDeliveryHistoryRead(signed(), environment), input);
  for (const value of [
    { ...input, discordUserId: '100000000000000002' },
    { ...input, guildId: '100000000000000099' },
    { ...input, from: '2026-02-30' },
    { ...input, from: '2026-12-01' },
    { ...input, offset: -1 },
    { ...input, limit: 101 },
    { ...input, limit: 0 },
  ]) {
    const response = await authorizeBirthdayDeliveryHistoryRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('rejects expired signature and wrong key, fails closed while unconfigured', async () => {
  for (const request of [
    signed(input, '2020-01-01T00:00:00.000Z'),
    signed(input, new Date().toISOString(), 'wrong-secret-value-that-is-long-enough'),
  ]) {
    const response = await authorizeBirthdayDeliveryHistoryRead(request, environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  const response = await authorizeBirthdayDeliveryHistoryRead(signed(), {
    IVRM_INTEGRATION_GUILD_ID: environment.IVRM_INTEGRATION_GUILD_ID,
  });
  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
});
test('kind categories never forward the raw kind or its role id suffix', () => {
  assert.equal(categorizeBirthdayDeliveryKind('announcement'), 'card');
  assert.equal(categorizeBirthdayDeliveryKind('role-assigned:100000000000000055'), 'role_assign');
  assert.equal(categorizeBirthdayDeliveryKind('role-removed:100000000000000055'), 'role_remove');
  assert.equal(categorizeBirthdayDeliveryKind('something-else'), 'other');
  assert.equal(categorizeBirthdayDeliveryKind(null), 'other');
});
test('error summary only ever carries a bare error class name for failures', () => {
  assert.equal(summarizeBirthdayDeliveryError('failed', 'DiscordAPIError'), 'DiscordAPIError');
  assert.equal(summarizeBirthdayDeliveryError('failed', 'StaleDelivery'), 'StaleDelivery');
  assert.equal(summarizeBirthdayDeliveryError('failed', null), 'UnknownError');
  assert.equal(
    summarizeBirthdayDeliveryError('failed', 'Error: member 100000000000000002 left'),
    'UnknownError',
  );
  assert.equal(summarizeBirthdayDeliveryError('completed', 'DiscordAPIError'), null);
});
test('row projection emits exactly the history fields', () => {
  const item = projectBirthdayDeliveryHistoryRow({
    date: '2026-11-03',
    discordUserId: '100000000000000002',
    kind: 'role-assigned:100000000000000055',
    status: 'failed',
    errorName: 'MissingPermissions',
    completedAt: null,
    createdAt: new Date('2026-11-03T00:05:00.000Z'),
  });
  assert.deepEqual(item, {
    date: '2026-11-03',
    discordUserId: '100000000000000002',
    category: 'role_assign',
    status: 'failed',
    errorSummary: 'MissingPermissions',
    completedAt: null,
    createdAt: '2026-11-03T00:05:00.000Z',
  });
  assert.deepEqual(Object.keys(item).sort(), [
    'category',
    'completedAt',
    'createdAt',
    'date',
    'discordUserId',
    'errorSummary',
    'status',
  ]);
  assert.throws(() =>
    projectBirthdayDeliveryHistoryRow({
      date: '2026-11-03',
      discordUserId: '100000000000000002',
      kind: 'announcement',
      status: 'mystery',
      errorName: null,
      completedAt: null,
      createdAt: new Date('2026-11-03T00:05:00.000Z'),
    }),
  );
});
