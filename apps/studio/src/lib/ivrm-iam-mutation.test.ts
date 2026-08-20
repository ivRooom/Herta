import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIvrmIamMutationUuid,
  parseIvrmIamGroupCreateInput,
  readIvrmIamMutationContext,
} from './ivrm-iam-mutation.ts';

const ACTOR_ID = '123456789012345678';
const IDEMPOTENCY_KEY = 'iam-group-create-1234567890';

function request(headers: Record<string, string>) {
  return new Request(
    'https://herta.ivrm.jp/api/integrations/ivrm/guilds/test/iam/groups',
    {
      method: 'POST',
      headers,
    },
  );
}

test('readIvrmIamMutationContext requires a Discord actor and bounded idempotency key', () => {
  assert.equal(readIvrmIamMutationContext(request({})), null);
  assert.equal(
    readIvrmIamMutationContext(
      request({
        'x-ivrm-actor-id': 'invalid',
        'idempotency-key': IDEMPOTENCY_KEY,
      }),
    ),
    null,
  );
  assert.equal(
    readIvrmIamMutationContext(
      request({ 'x-ivrm-actor-id': ACTOR_ID, 'idempotency-key': 'short' }),
    ),
    null,
  );

  assert.deepEqual(
    readIvrmIamMutationContext(
      request({
        'x-ivrm-actor-id': ACTOR_ID,
        'idempotency-key': IDEMPOTENCY_KEY,
      }),
    ),
    { actorId: ACTOR_ID, idempotencyKey: IDEMPOTENCY_KEY },
  );
});

test('parseIvrmIamGroupCreateInput trims valid metadata and rejects invalid payloads', () => {
  assert.deepEqual(
    parseIvrmIamGroupCreateInput({
      name: ' Moderators ',
      description: ' Staff group ',
    }),
    { name: 'Moderators', description: 'Staff group' },
  );
  assert.deepEqual(parseIvrmIamGroupCreateInput({ name: 'Members' }), {
    name: 'Members',
    description: null,
  });
  assert.equal(parseIvrmIamGroupCreateInput({ name: '' }), null);
  assert.equal(parseIvrmIamGroupCreateInput({ name: 'x'.repeat(101) }), null);
  assert.equal(
    parseIvrmIamGroupCreateInput({
      name: 'Members',
      description: 'x'.repeat(501),
    }),
    null,
  );
});

test('createIvrmIamMutationUuid is deterministic and scoped by guild and operation', () => {
  const first = createIvrmIamMutationUuid(
    '111111111111111111',
    IDEMPOTENCY_KEY,
    'group-create',
  );
  const replay = createIvrmIamMutationUuid(
    '111111111111111111',
    IDEMPOTENCY_KEY,
    'group-create',
  );
  const otherGuild = createIvrmIamMutationUuid(
    '222222222222222222',
    IDEMPOTENCY_KEY,
    'group-create',
  );
  const otherOperation = createIvrmIamMutationUuid(
    '111111111111111111',
    IDEMPOTENCY_KEY,
    'group-update',
  );

  assert.equal(first, replay);
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.notEqual(first, otherGuild);
  assert.notEqual(first, otherOperation);
});
