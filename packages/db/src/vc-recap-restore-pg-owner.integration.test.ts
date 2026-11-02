import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  parseVcRecapPgFenceTimestamp,
  withVcRecapRestorePgOwnerTransaction,
} from './vc-recap-restore-pg-owner.js';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';

const databaseUrl = process.env['HERTA_VALORANT_TEST_DATABASE_URL'];
const runId = '00000000-0000-4000-8000-000000000729';
const owner = '123456789012345720';
const other = '123456789012345721';
const incoming = '2026-11-02T07:00:00.123Z';
const older = '2026-11-01T07:00:00.123Z';

function instruction(userId: string, requestedAt = incoming) {
  return {
    userId,
    requestedAt,
    storageDeletionVerifiedAt: null,
    revokeLegacyConsent: true,
    revokeAllPurposeConsents: true,
    cancelPendingWrites: true,
  } as const;
}

test('PG(3) restore timestamp accepts only exactly representable milliseconds', () => {
  assert.equal(parseVcRecapPgFenceTimestamp('2026-11-02T07:00:00.123000Z').toISOString(), incoming);
  assert.equal(parseVcRecapPgFenceTimestamp('2026-11-02T07:00:00Z').toISOString(), '2026-11-02T07:00:00.000Z');
  for (const input of [
    '2026-11-02T07:00:00.123001Z',
    '2026-11-02T07:00:00.999999Z',
    '2026-02-30T07:00:00Z',
    '2026-11-02T99:00:00Z',
    '2026-11-02T07:00:00+09:00',
    '2026-11-02',
  ]) {
    assert.throws(() => parseVcRecapPgFenceTimestamp(input));
  }
});

// prettier-ignore
test('real isolated PostgreSQL: owner-locked replay is atomic, monotonic, retryable, and never marks erasure complete',
  { skip: !databaseUrl },
  async () => {
    const url = new URL(databaseUrl!);
    assert(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/valorant_test');
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      await prisma.userDataConsent.createMany({
        data: [
          { userId: owner, voiceTranscriptionConsent: true, voiceTranscriptRetentionConsentedAt: new Date() },
          { userId: other, voiceTranscriptionConsent: true, voiceTranscriptRetentionConsentedAt: new Date() },
        ],
      });
      await prisma.vcRecapExplicitConsent.createMany({
        data: [
          { userId: owner, purpose: 'transcription', policyVersion: 'synthetic', consentedAt: new Date() },
          { userId: owner, purpose: 'openai_audio_processing', policyVersion: 'synthetic', consentedAt: new Date() },
          { userId: other, purpose: 'audio_long_term', policyVersion: 'synthetic', consentedAt: new Date() },
        ],
      });
      await prisma.vcRecapStorageObject.createMany({
        data: [
          { userId: owner, kind: 'audio', bucket: 'synthetic-not-s3', objectKey: 'vc-recap/users/' + owner + '/test.opus', state: 'reserved' },
          { userId: other, kind: 'audio', bucket: 'synthetic-not-s3', objectKey: 'vc-recap/users/' + other + '/test.opus', state: 'reserved' },
        ],
      });

      await withVcRecapRestorePgOwnerTransaction(prisma, runId, owner, async (tx) => {
        assert.equal(await tx.readFence(), null);
        await tx.upsertFenceAndRevoke(instruction(owner));
        const proof = await tx.verifyFenceAndRevocations();
        assert.deepEqual(proof, {
          userId: owner,
          requestedAt: incoming,
          storageDeletionVerifiedAt: null,
          legacyConsentRevoked: true,
          purposeConsentsRevoked: true,
          pendingWritesCancelled: true,
        });
      });
      let fence = await prisma.vcRecapErasureRequest.findUniqueOrThrow({ where: { userId: owner } });
      assert.equal(fence.requestedAt.toISOString(), incoming);
      assert.equal(fence.storageDeletionVerifiedAt, null);
      assert.equal((await prisma.vcRecapStorageObject.findFirstOrThrow({ where: { userId: owner } })).state, 'erasure_pending');
      assert.equal((await prisma.vcRecapStorageObject.findFirstOrThrow({ where: { userId: other } })).state, 'reserved');
      assert.equal((await prisma.userDataConsent.findUniqueOrThrow({ where: { userId: other } })).voiceTranscriptionConsent, true);
      assert.equal((await prisma.vcRecapExplicitConsent.findFirstOrThrow({ where: { userId: other } })).consentedAt !== null, true);

      await prisma.vcRecapErasureRequest.update({
        where: { userId: owner },
        data: { storageDeletionVerifiedAt: new Date('2026-11-02T07:30:00Z') },
      });
      // An older restore receipt must not lower requestedAt or retain the old verification.
      await withVcRecapRestorePgOwnerTransaction(prisma, runId, owner, async (tx) => {
        await tx.upsertFenceAndRevoke(instruction(owner, older));
        assert.equal((await tx.readFence())?.requestedAt, incoming);
      });
      fence = await prisma.vcRecapErasureRequest.findUniqueOrThrow({ where: { userId: owner } });
      assert.equal(fence.requestedAt.toISOString(), incoming);
      assert.equal(fence.storageDeletionVerifiedAt, null);

      // A foreign-owner operation and non-representable microseconds roll back.
      for (const bad of [instruction(owner), instruction(other, '2026-11-02T07:00:00.123001Z')]) {
        await assert.rejects(
          withVcRecapRestorePgOwnerTransaction(prisma, runId, other, async (tx) => {
            await tx.upsertFenceAndRevoke(bad);
          }),
          /transaction unverified/,
        );
      }
      assert.equal(await prisma.vcRecapErasureRequest.count({ where: { userId: other } }), 0);

      // Throw after writes: no partial fence, consent or upload state may commit.
      await assert.rejects(
        withVcRecapRestorePgOwnerTransaction(prisma, runId, other, async (tx) => {
          await tx.upsertFenceAndRevoke(instruction(other));
          throw new Error('private-' + other);
        }),
        (error) => {
          assert(error instanceof Error);
          assert.equal(error.message.includes(other), false);
          return true;
        },
      );
      assert.equal(await prisma.vcRecapErasureRequest.count({ where: { userId: other } }), 0);
      assert.equal((await prisma.userDataConsent.findUniqueOrThrow({ where: { userId: other } })).voiceTranscriptionConsent, true);
      assert.equal((await prisma.vcRecapStorageObject.findFirstOrThrow({ where: { userId: other } })).state, 'reserved');

      // The actual adapter uses the same advisory lock as consent and storage writers.
      await prisma.$transaction(async (held) => {
        await lockVcRecapStorageOwner(held, other);
        await assert.rejects(
          withVcRecapRestorePgOwnerTransaction(prisma, runId, other, async (tx) => {
            await tx.upsertFenceAndRevoke(instruction(other));
          }),
          /transaction unverified/,
        );
      }, { timeout: 12000, maxWait: 5000 });
      assert.equal(await prisma.vcRecapErasureRequest.count({ where: { userId: other } }), 0);
      await withVcRecapRestorePgOwnerTransaction(prisma, runId, other, async (tx) => {
        await tx.upsertFenceAndRevoke(instruction(other));
        assert.equal((await tx.verifyFenceAndRevocations()).pendingWritesCancelled, true);
      });
    } finally {
      await prisma.vcRecapStorageObject.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.vcRecapErasureRequest.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.vcRecapExplicitConsent.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.userDataConsent.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.$disconnect();
    }
  },
);
