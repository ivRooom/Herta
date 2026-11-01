import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  getVcRecapExplicitConsentCapabilities,
  getVcRecapLongTermConsentView,
  updateVcRecapComprehensiveConsent,
  VC_RECAP_LONG_TERM_CONSENT_VERSION,
} from './vc-recap-explicit-consent.js';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';
import { reserveVcRecapStorageObject } from './vc-recap-storage-ownership.js';

const databaseUrl = process.env['HERTA_VALORANT_TEST_DATABASE_URL'];

// prettier-ignore
test('real PostgreSQL: single-policy grant, owner-locked withdrawal, durable erasure fence and user isolation',
  { skip: !databaseUrl },
  async () => {
    const target = new URL(databaseUrl!);
    assert(['localhost', '127.0.0.1'].includes(target.hostname));
    assert.equal(target.pathname, '/valorant_test');
    const oldEnabled = process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'];
    const oldVersion = process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'];
    const oldBucket = process.env['VC_RECAP_STORAGE_BUCKET'];
    process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'] = 'true';
    process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'] = VC_RECAP_LONG_TERM_CONSENT_VERSION;
    process.env['VC_RECAP_STORAGE_BUCKET'] = 'synthetic-vc-test-bucket';
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const owner = '123456789012345670';
    const other = '123456789012345671';
    try {
      // The single affirmative click must not need an earlier legacy opt-in.
      assert.equal(await updateVcRecapComprehensiveConsent(prisma, owner, true), 'updated');
      assert.equal(await updateVcRecapComprehensiveConsent(prisma, other, true), 'updated');
      const grants = await prisma.vcRecapExplicitConsent.findMany({
        where: { userId: owner },
        orderBy: { purpose: 'asc' },
      });
      assert.deepEqual(grants.map((row) => row.purpose), [
        'audio_long_term', 'transcript_long_term', 'transcription',
      ]);
      assert(grants.every((row) =>
        row.policyVersion === VC_RECAP_LONG_TERM_CONSENT_VERSION &&
        row.consentedAt !== null &&
        row.revokedAt === null &&
        row.consentedAt.getTime() === grants[0]?.consentedAt?.getTime()
      ));
      const old = await prisma.userDataConsent.findUniqueOrThrow({ where: { userId: owner } });
      assert.equal(old.voiceTranscriptionConsent, true);
      assert(old.voiceTranscriptRetentionConsentedAt !== null);
      assert.deepEqual(await getVcRecapExplicitConsentCapabilities(prisma, owner), {
        canTranscribe: true,
        canRetainTranscriptLongTerm: true,
        canRecordAudioLongTerm: true,
      });

      // A real storage intent is only a DB ledger row: no S3 service is contacted.
      assert.deepEqual(
        (await reserveVcRecapStorageObject(prisma, {
          userId: owner,
          sessionId: 'synthetic-session',
          kind: 'audio',
          bucket: 'synthetic-vc-test-bucket',
          objectKey: 'vc-recap/users/' + owner + '/synthetic/audio-1.opus',
        })).status,
        'reserved',
      );

      // Hold the same per-user advisory lock on a separate DB connection.
      // Withdrawal MUST NOT commit while the owner lock is held.
      let revokeSettled = false;
      let revokePromise: ReturnType<typeof updateVcRecapComprehensiveConsent> | undefined;
      await prisma.$transaction(async (tx) => {
        await lockVcRecapStorageOwner(tx, owner);
        revokePromise = updateVcRecapComprehensiveConsent(prisma, owner, false);
        void revokePromise.then(
          () => { revokeSettled = true; },
          () => { revokeSettled = true; },
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(revokeSettled, false);
        assert.equal(await tx.vcRecapErasureRequest.count({ where: { userId: owner } }), 0);
      }, { timeout: 10000, maxWait: 10000 });
      assert(revokePromise);
      assert.equal(await revokePromise, 'erasure_requested');

      // The post-withdrawal fence excludes new uploads and any later grant.
      assert.deepEqual(await getVcRecapExplicitConsentCapabilities(prisma, owner), {
        canTranscribe: false,
        canRetainTranscriptLongTerm: false,
        canRecordAudioLongTerm: false,
      });
      assert.equal(await updateVcRecapComprehensiveConsent(prisma, owner, true), 'erasure_pending');
      const fence = await prisma.vcRecapErasureRequest.findUniqueOrThrow({
        where: { userId: owner },
      });
      assert.equal(fence.storageDeletionVerifiedAt, null);
      const retired = await prisma.vcRecapExplicitConsent.findMany({
        where: { userId: owner },
      });
      assert(retired.every((row) => row.consentedAt === null && row.revokedAt !== null));
      assert.equal((await prisma.userDataConsent.findUniqueOrThrow({
        where: { userId: owner },
      })).voiceTranscriptionConsent, false);
      assert.equal((await reserveVcRecapStorageObject(prisma, {
        userId: owner,
        sessionId: 'synthetic-session',
        kind: 'audio',
        bucket: 'synthetic-vc-test-bucket',
        objectKey: 'vc-recap/users/' + owner + '/synthetic/audio-2.opus',
      })).status, 'denied');
      // The second user was not touched by this user's withdrawal.
      assert.equal((await getVcRecapLongTermConsentView(prisma, other)).choices.audioLongTerm, true);
      assert.equal(await prisma.vcRecapErasureRequest.count({ where: { userId: other } }), 0);
    } finally {
      // The database is a throwaway CI service; do not inspect user content.
      await prisma.vcRecapStorageObject.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.vcRecapErasureRequest.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.vcRecapExplicitConsent.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.userDataConsent.deleteMany({ where: { userId: { in: [owner, other] } } });
      await prisma.$disconnect();
      for (const [name, value] of [
        ['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED', oldEnabled],
        ['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION', oldVersion],
        ['VC_RECAP_STORAGE_BUCKET', oldBucket],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  },
);
