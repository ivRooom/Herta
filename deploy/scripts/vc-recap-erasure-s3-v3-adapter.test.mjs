import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createS3ErasureLedgerReceiptPort } from './vc-recap-erasure-s3-v3-adapter.mjs';
import { acceptVcRecapErasureWriteFirst } from './vc-recap-erasure-write-first.mjs';
import { ERASURE_EVENT_KIND } from './vc-recap-erasure-ledger-contract.mjs';

const BUCKET = 'herta-independent-erasure-ledger-test';
const AUDIO_BUCKET = 'herta-private-audio-test';
const USER_ID = '123456789012345678';
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const receipt = {
  kind: ERASURE_EVENT_KIND,
  requestId: REQUEST_ID,
  userId: USER_ID,
  requestedAt: '2026-11-01T09:01:00Z',
};
const body = JSON.stringify(receipt);
const key = 'erasure-ledger/v1/' + REQUEST_ID + '.json';
const sha256 = createHash('sha256').update(body).digest('hex');
const request = { key, body, sha256 };

function command(operation) {
  return class {
    constructor(input) {
      this.operation = operation;
      this.input = input;
    }
  };
}
const commands = {
  PutObjectCommand: command('put'),
  GetObjectCommand: command('get'),
};

function mockS3() {
  const objects = new Map();
  const calls = [];
  const states = { failure: null, tamperRead: null, fakeAck: false };
  const client = {
    async send(message) {
      const { operation, input } = message;
      calls.push({ operation, input });
      if (states.failure === operation) {
        const error = new Error('sensitive-bucket-and-user-' + USER_ID);
        error.name = 'AccessDenied';
        error.$metadata = { httpStatusCode: 403 };
        throw error;
      }
      if (states.failure === 'conflict' && operation === 'put') {
        const error = new Error('concurrent-pending');
        error.name = 'ConditionalRequestConflict';
        error.$metadata = { httpStatusCode: 409 };
        throw error;
      }
      if (operation === 'put') {
        if (objects.has(input.Key)) {
          const error = new Error('same-key');
          error.name = 'PreconditionFailed';
          error.$metadata = { httpStatusCode: 412 };
          throw error;
        }
        if (!states.fakeAck) objects.set(input.Key, Buffer.from(input.Body));
        return { $metadata: { httpStatusCode: 200 } };
      }
      if (operation === 'get') {
        const stored = objects.get(input.Key);
        if (!stored) {
          const error = new Error('missing');
          error.name = 'NoSuchKey';
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        const data = states.tamperRead ?? stored;
        return {
          $metadata: { httpStatusCode: 200 },
          ContentLength: data.length,
          Body: Readable.from([data]),
        };
      }
      throw new Error('Unexpected fake S3 command');
    },
  };
  return { client, calls, objects, states };
}

async function withBucket(run) {
  const original = process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
  const audio = process.env['VC_RECAP_STORAGE_BUCKET'];
  process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = BUCKET;
  process.env['VC_RECAP_STORAGE_BUCKET'] = AUDIO_BUCKET;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
    else process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = original;
    if (audio === undefined) delete process.env['VC_RECAP_STORAGE_BUCKET'];
    else process.env['VC_RECAP_STORAGE_BUCKET'] = audio;
  }
}

test('conditioned PutObject + exact GetObject byte readback produces an auditable receipt', async () => {
  await withBucket(async () => {
    const mock = mockS3();
    const port = createS3ErasureLedgerReceiptPort(mock.client, commands);
    assert.deepEqual(await port.appendImmutableReceipt(request), { status: 'durable', sha256 });
    assert.deepEqual(
      mock.calls.map((call) => call.operation),
      ['put', 'get'],
    );
    assert.equal(mock.calls[0].input.Bucket, BUCKET);
    assert.equal(mock.calls[0].input.Key, key);
    assert.equal(mock.calls[0].input.IfNoneMatch, '*');
    assert.equal(mock.calls[0].input.ChecksumSHA256, Buffer.from(sha256, 'hex').toString('base64'));
    assert.equal(mock.objects.get(key).toString(), body);
  });
});

test('repeated request requires stored body equality; no new version may be written', async () => {
  await withBucket(async () => {
    const mock = mockS3();
    const port = createS3ErasureLedgerReceiptPort(mock.client, commands);
    await port.appendImmutableReceipt(request);
    assert.deepEqual(await port.appendImmutableReceipt(request), {
      status: 'verified-existing',
      sha256,
    });
    assert.deepEqual(
      mock.calls.map((call) => call.operation),
      ['put', 'get', 'put', 'get'],
    );
    assert.equal(mock.objects.size, 1);
  });
});

test('different persisted bytes and a false HTTP 200 acknowledgement are denied', async () => {
  await withBucket(async () => {
    const mock = mockS3();
    const port = createS3ErasureLedgerReceiptPort(mock.client, commands);
    mock.objects.set(key, Buffer.from('corrupted-private-content'));
    await assert.rejects(port.appendImmutableReceipt(request), /could not be verified/);
    mock.objects.clear();
    mock.states.fakeAck = true;
    await assert.rejects(port.appendImmutableReceipt(request), /could not be verified/);
  });
});

test('readback must exactly match the expected bytes, not just the SDK ETag', async () => {
  await withBucket(async () => {
    const mock = mockS3();
    const port = createS3ErasureLedgerReceiptPort(mock.client, commands);
    mock.states.tamperRead = Buffer.alloc(Buffer.byteLength(body), 32);
    await assert.rejects(port.appendImmutableReceipt(request), /could not be verified/);
  });
});

test('transient concurrency 409 and denied IAM never acknowledge, and errors are sanitized', async () => {
  await withBucket(async () => {
    for (const failure of ['conflict', 'put', 'get']) {
      const mock = mockS3();
      mock.states.failure = failure;
      const port = createS3ErasureLedgerReceiptPort(mock.client, commands);
      await assert.rejects(
        port.appendImmutableReceipt(request),
        (error) => !error.message.includes(USER_ID) && !error.message.includes(BUCKET),
      );
    }
  });
});

test('missing or shared bucket configuration and malformed receipts fail before S3 IO', async () => {
  await withBucket(async () => {
    const mock = mockS3();
    const port = createS3ErasureLedgerReceiptPort(mock.client, commands);
    for (const invalid of [
      { ...request, key: 'vc-recap/users/' + USER_ID + '/audio.ogg' },
      { ...request, sha256: '0'.repeat(64) },
      { ...request, body: body + ' ' },
      { ...request, body: body + ' '.repeat(5000) },
    ]) {
      await assert.rejects(port.appendImmutableReceipt(invalid));
    }
    process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = AUDIO_BUCKET;
    await assert.rejects(port.appendImmutableReceipt(request), /not configured/);
    delete process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
    await assert.rejects(port.appendImmutableReceipt(request), /not configured/);
    assert.equal(mock.calls.length, 0);
  });
});

test('the existing write-first orchestrator can use the S3 port without any production wiring', async () => {
  await withBucket(async () => {
    const mock = mockS3();
    const order = [];
    const port = createS3ErasureLedgerReceiptPort(mock.client, commands);
    const outcome = await acceptVcRecapErasureWriteFirst(receipt, {
      quarantineOwner: async () => order.push('quarantine'),
      appendImmutableReceipt: async (input) => {
        order.push('ledger');
        return port.appendImmutableReceipt(input);
      },
      applyDatabaseFence: async () => order.push('fence'),
    });
    assert.deepEqual(order, ['quarantine', 'ledger', 'fence']);
    assert.deepEqual(outcome, { status: 'accepted', deletionComplete: false });
  });
});
