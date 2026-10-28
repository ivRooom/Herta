import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@herta/db';
import { setVoiceConsentAsAdmin, VoiceConsentRefusedError } from './vc-recap-consent-admin.ts';

const INPUT = {
  guildId: '100000000000000000',
  actorId: '200000000000000000',
  userId: '300000000000000000',
};

function fakePrisma(existing: { voiceTranscriptionConsent: boolean } | null) {
  const writes: string[] = [];
  const row = (consent: boolean) => ({
    userId: INPUT.userId,
    voiceTranscriptionConsent: consent,
    voiceTranscriptRetentionConsentedAt: null,
    updatedAt: new Date('2026-10-29T00:00:00Z'),
  });
  const prisma = {
    userDataConsent: {
      findUnique: async () =>
        existing
          ? { ...row(existing.voiceTranscriptionConsent), updatedAt: new Date('2026-10-01') }
          : null,
      upsert: async (args: { update: { voiceTranscriptionConsent: boolean } }) => {
        writes.push(`consent:${args.update.voiceTranscriptionConsent}`);
        return row(args.update.voiceTranscriptionConsent);
      },
    },
    vcRecapTranscriptSegment: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    auditLog: {
      create: async () => {
        writes.push('audit');
        return {};
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, writes };
}

test('本人が拒否しているメンバーを管理者は同意済みにできない', async () => {
  const { prisma, writes } = fakePrisma({ voiceTranscriptionConsent: false });
  await assert.rejects(
    setVoiceConsentAsAdmin(prisma, { ...INPUT, consent: true }),
    VoiceConsentRefusedError,
  );
  assert.deepEqual(writes, []);
});

test('一度も選んでいないメンバーは管理者が同意済みにできる', async () => {
  const { prisma, writes } = fakePrisma(null);
  await setVoiceConsentAsAdmin(prisma, { ...INPUT, consent: true });
  assert.deepEqual(writes, ['consent:true', 'audit']);
});

test('管理者は同意を取り消せる', async () => {
  const { prisma, writes } = fakePrisma({ voiceTranscriptionConsent: true });
  await setVoiceConsentAsAdmin(prisma, { ...INPUT, consent: false });
  assert.deepEqual(writes, ['consent:false', 'audit']);
});
