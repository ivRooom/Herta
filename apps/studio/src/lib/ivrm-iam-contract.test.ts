import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { RequestBodyTooLargeError, readRequestBodyBytes } from './bounded-request-body.ts';
import {
  isIvrmIamJsonRequest,
  IVRM_IAM_GROUP_BODY_MAX_BYTES,
  parseIvrmIamGroupCreateInput,
  readIvrmIamMutationContext,
  serializeIvrmIamGroupCreateResponse,
} from './ivrm-iam-mutation.ts';
import { authorizeIvrmIntegrationRequest } from './ivrm-integration-auth.ts';

type HertaIamBundle = {
  bundleVersion: number;
  contract: { id: string; version: string; sourceRepository: string };
  createAccessGroup: {
    method: string;
    pathTemplate: string;
    authentication: { type: string; scheme: string };
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
      required: string[];
      additionalProperties: boolean;
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
const TEST_GUILD_ID = '123456789012345678';
const TEST_TOKEN = '0123456789abcdef0123456789abcdef';

function contractUrl() {
  return `https://herta.ivrm.jp${contract.pathTemplate.replace('{guildId}', TEST_GUILD_ID)}`;
}

function routeFileUrl() {
  const routePath = contract.pathTemplate.replace('{guildId}', '[guildId]').replace(/^\//u, '');
  return new URL(`../app/${routePath}/route.ts`, import.meta.url);
}

function mutationRequest(actorId: string, idempotencyKey: string, contentType?: string) {
  const headers = new Headers({
    [contract.headers.actorId.name]: actorId,
    [contract.headers.idempotencyKey.name]: idempotencyKey,
  });
  if (contentType) headers.set('Content-Type', contentType);

  return new Request(contractUrl(), {
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
  assert.equal(contract.pathTemplate, '/api/integrations/ivrm/guilds/{guildId}/iam/groups');
  assert.equal(existsSync(routeFileUrl()), true);
});

test('Herta IAM authentication conforms to the portable bearer contract', () => {
  assert.deepEqual(contract.authentication, { type: 'http', scheme: 'bearer' });

  const request = new Request(contractUrl(), {
    method: contract.method,
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  const authorization = authorizeIvrmIntegrationRequest(request, {
    IVRM_INTEGRATION_TOKEN: TEST_TOKEN,
    IVRM_INTEGRATION_GUILD_ID: TEST_GUILD_ID,
  });

  assert.deepEqual(authorization, {
    status: 'authorized',
    config: { token: TEST_TOKEN, guildId: TEST_GUILD_ID },
  });
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
  assert.equal(
    isIvrmIamJsonRequest(mutationRequest(actorId, key, contract.request.contentType)),
    true,
  );
  assert.equal(
    isIvrmIamJsonRequest(
      mutationRequest(actorId, key, `${contract.request.contentType}; charset=utf-8`),
    ),
    true,
  );
  assert.equal(isIvrmIamJsonRequest(mutationRequest(actorId, key, 'text/plain')), false);
  assert.equal(isIvrmIamJsonRequest(mutationRequest(actorId, key)), false);
});

test('Herta IAM body limit follows the portable byte boundary', async () => {
  assert.equal(IVRM_IAM_GROUP_BODY_MAX_BYTES, contract.request.maxBytes);

  const atLimit = await readRequestBodyBytes(
    new Request(contractUrl(), {
      method: contract.method,
      body: 'x'.repeat(contract.request.maxBytes),
    }),
    IVRM_IAM_GROUP_BODY_MAX_BYTES,
  );
  assert.equal(atLimit.byteLength, contract.request.maxBytes);

  await assert.rejects(
    readRequestBodyBytes(
      new Request(contractUrl(), {
        method: contract.method,
        body: 'x'.repeat(contract.request.maxBytes + 1),
      }),
      IVRM_IAM_GROUP_BODY_MAX_BYTES,
    ),
    RequestBodyTooLargeError,
  );
});

test('Herta IAM group input normalization conforms to portable request constraints', () => {
  const name = contract.request.fields.name;
  const description = contract.request.fields.description;
  const minimumName = 'x'.repeat(name.normalizedMinLength);
  const maximumUnicodeName = '😀'.repeat(name.normalizedMaxLength);
  const maximumUnicodeDescription = '🧩'.repeat(description.normalizedMaxLength);

  assert.deepEqual(contract.request.required, ['name']);
  assert.equal(contract.request.additionalProperties, true);
  assert.equal(name.normalization, 'trim');
  assert.equal(description.normalization, 'trim-and-empty-to-null');
  assert.equal(parseIvrmIamGroupCreateInput({ description: 'missing name' }), null);
  assert.deepEqual(parseIvrmIamGroupCreateInput({ name: minimumName, futureField: true }), {
    name: minimumName,
    description: null,
  });
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
  assert.deepEqual(
    Object.keys(serialized.group).sort(),
    [...contract.response.group.required].sort(),
  );
  assert.match(serialized.group.id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu);
  assert.equal(serialized.group.name.length <= contract.response.group.fields.name.maxLength, true);
  assert.equal(serialized.group.description, null);
  assert.equal(serialized.group.updatedAt, '2026-08-20T00:00:00.000Z');
});

test('Herta IAM route keeps bounded body, success status and replay semantics aligned with contract', () => {
  const routeSource = readFileSync(routeFileUrl(), 'utf8');

  assert.match(routeSource, /readRequestBodyBytes\(request, IVRM_IAM_GROUP_BODY_MAX_BYTES\)/u);
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
