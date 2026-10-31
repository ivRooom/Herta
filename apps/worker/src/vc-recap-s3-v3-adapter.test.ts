import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createS3V3ErasurePort,
  type S3V3CommandClient,
  type S3V3CommandConstructors,
} from './vc-recap-s3-v3-adapter.js';
import { eraseVcRecapUserS3Prefix } from './vc-recap-s3-erasure.js';

const BUCKET = 'herta-vc-recap-private-test';
const USER = '123456789012345678';
const PREFIX = 'vc-recap/users/' + USER + '/';

// prettier-ignore
function command(operation: string) {
  return class {
    readonly operation = operation;
    constructor(readonly input: Record<string, unknown>) {}
  };
}

// prettier-ignore
const commands = {
  ListObjectVersionsCommand: command('versions'),
  DeleteObjectsCommand: command('delete'),
  ListMultipartUploadsCommand: command('multipart'),
  AbortMultipartUploadCommand: command('abort'),
} satisfies S3V3CommandConstructors;

// prettier-ignore
interface Call {
  operation: string;
  input: Record<string, unknown>;
}

// prettier-ignore
function mockClient(
  onCall: (call: Call) => unknown | Promise<unknown>,
): { client: S3V3CommandClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async send(command) {
        const cast = command as Call;
        const call = { operation: cast.operation, input: cast.input };
        calls.push(call);
        return onCall(call);
      },
    },
  };
}

// prettier-ignore
async function withBucket(run: () => Promise<void>): Promise<void> {
  const previous = process.env['VC_RECAP_STORAGE_BUCKET'];
  process.env['VC_RECAP_STORAGE_BUCKET'] = BUCKET;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env['VC_RECAP_STORAGE_BUCKET'];
    else process.env['VC_RECAP_STORAGE_BUCKET'] = previous;
  }
}

// prettier-ignore
test('SDK v3 ListObjectVersions maps old versions and delete markers without changing the prefix', async () => {
  await withBucket(async () => {
    const mock = mockClient(() => ({
      Versions: [{ Key: PREFIX + 'clip.ogg', VersionId: 'old-version' }],
      DeleteMarkers: [{ Key: PREFIX + 'clip.ogg', VersionId: 'marker' }],
      IsTruncated: true,
    }));
    const port = createS3V3ErasurePort(mock.client, commands);
    const page = await port.listObjectVersions({
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 1000,
    });
    assert.deepEqual(page, {
      versions: [{ key: PREFIX + 'clip.ogg', versionId: 'old-version' }],
      deleteMarkers: [{ key: PREFIX + 'clip.ogg', versionId: 'marker' }],
      isTruncated: true,
    });
    assert.deepEqual(mock.calls[0], {
      operation: 'versions',
      input: { Bucket: BUCKET, Prefix: PREFIX, MaxKeys: 1000 },
    });
  });
});

// prettier-ignore
test('DeleteObjects requires explicit VersionId and verbose acknowledgement for every version', async () => {
  await withBucket(async () => {
    const mock = mockClient(() => ({
      Deleted: [{ Key: PREFIX + 'clip.ogg', VersionId: 'v1' }],
      Errors: [{ Key: PREFIX + 'clip.ogg', VersionId: 'v2', Code: 'AccessDenied' }],
    }));
    const port = createS3V3ErasurePort(mock.client, commands);
    const deleted = await port.deleteObjectVersions({
      bucket: BUCKET,
      objects: [
        { key: PREFIX + 'clip.ogg', versionId: 'v1' },
        { key: PREFIX + 'clip.ogg', versionId: 'v2' },
        { key: PREFIX + 'clip.ogg', versionId: 'v3' },
      ],
    });
    assert.deepEqual(deleted.errors, [
      { key: PREFIX + 'clip.ogg', versionId: 'v2', code: 'AccessDenied' },
      { key: PREFIX + 'clip.ogg', versionId: 'v3' },
    ]);
    assert.deepEqual(mock.calls[0]?.input, {
      Bucket: BUCKET,
      Delete: {
        Objects: [
          { Key: PREFIX + 'clip.ogg', VersionId: 'v1' },
          { Key: PREFIX + 'clip.ogg', VersionId: 'v2' },
          { Key: PREFIX + 'clip.ogg', VersionId: 'v3' },
        ],
        Quiet: false,
      },
    });
  });
});

// prettier-ignore
test('An HTTP-success response without deletion acknowledgements is a failed erasure', async () => {
  await withBucket(async () => {
    const mock = mockClient(() => ({}));
    const port = createS3V3ErasurePort(mock.client, commands);
    const r = await port.deleteObjectVersions({
      bucket: BUCKET,
      objects: [{ key: PREFIX + 'archive.json', versionId: 'v1' }],
    });
    assert.equal(r.errors.length, 1);
  });
});

// prettier-ignore
test('Rejects missing version IDs, shared prefixes, mixed owners and wrong buckets', async () => {
  await withBucket(async () => {
    const mock = mockClient(() => ({
      Versions: [{ Key: PREFIX + 'clip.ogg' }],
    }));
    const port = createS3V3ErasurePort(mock.client, commands);
    await assert.rejects(
      port.listObjectVersions({ bucket: BUCKET, prefix: PREFIX, maxKeys: 1000 }),
      /version without/,
    );
    await assert.rejects(
      port.listObjectVersions({ bucket: BUCKET, prefix: 'vc-recap/', maxKeys: 1000 }),
      /explicit/,
    );
    await assert.rejects(
      port.listObjectVersions({ bucket: 'existing-backups', prefix: PREFIX, maxKeys: 1000 }),
      /Dedicated/,
    );
    await assert.rejects(
      port.deleteObjectVersions({
        bucket: BUCKET,
        objects: [{ key: PREFIX + 'clip.ogg', versionId: 'null' }],
      }),
      /non-null/,
    );
    await assert.rejects(
      port.deleteObjectVersions({
        bucket: BUCKET,
        objects: [
          { key: PREFIX + 'clip.ogg', versionId: 'v1' },
          { key: 'vc-recap/users/999999999999999999/clip.ogg', versionId: 'v1' },
        ],
      }),
      /cross user boundaries/,
    );
    assert.equal(mock.calls.length, 1);
  });
});

// prettier-ignore
test('SDK v3 ListMultipartUploads/AbortMultipartUpload pass only owner-scoped keys', async () => {
  await withBucket(async () => {
    const mock = mockClient(({ operation }) =>
      operation === 'multipart'
        ? { Uploads: [{ Key: PREFIX + 'upload.opus', UploadId: 'up-1' }], IsTruncated: false }
        : {},
    );
    const port = createS3V3ErasurePort(mock.client, commands);
    const page = await port.listMultipartUploads({
      bucket: BUCKET,
      prefix: PREFIX,
      maxUploads: 1000,
    });
    assert.deepEqual(page, {
      uploads: [{ key: PREFIX + 'upload.opus', uploadId: 'up-1' }],
      isTruncated: false,
    });
    await port.abortMultipartUpload({ bucket: BUCKET, key: PREFIX + 'upload.opus', uploadId: 'up-1' });
    assert.deepEqual(mock.calls[1], {
      operation: 'abort',
      input: { Bucket: BUCKET, Key: PREFIX + 'upload.opus', UploadId: 'up-1' },
    });
  });
});

// prettier-ignore
test('SDK responses with malformed multipart pages fail closed', async () => {
  await withBucket(async () => {
    const mock = mockClient(() => ({ Uploads: [{ Key: PREFIX + 'upload.opus' }] }));
    const port = createS3V3ErasurePort(mock.client, commands);
    await assert.rejects(
      port.listMultipartUploads({ bucket: BUCKET, prefix: PREFIX, maxUploads: 1000 }),
      /omitted/,
    );
  });
});

// prettier-ignore
test('The adapter drives the full version-delete / delete-marker / verification sweep', async () => {
  await withBucket(async () => {
    const objects = [
      { Key: PREFIX + 'clip.ogg', VersionId: 'v1' },
      { Key: PREFIX + 'clip.ogg', VersionId: 'v2' },
    ];
    const markers = [{ Key: PREFIX + 'clip.ogg', VersionId: 'marker' }];
    const mock = mockClient(({ operation, input }) => {
      if (operation === 'multipart') return { Uploads: [], IsTruncated: false };
      if (operation === 'versions') return { Versions: objects, DeleteMarkers: markers };
      if (operation === 'delete') {
        const deleteInput = input['Delete'] as { Objects: Array<{ Key: string; VersionId: string }> };
        const acknowledged = deleteInput.Objects;
        for (const item of acknowledged) {
          const index = objects.findIndex((v) => v.Key === item.Key && v.VersionId === item.VersionId);
          if (index >= 0) objects.splice(index, 1);
          const markerIndex = markers.findIndex(
            (v) => v.Key === item.Key && v.VersionId === item.VersionId,
          );
          if (markerIndex >= 0) markers.splice(markerIndex, 1);
        }
        return { Deleted: acknowledged };
      }
      throw new Error('Unexpected AWS command');
    });
    const report = await eraseVcRecapUserS3Prefix(
      createS3V3ErasurePort(mock.client, commands),
      { bucket: BUCKET, userId: USER },
    );
    assert.deepEqual(report, {
      versionsDeleted: 2,
      deleteMarkersDeleted: 1,
      uploadsAborted: 0,
    });
    assert.deepEqual(objects, []);
    assert.deepEqual(markers, []);
  });
});
