import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  getVcRecapExplicitConsentCapabilities,
  getVcRecapLongTermConsentView,
  updateVcRecapLongTermConsentChoices,
  VC_RECAP_LONG_TERM_CONSENT_VERSION,
} from './vc-recap-explicit-consent.js';
import { lockVcRecapStorageOwner } from './vc-recap-storage-lock.js';
import { reserveVcRecapStorageObject } from './vc-recap-storage-ownership.js';

const databaseUrl = process.env['HERTA_VALORANT_TEST_DATABASE_URL'];

const none = { transcription: false, transcriptLongTerm: false, audioLongTerm: false };
const partial = { transcription: true, transcriptLongTerm: true, audioLongTerm: false };
const audioOnly = { transcription: false, transcriptLongTerm: false, audioLongTerm: true };

// Only run against the synthetic PostgreSQL service explicitly provided by CI.
// prettier-ignore
test('real PostgreSQL: three-purpose consent, per-owner withdrawal fence, and upload race',
  { skip: !databaseUrl },
  async () => {
    const url = new URL(databaseUrl!);
    assert(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/valorant_test');
    const oldEnabled = process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'];
    const oldVersion = process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'];
    const oldBucket = process.env['VC_RECAP_STORAGE_BUCKET'];
    process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'] = 'true';
    process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'] = VC_RECAP_LONG_TERM_CONSENT_VERSION;
    process.env['VC_RECAP_STORAGE_BUCKET'] = 'synthetic-vc-test-bucket';
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const owner = '123456789012345690';
    const other = '123456789012345691';
    try {
      await prisma.userDataConsent.createMany({
        data: [
          { userId: owner, voiceTranscriptionConsent: true },
          { userId: other, voiceTranscriptionConsent: true },
        ],
      });
      // A transcript-retention grant cannot be issued without transcription.
      assert.equal(
        await updateVcRecapLongTermConsentChoices(prisma, owner, {
          transcription: false, transcriptLongTerm: true, audioLongTerm: false,
        }),
        'invalid',
      );
      assert.equal(await prisma.vcRecapExplicitConsent.count({ where: { userId: owner } }), 0);
      assert.equal(await updateVcRecapLongTermConsentChoices(prisma, owner, partial), 'updated');
      assert.equal(await updateVcRecapLongTermConsentChoices(prisma, other, audioOnly), 'updated');
      assert.deepEqual(await getVcRecapExplicitConsentCapabilities(prisma, owner), {
        canTranscribe: true,
        canRetainTranscriptLongTerm: true,
        canRecordAudioLongTerm: false,
      });
      assert.deepEqual(await getVcRecapExplicitConsentCapabilities(prisma, other), {
        canTranscribe: false,
        canRetainTranscriptLongTerm: false,
        canRecordAudioLongTerm: true,
      });
      assert.deepEqual((await getVcRecapLongTermConsentView(prisma, owner)).choices, partial);
      assert.deepEqual((await getVcRecapLongTermConsentView(prisma, other)).choices, audioOnly);

      // Only the opted-in audio owner may reserve an S3 object; no S3 is called.
      assert.equal((await reserveVcRecapStorageObject(prisma, {
        userId: owner,
        sessionId: 'synthetic-session',
        kind: 'audio',
        bucket: 'synthetic-vc-test-bucket',
        objectKey: 'vc-recap/users/' + owner + '/synthetic/owner-denied.opus',
      })).status, 'denied');
      assert.equal((await reserveVcRecapStorageObject(prisma, {
        userId: other,
        sessionId: 'synthetic-session',
        kind: 'audio',
        bucket: 'synthetic-vc-test-bucket',
        objectKey: 'vc-recap/users/' + other + '/synthetic/other-accepted.opus',
      })).status, 'reserved');

      // Withdrawal waits for the owner's advisory lock; it must never bypass it.
      let settled = false;
      let withdrawal: ReturnType<typeof updateVcRecapLongTermConsentChoices> | undefined;
      await prisma.$transaction(async (tx) => {
        await lockVcRecapStorageOwner(tx, owner);
        withdrawal = updateVcRecapLongTermConsentChoices(prisma, owner, none);
        void withdrawal.then(
          () => { settled = true; },
          () => { settled = true; },
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(settled, false);
        assert.equal(await tx.vcRecapErasureRequest.count({ where: { userId: owner } }), 0);
      }, { timeout: 10000, maxWait: 10000 });
      assert(withdrawal);
      assert.equal(await withdrawal, 'erasure_requested');

      // Any revoked future purpose now blocks all grants and all new reservations
      // pending a separately verified full deletion; no delete completion is claimed.
      assert.deepEqual(await getVcRecapExplicitConsentCapabilities(prisma, owner), {
        canTranscribe: false,
        canRetainTranscriptLongTerm: false,
        canRecordAudioLongTerm: false,
      });
      assert.equal(await updateVcRecapLongTermConsentChoices(prisma, owner, partial), 'erasure_pending');
      const fence = await prisma.vcRecapErasureRequest.findUniqueOrThrow({ where: { userId: owner } });
      assert.equal(fence.storageDeletionVerifiedAt, null);
      const revoked = await prisma.vcRecapExplicitConsent.findMany({ where: { userId: owner } });
      assert(revoked.every((row) => row.consentedAt === null && row.revokedAt !== null));
      assert.equal((await reserveVcRecapStorageObject(prisma, {
        userId: owner,
        sessionId: 'synthetic-session',
        kind: 'audio',
        bucket: 'synthetic-vc-test-bucket',
        objectKey: 'vc-recap/users/' + owner + '/synthetic/owner-after-revoke.opus',
      })).status, 'denied');
      assert.equal((await getVcRecapLongTermConsentView(prisma, other)).choices.audioLongTerm, true);
      assert.equal(await prisma.vcRecapErasureRequest.count({ where: { userId: other } }), 0);
    } finally {
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
