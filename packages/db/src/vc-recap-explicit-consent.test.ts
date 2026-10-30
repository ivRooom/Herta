import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import test from 'node:test';
import {
  evaluateVcRecapExplicitConsent,
  requestVcRecapErasure,
  VC_RECAP_LONG_TERM_CONSENT_VERSION,
  type VcRecapExplicitConsentRecord,
} from './vc-recap-explicit-consent.js';

function consent(
  purpose: string,
  overrides: Partial<VcRecapExplicitConsentRecord> = {},
): VcRecapExplicitConsentRecord {
  return {
    purpose,
    policyVersion: VC_RECAP_LONG_TERM_CONSENT_VERSION,
    consentedAt: new Date('2026-10-30T00:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

test('新しい明示同意が無い場合は文字起こし・本文長期保存・録音をすべて拒否', () => {
  assert.deepEqual(evaluateVcRecapExplicitConsent([], false), {
    canTranscribe: false,
    canRetainTranscriptLongTerm: false,
    canRecordAudioLongTerm: false,
  });
});

test('旧保存同意を渡さず、新しい処理同意と本文長期保存同意を別々に要求する', () => {
  const textOnly = evaluateVcRecapExplicitConsent([consent('transcript_long_term')], false);
  assert.equal(textOnly.canRetainTranscriptLongTerm, false);
  const both = evaluateVcRecapExplicitConsent(
    [consent('transcription'), consent('transcript_long_term')],
    false,
  );
  assert.equal(both.canRetainTranscriptLongTerm, true);
  assert.equal(both.canRecordAudioLongTerm, false);
});

test('音声録音は文字起こし同意の有無と独立し、旧拒否は優先される', () => {
  assert.equal(
    evaluateVcRecapExplicitConsent([consent('audio_long_term')], false).canRecordAudioLongTerm,
    true,
  );
  assert.equal(
    evaluateVcRecapExplicitConsent([consent('audio_long_term')], true).canRecordAudioLongTerm,
    false,
  );
});

test('ポリシー版不一致・撤回状態は必ず拒否', () => {
  assert.equal(
    evaluateVcRecapExplicitConsent(
      [consent('audio_long_term', { policyVersion: 'old-version' })],
      false,
    ).canRecordAudioLongTerm,
    false,
  );
  assert.equal(
    evaluateVcRecapExplicitConsent([consent('audio_long_term', { revokedAt: new Date() })], false)
      .canRecordAudioLongTerm,
    false,
  );
});

test('削除要求の存在は新同意が全てtrueでも拒否判定になる', () => {
  const records = [
    consent('transcription'),
    consent('transcript_long_term'),
    consent('audio_long_term'),
  ];
  assert.deepEqual(evaluateVcRecapExplicitConsent(records, true), {
    canTranscribe: false,
    canRetainTranscriptLongTerm: false,
    canRecordAudioLongTerm: false,
  });
});

test('削除要求は障壁作成と新同意の取り消しを同一transactionで実行する', async () => {
  const calls: Array<{ operation: string; data: unknown }> = [];
  const client = {
    $transaction: async (run: (tx: unknown) => Promise<void>) =>
      run({
        vcRecapErasureRequest: {
          upsert: async (data: unknown) => {
            calls.push({ operation: 'erasure', data });
          },
        },
        vcRecapExplicitConsent: {
          updateMany: async (data: unknown) => {
            calls.push({ operation: 'revoke', data });
          },
        },
      }),
  } as unknown as PrismaClient;
  await requestVcRecapErasure(client, 'user-1');
  assert.deepEqual(
    calls.map((call) => call.operation),
    ['erasure', 'revoke'],
  );
  assert.equal((calls[0]?.data as { where: { userId: string } }).where.userId, 'user-1');
  assert.equal(
    (calls[1]?.data as { data: { consentedAt: null } }).data.consentedAt,
    null,
  );
});
