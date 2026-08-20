import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseIvrmIamGroupCreateInput, readIvrmIamMutationContext } from './ivrm-iam-mutation.ts';

type HertaIamBundle = {
  bundleVersion: number;
  contract: { id: string; version: string; sourceRepository: string };
  createAccessGroup: {
    method: string;
    headers: {
      actorId: { name: string; pattern: string };
      idempotencyKey: { name: string; pattern: string; minLength: number; maxLength: number };
    };
    request: {
      maxBytes: number;
      fields: {
        name: { normalizedMinLength: number; normalizedMaxLength: number; normalization: string };
        description: { normalizedMaxLength: number; normalization: string };
      };
    };
    response: {
      successStatusCodes: number[];
      errorStatusCodes: number[];
      replayHeader: { name: string; value: string };
    };
  };
};

const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/herta-iam.v1.bundle.json', import.meta.url),
    'utf8',
  ),
) as HertaIamBundle;
const contract = bundle.createAccessGroup;

function mutationRequest(actorId: string, idempotencyKey: string) {
  return new Request('https://herta.ivrm.jp/contract-test', {
    method: contract.method,
    headers: {
      [contract.headers.actorId.name]: actorId,
      [contract.headers.idempotencyKey.name]: idempotencyKey,
    },
  });
}

test('Herta IAM producer pins the canonical portable contract', () => {
  assert.equal(bundle.bundleVersion, 1);
  assert.equal(bundle.contract.id, 'herta-iam');
  assert.equal(bundle.contract.version, '1.0.0');
  assert.equal(bundle.contract.sourceRepository, 'ivRooom/ivrm-contracts');
  assert.equal(contract.method, 'POST');
});

test('Herta IAM mutation context conforms to actor and idempotency header contract', () => {
  const actorId = '1'.repeat(18);
  const minKey = 'a'.repeat(contract.headers.idempotencyKey.minLength);
  const maxKey = 'b'.repeat(contract.headers.idempotencyKey.maxLength);

  assert.match(actorId, new RegExp(contract.headers.actorId.pattern, 'u'));
  assert.deepEqual(readIvrmIamMutationContext(mutationRequest(actorId, minKey)), {
    actorId,
    idempotencyKey: minKey,
  });
  assert.deepEqual(readIvrmIamMutationContext(mutationRequest(actorId, maxKey)), {
    actorId,
    idempotencyKey: maxKey,
  });
  assert.equal(
    readIvrmIamMutationContext(
      mutationRequest(actorId, 'a'.repeat(contract.headers.idempotencyKey.minLength - 1)),
    ),
    null,
  );
  assert.equal(
    readIvrmIamMutationContext(
      mutationRequest(actorId, 'a'.repeat(contract.headers.idempotencyKey.maxLength + 1)),
    ),
    null,
  );
  assert.equal(readIvrmIamMutationContext(mutationRequest('invalid', minKey)), null);
});

test('Herta IAM group input normalization conforms to portable request constraints', () => {
  const name = contract.request.fields.name;
  const description = contract.request.fields.description;

  assert.equal(name.normalization, 'trim');
  assert.equal(description.normalization, 'trim-and-empty-to-null');
  assert.deepEqual(parseIvrmIamGroupCreateInput({ name: ' A ' }), {
    name: 'A',
    description: null,
  });
  assert.deepEqual(
    parseIvrmIamGroupCreateInput({
      name: 'x'.repeat(name.normalizedMaxLength),
      description: 'y'.repeat(description.normalizedMaxLength),
    }),
    {
      name: 'x'.repeat(name.normalizedMaxLength),
      description: 'y'.repeat(description.normalizedMaxLength),
    },
  );
  assert.equal(parseIvrmIamGroupCreateInput({ name: ' '.repeat(name.normalizedMinLength) }), null);
  assert.equal(
    parseIvrmIamGroupCreateInput({ name: 'x'.repeat(name.normalizedMaxLength + 1) }),
    null,
  );
  assert.equal(
    parseIvrmIamGroupCreateInput({
      name: 'Members',
      description: 'x'.repeat(description.normalizedMaxLength + 1),
    }),
    null,
  );
});

test(
  'Herta IAM route keeps bounded body, success status and replay semantics aligned with contract',
  () => {
    const routeSource = readFileSync(
      new URL('../app/api/integrations/ivrm/guilds/[guildId]/iam/groups/route.ts', import.meta.url),
      'utf8',
    );

    assert.equal(contract.request.maxBytes, 16 * 1024);
    assert.match(routeSource, /const MAX_GROUP_BODY_BYTES = 16 \* 1024;/u);
    assert.deepEqual(contract.response.successStatusCodes, [200, 201]);
    assert.match(routeSource, /return groupResponse\(replay\.group, true, 200\);/u);
    assert.match(routeSource, /return groupResponse\(group, false, 201\);/u);
    assert.equal(contract.response.replayHeader.name, 'Idempotency-Replayed');
    assert.equal(contract.response.replayHeader.value, 'true');
    assert.match(routeSource, /response\.headers\.set\('Idempotency-Replayed', 'true'\);/u);
    for (const status of [400, 401, 404, 409, 413, 500, 503]) {
      assert.ok(contract.response.errorStatusCodes.includes(status));
    }
  },
);
