import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import test from 'node:test';
import {
  createVcRecapErasureCase,
  findOpenVcRecapErasureCase,
  isVcRecapErasureTicketLinkEnabled,
  type VcRecapErasureCaseRecord,
} from './vc-recap-erasure-cases.js';

const USER_ID = '688313716055343104';

type CaseRow = VcRecapErasureCaseRecord;

function makeRow(overrides: Partial<CaseRow> = {}): CaseRow {
  const now = new Date('2026-11-28T00:00:00Z');
  return {
    id: 'case-row-1',
    requestId: 'request-1',
    userId: USER_ID,
    guildId: null,
    ticketId: null,
    scope: 'all',
    recordingIds: [],
    reason: null,
    status: 'requested',
    requestedAt: now,
    decidedAt: null,
    decidedBy: null,
    executedAt: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface FindFirstArgs {
  where: { userId: string; status: { in: string[] } };
  orderBy: { createdAt: 'asc' };
}

/** status の in フィルタと userId を実際に評価するインメモリ fake。 */
function makeFakePrisma(initialRows: CaseRow[] = []) {
  const rows = [...initialRows];
  const createCalls: Array<Record<string, unknown>> = [];
  const matches = (row: CaseRow, args: FindFirstArgs) =>
    row.userId === args.where.userId && args.where.status.in.includes(row.status);
  const delegate = {
    findFirst: async (args: FindFirstArgs) =>
      rows
        .filter((row) => matches(row, args))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createCalls.push(data);
      const row = makeRow({
        id: `case-row-${rows.length + 1}`,
        requestId: data['requestId'] as string,
        userId: data['userId'] as string,
        guildId: (data['guildId'] as string | null) ?? null,
        scope: data['scope'] as string,
        recordingIds: data['recordingIds'] as string[],
        reason: (data['reason'] as string | null) ?? null,
        status: data['status'] as string,
      });
      rows.push(row);
      return row;
    },
  };
  const client = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ $queryRawUnsafe: async () => [], vcRecapErasureCase: delegate }),
    vcRecapErasureCase: delegate,
  } as unknown as PrismaClient;
  return { client, rows, createCalls };
}

test('チケット連携フラグは env が厳密に true のときだけ有効', () => {
  assert.equal(isVcRecapErasureTicketLinkEnabled({}), false);
  assert.equal(
    isVcRecapErasureTicketLinkEnabled({ VC_RECAP_ERASURE_TICKET_LINK_ENABLED: 'true' }),
    true,
  );
  assert.equal(
    isVcRecapErasureTicketLinkEnabled({ VC_RECAP_ERASURE_TICKET_LINK_ENABLED: 'false' }),
    false,
  );
  assert.equal(
    isVcRecapErasureTicketLinkEnabled({ VC_RECAP_ERASURE_TICKET_LINK_ENABLED: '1' }),
    false,
  );
});

test('未完了ケースが無ければ新規ケースを requested で登録する', async () => {
  const { client, createCalls } = makeFakePrisma();
  const result = await createVcRecapErasureCase(client, {
    userId: USER_ID,
    guildId: 'guild-1',
    reason: '退会のため',
    requestId: 'request-new',
  });
  assert.equal(result.created, true);
  assert.equal(result.erasureCase.requestId, 'request-new');
  assert.equal(result.erasureCase.status, 'requested');
  assert.equal(result.erasureCase.scope, 'all');
  assert.equal(result.erasureCase.guildId, 'guild-1');
  // 理由は Herta 側のケースにのみ保持される (Web へ送る経路はこの層に無い)。
  assert.equal(result.erasureCase.reason, '退会のため');
  assert.equal(createCalls.length, 1);
});

test('requestId を省略すると UUID が採番される', async () => {
  const { client } = makeFakePrisma();
  const result = await createVcRecapErasureCase(client, { userId: USER_ID });
  assert.equal(result.created, true);
  assert.match(
    result.erasureCase.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.equal(result.erasureCase.guildId, null);
  assert.equal(result.erasureCase.reason, null);
});

test('未完了ケースがある間は新規ケースを作らず既存を返す (重複抑止・冪等)', async () => {
  const existing = makeRow({ requestId: 'request-open', status: 'requested' });
  const { client, createCalls } = makeFakePrisma([existing]);
  const first = await createVcRecapErasureCase(client, {
    userId: USER_ID,
    requestId: 'request-dup',
  });
  assert.equal(first.created, false);
  assert.equal(first.erasureCase.requestId, 'request-open');
  const second = await createVcRecapErasureCase(client, { userId: USER_ID });
  assert.equal(second.created, false);
  assert.equal(second.erasureCase.requestId, 'request-open');
  assert.equal(createCalls.length, 0);
});

test('審査中相当の各状態 (on_hold / approved / executing / failed) も未完了として重複を抑止する', async () => {
  for (const status of ['on_hold', 'approved', 'executing', 'failed']) {
    const { client, createCalls } = makeFakePrisma([makeRow({ status })]);
    const result = await createVcRecapErasureCase(client, { userId: USER_ID });
    assert.equal(result.created, false, `status=${status}`);
    assert.equal(createCalls.length, 0, `status=${status}`);
  }
});

test('却下・完了したケースは新しい申請を妨げない', async () => {
  for (const status of ['rejected', 'completed']) {
    const { client, createCalls } = makeFakePrisma([makeRow({ status })]);
    const result = await createVcRecapErasureCase(client, {
      userId: USER_ID,
      requestId: 'request-next',
    });
    assert.equal(result.created, true, `status=${status}`);
    assert.equal(result.erasureCase.requestId, 'request-next');
    assert.equal(createCalls.length, 1, `status=${status}`);
  }
});

test('findOpenVcRecapErasureCase は未完了ケースだけを返す', async () => {
  const open = makeRow({ requestId: 'request-open', status: 'on_hold' });
  const { client } = makeFakePrisma([
    makeRow({ requestId: 'request-done', status: 'completed' }),
    open,
  ]);
  assert.equal((await findOpenVcRecapErasureCase(client, USER_ID))?.requestId, 'request-open');
  const closedOnly = makeFakePrisma([makeRow({ status: 'rejected' })]);
  assert.equal(await findOpenVcRecapErasureCase(closedOnly.client, USER_ID), null);
  assert.equal(await findOpenVcRecapErasureCase(closedOnly.client, '999999999999999999'), null);
});
