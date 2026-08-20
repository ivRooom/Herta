import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isIvrmIamJsonRequest,
  parseIvrmIamGroupCreateInput,
  readIvrmIamMutationContext,
  serializeIvrmIamGroupCreateResponse,
} from './ivrm-iam-mutation.ts';

type HertaIamBundle = {
  bundleVersion: number;
  contract: { id: string; version: string; sourceRepository: string };
  createAccessGroup: {
    method: string;
    headers: {
      actorId: { name: string; pattern: string };
      idempotencyKey: {
        name: string;
        pattern: string;
        minLength: number;
        maxLength: number;
      };
    };
    request: {
      contentType: string;
      maxBytes: number;
      fields: {
        name: {
          normalizedMinLength: number;
          normalizedMaxLength: number;
          normalization: string;
        };
        description: {
          normalizedMaxLength: number;
          normalization: string;
        };
      };
    };
    response: {
      successStatusCodes: number[];
      errorStatusCodes: number[];
      replayHeader: { name: string; value: string };
      required: string[];
      additionalProperties: boolean;
      status: string;
      replayedType: string;
      group: {
        required: string[];
        additionalProperties: boolean;
        fields: {
          id: { type: string; format: string };
          name: { type: string; minLength: number; maxLength: number };
          description: { type: string[]; maxLength: number };
          updatedAt: { type: string; format: string };
        };
      };
      error: {
        required: string[];
        additionalProperties: boolean;
        fields: { error: { type: string; minLength: number } };
      };
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

function mutationRequest(actorId: string, idempotencyKey: string, contentType?: string) {
  const headers = new Headers({
    [contract.headers.actorId.name]: actorId,
    [contract.headers.idempotencyKey.name]: idempotencyKey,
  });
  if (contentType) headers.set('Content-Type', contentType);

  return new Request('https://herta.ivrm.jp/contract-test', {
    method: contract.method,
    headers,
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
  const actorPattern = new RegExp(contract.headers.actorId.pattern, 'u');
  const idempotencyPattern = new RegExp(contract.headers.idempotencyKey.pattern, 'u');

  assert.match(actorId, actorPattern);
  assert.match(minKey, idempotencyPattern);
  assert.match(maxKey, idempotencyPattern);
  assert.deepEqual(readIvrmIamMutationContext(mutationRequest(actorId, minKey)), {
    actorId,
    idempotencyKey: minKey,
  });
  assert.deepEqual(readIvrmIamMutationContext(mutationRequest(actorId, maxKey)), {
    actorId,
    idempotencyKey: maxKey,
  });

  const invalidActor = `\u00a0${actorId}`;
  const invalidKey = `${minKey.slice(0, -1)}!`;
  assert.doesNotMatch(invalidActor, actorPattern);
  assert.doesNotMatch(invalidKey, idempotencyPattern);
  assert.equal(readIvrmIamMutationContext(mutationRequest(invalidActor, minKey)), null);
  assert.equal(readIvrmIamMutationContext(mutationRequest(actorId, invalidKey)), null);
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

test('Herta IAM request content type follows the portable contract', () => {
  const actorId = '1'.repeat(18);
  const key = 'a'.repeat(contract.headers.idempotencyKey.minLength);

  assert.equal(contract.request.contentType, 'application/json');
  assert.equal(isIvrmIamJsonRequest(mutationRequest(actorId, key, contract.request.contentType)), true);
  assert.equal(
    isIvrmIamJsonRequest(
      mutationRequest(actorId, key, `${contract.request.contentType}; charset=utf-8`),
    ),
    true,
  );
  assert.equal(isIvrmIamJsonRequest(mutationRequest(actorId, key, 'text/plain')), false);
  assert.equal(isIvrmIamJsonRequest(mutationRequest(actorId, key)), false);
});

test('Herta IAM group input normalization conforms to portable request constraints', () => {
  const name = contract.request.fields.name;
  const description = contract.request.fields.description;
  const minimumName = 'x'.repeat(name.normalizedMinLength);
  const maximumUnicodeName = '😀'.repeat(name.normalizedMaxLength);
  const maximumUnicodeDescription = '🧩'.repeat(description.normalizedMaxLength);

  assert.equal(name.normalization, 'trim');
  assert.equal(description.normalization, 'trim-and-empty-to-null');
  assert.deepEqual(parseIvrmIamGroupCreateInput({ name: ` ${minimumName} ` }), {
    name: minimumName,
    description: null,
  });
  assert.deepEqual(
    parseIvrmIamGroupCreateInput({
      name: maximumUnicodeName,
      description: maximumUnicodeDescription,
    }),
    {
      name: maximumUnicodeName,
      description: maximumUnicodeDescription,
    },
  );
  assert.equal(
    parseIvrmIamGroupCreateInput({
      name: 'x'.repeat(Math.max(0, name.normalizedMinLength - 1)),
    }),
    null,
  );
  assert.equal(
    parseIvrmIamGroupCreateInput({
      name: '😀'.repeat(name.normalizedMaxLength + 1),
    }),
    null,
  );
  assert.equal(
    parseIvrmIamGroupCreateInput({
      name: minimumName,
      description: '🧩'.repeat(description.normalizedMaxLength + 1),
    }),
    null,
  );
});

test('Herta IAM success response serializer conforms to the portable response schema', () => {
  const serialized = serializeIvrmIamGroupCreateResponse(
    {
      id: '122fc321-7325-4ec5-8326-0643f19324ee',
      name: 'Members',
      description: null,
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    },
    true,
  );

  assert.equal(contract.response.additionalProperties, false);
  assert.deepEqual(Object.keys(serialized).sort(), [...contract.response.required].sort());
  assert.equal(serialized.status, contract.response.status);
  assert.equal(typeof serialized.replayed, contract.response.replayedType);
  assert.equal(contract.response.group.additionalProperties, false);
  assert.deepEqual(Object.keys(serialized.group).sort(), [...contract.response.group.required].sort());
  assert.match(serialized.group.id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu);
  assert.equal(serialized.group.name.length <= contract.response.group.fields.name.maxLength, true);
  assert.equal(serialized.group.description, null);
  assert.equal(serialized.group.updatedAt, '2026-08-20T00:00:00.000Z');
});

test('Herta IAM route keeps bounded body, success status and replay semantics aligned with contract', () => {
  const routeSource = readFileSync(
    new URL('../app/api/integrations/ivrm/guilds/[guildId]/iam/groups/route.ts', import.meta.url),
    'utf8',
  );

  assert.equal(contract.request.maxBytes, 16 * 1024);
  assert.match(routeSource, /const MAX_GROUP_BODY_BYTES = 16 \* 1024;/u);
  assert.match(routeSource, /isIvrmIamJsonRequest\(request\)/u);
  assert.deepEqual(contract.response.successStatusCodes, [200, 201]);
  assert.match(routeSource, /return groupResponse\(replay\.group, true, 200\);/u);
  assert.match(routeSource, /return groupResponse\(group, false, 201\);/u);
  assert.match(routeSource, /serializeIvrmIamGroupCreateResponse\(group, replayed\)/u);
  assert.equal(contract.response.replayHeader.name, 'Idempotency-Replayed');
  assert.equal(contract.response.replayHeader.value, 'true');
  assert.match(routeSource, /response\.headers\.set\('Idempotency-Replayed', 'true'\);/u);
  assert.equal(contract.response.error.additionalProperties, false);
  assert.deepEqual(contract.response.error.required, ['error']);
  assert.equal(contract.response.error.fields.error.type, 'string');
  assert.equal(contract.response.error.fields.error.minLength, 1);
  for (const status of [400, 401, 404, 409, 413, 500, 503]) {
    assert.ok(contract.response.errorStatusCodes.includes(status));
  }
});
