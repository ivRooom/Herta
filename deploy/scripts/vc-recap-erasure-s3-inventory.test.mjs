import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ERASURE_EVENT_KIND } from './vc-recap-erasure-ledger-contract.mjs';
import { inspectVcRecapErasureLedgerVersions } from './vc-recap-erasure-s3-inventory.mjs';

const BUCKET = 'herta-independent-ledger-audit-test';
const PREFIX = 'erasure-ledger/v1/';
const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const STAMP = '2026-11-01T09:01:00Z';
const LATER = '2026-11-01T09:03:00Z';
const USER1 = '123456789012345678';
const USER2 = '123456789012345679';

const event = (requestId, userId) => ({
  kind: ERASURE_EVENT_KIND,
  requestId,
  userId,
  requestedAt: STAMP,
});

function version(requestId, versionId = 'one-version') {
  const receipt = event(requestId, requestId === UUID1 ? USER1 : USER2);
  const body = Buffer.from(JSON.stringify(receipt));
  return {
    item: {
      Key: PREFIX + requestId + '.json',
      VersionId: versionId,
      Size: body.length,
      IsLatest: true,
    },
    body,
    receipt,
  };
}

const FIRST = version(UUID1, 'v1');
const SECOND = version(UUID2, 'v2');

function manifestSha256(entries) {
  const manifest = entries
    .map(({ item, body }) => ({
      key: item.Key,
      versionId: item.VersionId,
      receiptSha256: createHash('sha256').update(body).digest('hex'),
    }))
    .sort((a, b) => a.key.localeCompare(b.key, 'en'));
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

const commands = {
  ListObjectVersionsCommand: class {
    constructor(input) {
      this.operation = 'list';
      this.input = input;
    }
  },
  GetObjectCommand: class {
    constructor(input) {
      this.operation = 'get';
      this.input = input;
    }
  },
};

function mockClient(entries, pages = null) {
  const calls = [];
  const items = new Map(entries.map((entry) => [entry.item.Key, entry]));
  let pageIndex = 0;
  const client = {
    async send(command) {
      calls.push(command);
      if (command.operation === 'list') {
        const page = pages
          ? pages[pageIndex++]
          : { Versions: entries.map((entry) => entry.item), IsTruncated: false };
        if (!page) throw new Error('no page');
        return page;
      }
      const data = items.get(command.input.Key);
      if (!data || command.input.VersionId !== data.item.VersionId) {
        throw new Error('confidential-owner-' + USER1);
      }
      return {
        $metadata: { httpStatusCode: 200 },
        ContentLength: data.body.length,
        VersionId: data.item.VersionId,
        Body: Readable.from([data.body]),
      };
    },
  };
  return { client, calls };
}

async function withBucket(fn) {
  const old = process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
  const oldAudio = process.env['VC_RECAP_STORAGE_BUCKET'];
  process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = BUCKET;
  process.env['VC_RECAP_STORAGE_BUCKET'] = 'not-the-ledger-bucket';
  try {
    await fn();
  } finally {
    if (old === undefined) delete process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
    else process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = old;
    if (oldAudio === undefined) delete process.env['VC_RECAP_STORAGE_BUCKET'];
    else process.env['VC_RECAP_STORAGE_BUCKET'] = oldAudio;
  }
}

const options = (entries, changes = {}) => ({
  expectedCount: entries.length,
  expectedManifestSha256: manifestSha256(entries),
  generatedAt: LATER,
  ...changes,
});

test('two pages and version-bound GETs reconstruct deterministic restore fences', async () => {
  await withBucket(async () => {
    const mock = mockClient([FIRST, SECOND], [
      {
        Versions: [FIRST.item],
        IsTruncated: true,
        NextKeyMarker: FIRST.item.Key,
        NextVersionIdMarker: FIRST.item.VersionId,
      },
      { Versions: [SECOND.item], IsTruncated: false },
    ]);
    const result = await inspectVcRecapErasureLedgerVersions(
      mock.client,
      commands,
      options([FIRST, SECOND]),
    );
    assert.deepEqual(result, {
      status: 'local-reconciliation-only',
      canResumeTraffic: false,
      objectCount: 2,
      manifestSha256: manifestSha256([FIRST, SECOND]),
      snapshot: {
        kind: 'vc-recap-independent-erasure-ledger-v1',
        generatedAt: LATER,
        entries: [
          { userId: USER1, requestedAt: STAMP },
          { userId: USER2, requestedAt: STAMP },
        ],
      },
    });
    assert.deepEqual(mock.calls.map((call) => call.operation), [
      'list',
      'list',
      'get',
      'get',
    ]);
    assert.deepEqual(mock.calls[1].input, {
      Bucket: BUCKET,
      Prefix: PREFIX,
      MaxKeys: 1000,
      KeyMarker: FIRST.item.Key,
      VersionIdMarker: FIRST.item.VersionId,
    });
    assert.equal(mock.calls[2].input.VersionId, FIRST.item.VersionId);
  });
});

test('missing authenticated external expected count or digest never passes', async () => {
  await withBucket(async () => {
    for (const invalid of [
      { expectedCount: undefined },
      { expectedManifestSha256: undefined },
      { expectedCount: 3 },
      { expectedManifestSha256: '0'.repeat(64) },
    ]) {
      const mock = mockClient([FIRST, SECOND]);
      await assert.rejects(
        inspectVcRecapErasureLedgerVersions(
          mock.client,
          commands,
          options([FIRST, SECOND], invalid),
        ),
      );
    }
  });
});

test('all historical versions must be unique and unmarked', async () => {
  await withBucket(async () => {
    for (const page of [
      { Versions: [FIRST.item, { ...FIRST.item, VersionId: 'overwritten' }], IsTruncated: false },
      { Versions: [FIRST.item], DeleteMarkers: [FIRST.item], IsTruncated: false },
      { Versions: [{ ...FIRST.item, VersionId: 'null' }], IsTruncated: false },
      { Versions: [{ ...FIRST.item, IsLatest: false }], IsTruncated: false },
      { Versions: [{ ...FIRST.item, Key: 'other-bucket/owner.json' }], IsTruncated: false },
      { Versions: [{ ...FIRST.item, Size: 4097 }], IsTruncated: false },
    ]) {
      const mock = mockClient([FIRST], [page]);
      await assert.rejects(
        inspectVcRecapErasureLedgerVersions(mock.client, commands, options([FIRST])),
      );
    }
  });
});

test('truncated page without cursor, empty page, looping cursor and page overflow are blocked', async () => {
  await withBucket(async () => {
    const badPages = [
      [{ Versions: [], IsTruncated: true }],
      [{ Versions: [FIRST.item], IsTruncated: true }],
      [
        { Versions: [FIRST.item], IsTruncated: true, NextKeyMarker: 'same' },
        { Versions: [SECOND.item], IsTruncated: true, NextKeyMarker: 'same' },
      ],
      [{ Versions: [FIRST.item], IsTruncated: true, NextKeyMarker: 'different' }],
    ];
    for (const [index, pages] of badPages.entries()) {
      const mock = mockClient([FIRST, SECOND], pages);
      await assert.rejects(
        inspectVcRecapErasureLedgerVersions(
          mock.client,
          commands,
          options([FIRST, SECOND], index === 3 ? { maxPages: 1 } : {}),
        ),
      );
    }
  });
});

test('version-bound GET failure, malformed JSON, body mismatch and truncated stream deny', async () => {
  await withBucket(async () => {
    for (const alteration of [
      { body: Buffer.from('{}') },
      { body: Buffer.from(' '.repeat(FIRST.body.length)) },
      { body: Buffer.from(JSON.stringify({ ...FIRST.receipt, userId: USER2 })) },
    ]) {
      const item = { ...FIRST, ...alteration };
      const mock = mockClient([item]);
      await assert.rejects(
        inspectVcRecapErasureLedgerVersions(mock.client, commands, options([FIRST])),
        (error) => !error.message.includes(USER1) && !error.message.includes(BUCKET),
      );
    }
    const mock = mockClient([FIRST]);
    const brokenClient = {
      async send(command) {
        if (command.operation === 'get') throw new Error('sensitive-user-' + USER1);
        return mock.client.send(command);
      },
    };
    await assert.rejects(
      inspectVcRecapErasureLedgerVersions(brokenClient, commands, options([FIRST])),
      (error) => !error.message.includes(USER1),
    );
  });
});

test('empty ledger requires explicit operator acknowledgment of zero independently audited entries', async () => {
  await withBucket(async () => {
    const emptyDigest = manifestSha256([]);
    const mock = mockClient([]);
    await assert.rejects(
      inspectVcRecapErasureLedgerVersions(mock.client, commands, {
        expectedCount: 0,
        expectedManifestSha256: emptyDigest,
        generatedAt: LATER,
      }),
    );
    const result = await inspectVcRecapErasureLedgerVersions(mock.client, commands, {
      expectedCount: 0,
      expectedManifestSha256: emptyDigest,
      generatedAt: LATER,
      allowEmpty: true,
    });
    assert.deepEqual(result.snapshot.entries, []);
    assert.equal(result.canResumeTraffic, false);
  });
});

test('matching audio bucket configuration blocks inventory before network operations', async () => {
  await withBucket(async () => {
    const mock = mockClient([FIRST]);
    process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] =
      process.env['VC_RECAP_STORAGE_BUCKET'];
    await assert.rejects(
      inspectVcRecapErasureLedgerVersions(mock.client, commands, options([FIRST])),
    );
    assert.equal(mock.calls.length, 0);
  });
});
