import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@herta/db';
import { setVoiceConsentAsAdmin, VoiceConsentRefusedError } from './vc-recap-consent-admin.ts';

const INPUT = {
  guildId: '100000000000000000',
  actorId: '200000000000000000',
  userId: '300000000000000000',
};

/**
 * userDataConsentを1行のメモリ上の状態で模したfake。refuseBeforeWriteを指定すると、
 * 管理者フローの最初の読み取りの直後に本人が拒否した状況(同時実行)を再現する。
 */
function fakePrisma(
  existing: { voiceTranscriptionConsent: boolean } | null,
  options: { refuseBeforeWrite?: boolean } = {},
) {
  const writes: string[] = [];
  let stored = existing
    ? {
        voiceTranscriptionConsent: existing.voiceTranscriptionConsent,
        updatedAt: new Date('2026-10-01'),
      }
    : null;
  let reads = 0;
  const toRow = (state: NonNullable<typeof stored>) => ({
    userId: INPUT.userId,
    voiceTranscriptionConsent: state.voiceTranscriptionConsent,
    voiceTranscriptRetentionConsentedAt: null,
    updatedAt: state.updatedAt,
  });
  const prisma = {
    $queryRawUnsafe: async () => [],
    userDataConsent: {
      findUnique: async () => {
        reads += 1;
        const row = stored ? toRow(stored) : null;
        if (reads === 1 && options.refuseBeforeWrite) {
          stored = { voiceTranscriptionConsent: false, updatedAt: new Date('2026-10-29') };
        }
        return row;
      },
      createMany: async (args: { data: { voiceTranscriptionConsent: boolean }[] }) => {
        if (stored) return { count: 0 };
        stored = {
          voiceTranscriptionConsent: args.data[0]!.voiceTranscriptionConsent,
          updatedAt: new Date(),
        };
        writes.push(`consent:${stored.voiceTranscriptionConsent}`);
        return { count: 1 };
      },
      upsert: async (args: { update: { voiceTranscriptionConsent: boolean } }) => {
        stored = {
          voiceTranscriptionConsent: args.update.voiceTranscriptionConsent,
          updatedAt: new Date(),
        };
        writes.push(`consent:${stored.voiceTranscriptionConsent}`);
        return toRow(stored);
      },
    },
    vcRecapTranscriptSegment: { deleteMany: async () => ({ count: 0 }) },
    vcRecapExplicitConsent: {
      updateMany: async () => {
        writes.push('long-term:revoke');
        return { count: 0 };
      },
    },
    vcRecapErasureRequest: {
      upsert: async () => {
        writes.push('erasure');
        return { userId: INPUT.userId };
      },
    },
    $transaction: async (ops: unknown): Promise<unknown> => {
      if (typeof ops === 'function') {
        return (ops as (client: unknown) => Promise<unknown>)(prisma);
      }
      return Promise.all(ops as Promise<unknown>[]);
    },
    auditLog: {
      create: async () => {
        writes.push('audit');
        return {};
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, writes, current: () => stored };
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
  assert.deepEqual(writes, ['consent:false', 'long-term:revoke', 'erasure', 'audit']);
});

test('読み取りの直後に本人が拒否した場合も、管理者の付与で拒否を上書きしない', async () => {
  const { prisma, writes, current } = fakePrisma(null, { refuseBeforeWrite: true });
  await assert.rejects(
    setVoiceConsentAsAdmin(prisma, { ...INPUT, consent: true }),
    VoiceConsentRefusedError,
  );
  assert.equal(current()?.voiceTranscriptionConsent, false);
  assert.deepEqual(writes, []);
});
