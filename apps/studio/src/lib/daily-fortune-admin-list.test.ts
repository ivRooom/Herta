import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  authorizeFortuneAdminList,
  FORTUNE_ADMIN_LIST_PATH,
  FORTUNE_ADMIN_LIST_PURPOSE,
} from './daily-fortune-admin-list.ts';

const environment = {
  DAILY_BONUS_ENABLED: 'true',
  IVRM_INTEGRATION_GUILD_ID: '123456789012345678',
  IVRM_INTEGRATION_TOKEN: 'synthetic-service-secret-at-least-32-characters',
};
const now = Date.parse('2026-11-03T10:00:00.000Z');
const input = {
  guildId: environment.IVRM_INTEGRATION_GUILD_ID,
  from: '2026-11-01',
  to: '2026-11-03',
  limit: 20,
  offset: 0,
};
function signed(
  value: unknown = input,
  timestamp = new Date(now).toISOString(),
  purpose = FORTUNE_ADMIN_LIST_PURPOSE,
) {
  const body = JSON.stringify(value);
  const event = randomUUID();
  const key = createHmac('sha256', environment.IVRM_INTEGRATION_TOKEN).update(purpose).digest();
  const signature = createHmac('sha256', key)
    .update(timestamp + '.' + event + '.POST.' + FORTUNE_ADMIN_LIST_PATH + '.' + body)
    .digest('hex');
  return new Request('https://studio.test' + FORTUNE_ADMIN_LIST_PATH, {
    method: 'POST',
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': signature,
    },
    body,
  });
}
test('accepts only purpose-signed bounded admin snapshot queries', async () => {
  assert.deepEqual(await authorizeFortuneAdminList(signed(), environment, now), input);
  const ids = ['223456789012345678', '323456789012345678'];
  assert.deepEqual(
    await authorizeFortuneAdminList(signed({ ...input, discordUserIds: ids }), environment, now),
    { ...input, discordUserIds: ids },
  );
  for (const invalid of [
    { ...input, guildId: '333456789012345678' },
    { ...input, from: '2026-02-30' },
    { ...input, from: '2026-01-01' },
    { ...input, limit: 101 },
    { ...input, offset: 10001 },
    { ...input, discordUserIds: [] },
    { ...input, discordUserIds: ids.concat(ids[0]!) },
    { ...input, discordUserIds: ['not-a-discord-id'] },
    { ...input, unknownField: 'unsafe' },
  ]) {
    const result = await authorizeFortuneAdminList(signed(invalid), environment, now);
    assert.ok(result instanceof Response);
    assert.equal(result.status, 422);
  }
});
test('cannot reuse member HMAC or expired signature for admin enumeration', async () => {
  for (const request of [
    signed(input, new Date(now - 600000).toISOString()),
    signed(input, new Date(now).toISOString(), 'herta-daily-fortunes-read-v1'),
  ]) {
    const result = await authorizeFortuneAdminList(request, environment, now);
    assert.ok(result instanceof Response);
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  }
  const disabled = await authorizeFortuneAdminList(
    signed(),
    { ...environment, DAILY_BONUS_ENABLED: 'false' },
    now,
  );
  assert.ok(disabled instanceof Response);
  assert.equal(disabled.status, 503);
});
