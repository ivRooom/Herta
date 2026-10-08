import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  IVRM_IAM_BATCH_MAX_ITEMS,
  IVRM_IAM_BODY_MAX_BYTES,
  IVRM_IAM_CAPABILITIES,
  IVRM_IAM_MEMBERS_LIMIT_DEFAULT,
  IVRM_IAM_MEMBERS_LIMIT_OPTIONS,
} from './ivrm-iam-management.ts';

type ManagementOperation = {
  method: string;
  pathTemplate: string;
  capability: string;
  requiredHeaders: string[];
  optionalHeaders: string[];
  queryParameters: Array<{ name: string; required: boolean; default?: unknown; enum?: unknown[] }>;
  bodyMaxBytes: number | null;
  successStatusCodes: number[];
  errorStatusCodes: number[];
};

type HertaIamBundle = {
  contract: { id: string; version: string };
  management: {
    limits: {
      batchMaxItems: number;
      bodyMaxBytes: number;
      membersLimitOptions: number[];
      membersLimitDefault: number;
      groupMembershipLimit: number | null;
    };
    capabilities: string[];
    operations: Record<string, ManagementOperation>;
  };
};

const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/herta-iam.v1.bundle.json', import.meta.url),
    'utf8',
  ),
) as HertaIamBundle;
const operations = Object.entries(bundle.management.operations);

function routeFileFor(pathTemplate: string) {
  const relative = pathTemplate
    .replace(
      '/api/integrations/ivrm/guilds/{guildId}/iam',
      'api/integrations/ivrm/guilds/[guildId]/iam',
    )
    .replace(/\{([A-Za-z]+)\}/gu, '[$1]');
  return new URL(`../app/${relative}/route.ts`, import.meta.url);
}

test('Herta IAM v1.1.0 管理operationのportable contractをpinしている', () => {
  assert.equal(bundle.contract.id, 'herta-iam');
  assert.equal(bundle.contract.version, '1.1.0');
  assert.equal(operations.length, 9);
});

test('実装の上限値・capabilitiesが契約のlimits/capabilitiesと一致する', () => {
  const { limits } = bundle.management;
  assert.equal(limits.batchMaxItems, IVRM_IAM_BATCH_MAX_ITEMS);
  assert.equal(limits.bodyMaxBytes, IVRM_IAM_BODY_MAX_BYTES);
  assert.deepEqual(limits.membersLimitOptions, [...IVRM_IAM_MEMBERS_LIMIT_OPTIONS]);
  assert.equal(limits.membersLimitDefault, IVRM_IAM_MEMBERS_LIMIT_DEFAULT);
  // グループのメンバー数に上限はない。
  assert.equal(limits.groupMembershipLimit, null);
  assert.deepEqual([...IVRM_IAM_CAPABILITIES].sort(), [...bundle.management.capabilities].sort());
});

test('契約の全operationに対応するrouteがあり、HTTPメソッドをexportしている', () => {
  for (const [operationId, operation] of operations) {
    const file = routeFileFor(operation.pathTemplate);
    assert.equal(
      existsSync(file),
      true,
      `${operationId}: route file is missing (${file.pathname})`,
    );
    const source = readFileSync(file, 'utf8');
    assert.equal(
      source.includes(`export async function ${operation.method}(`),
      true,
      `${operationId}: ${operation.method} is not exported`,
    );
  }
});

test('変更系operationはX-IVRM-Actor-IDが必須で、Idempotency-Keyは任意', () => {
  for (const [operationId, operation] of operations) {
    if (operation.method === 'GET') {
      assert.deepEqual(operation.requiredHeaders, [], operationId);
      continue;
    }
    assert.deepEqual(operation.requiredHeaders, ['X-IVRM-Actor-ID'], operationId);
    assert.deepEqual(operation.optionalHeaders, ['Idempotency-Key'], operationId);
    assert.ok(operation.errorStatusCodes.includes(429), `${operationId} documents 429`);
  }
});

test('グループ削除はexpectedUpdatedAt必須・cascade既定false・membersLimitの許可値が契約どおり', () => {
  const operation = bundle.management.operations['deleteHertaIamAccessGroup']!;
  const query = Object.fromEntries(
    operation.queryParameters.map((parameter) => [parameter.name, parameter]),
  );

  assert.equal(query['expectedUpdatedAt']?.required, true);
  assert.equal(query['cascade']?.default, false);
  assert.deepEqual(query['membersLimit']?.enum, [...IVRM_IAM_MEMBERS_LIMIT_OPTIONS]);
  assert.equal(query['membersLimit']?.default, IVRM_IAM_MEMBERS_LIMIT_DEFAULT);
  assert.ok(operation.errorStatusCodes.includes(409));
});

test('一括operationのボディ上限は契約と一致し、概要(GET /iam)はcapabilitiesを返す', () => {
  for (const operationId of ['changeHertaIamGroupMembers', 'changeHertaIamPolicyAttachments']) {
    assert.equal(bundle.management.operations[operationId]?.bodyMaxBytes, IVRM_IAM_BODY_MAX_BYTES);
  }
  const overview = readFileSync(
    routeFileFor(bundle.management.operations['getHertaIamOverview']!.pathTemplate),
    'utf8',
  );
  assert.match(overview, /capabilities: \[\.\.\.IVRM_IAM_CAPABILITIES\]/);
});
