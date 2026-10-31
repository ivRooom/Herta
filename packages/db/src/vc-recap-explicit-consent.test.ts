import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import test from 'node:test';
import {
  evaluateVcRecapExplicitConsent,
  setVcRecapOpenAiAudioConsent,
  isVcRecapLongTermEnrollmentEnabled,
  getVcRecapLongTermConsentView,
  updateVcRecapLongTermConsentChoices,
  VC_RECAP_OPENAI_AUDIO_POLICY_VERSION,
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
        $queryRawUnsafe: async () => [],
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
  assert.equal((calls[1]?.data as { data: { consentedAt: null } }).data.consentedAt, null);
});

test('OpenAI音声送信は旧文字起こし同意と新しい個別同意を両方要求', async () => {
  const writes: Array<unknown> = [];
  let legacy = true;
  let erasure = false;
  const tx = {
    $queryRawUnsafe: async () => [],
    userDataConsent: { findUnique: async () => ({ voiceTranscriptionConsent: legacy }) },
    vcRecapErasureRequest: { findUnique: async () => (erasure ? { userId: 'user-1' } : null) },
    vcRecapExplicitConsent: {
      upsert: async (data: unknown) => {
        writes.push(data);
      },
    },
  };
  const fake = {
    $transaction: async (callback: (client: typeof tx) => Promise<boolean>) => callback(tx),
  } as unknown as PrismaClient;
  legacy = false;
  assert.equal(await setVcRecapOpenAiAudioConsent(fake, 'user-1', true), false);
  assert.equal(writes.length, 0);
  legacy = true;
  erasure = true;
  assert.equal(await setVcRecapOpenAiAudioConsent(fake, 'user-1', true), false);
  assert.equal(writes.length, 0);
  erasure = false;
  assert.equal(await setVcRecapOpenAiAudioConsent(fake, 'user-1', true), true);
  assert.equal(writes.length, 1);
  const grant = writes[0] as {
    create: { purpose: string; policyVersion: string; consentedAt: Date };
  };
  assert.equal(grant.create.purpose, 'openai_audio_processing');
  assert.equal(grant.create.policyVersion, VC_RECAP_OPENAI_AUDIO_POLICY_VERSION);
  assert.ok(grant.create.consentedAt instanceof Date);
  assert.equal(await setVcRecapOpenAiAudioConsent(fake, 'user-1', false), true);
  const revoke = writes[1] as { update: { consentedAt: null; revokedAt: Date } };
  assert.equal(revoke.update.consentedAt, null);
  assert.ok(revoke.update.revokedAt instanceof Date);
});

test('新しい長期同意は公開ポリシー版と運用スイッチの両方が一致する場合だけ受付', () => {
  assert.equal(isVcRecapLongTermEnrollmentEnabled({}), false);
  assert.equal(
    isVcRecapLongTermEnrollmentEnabled({
      VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED: 'true',
      VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION: 'different-version',
    }),
    false,
  );
  assert.equal(
    isVcRecapLongTermEnrollmentEnabled({
      VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED: 'false',
      VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION: VC_RECAP_LONG_TERM_CONSENT_VERSION,
    }),
    false,
  );
  assert.equal(
    isVcRecapLongTermEnrollmentEnabled({
      VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED: 'true',
      VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION: VC_RECAP_LONG_TERM_CONSENT_VERSION,
    }),
    true,
  );
});

test('不正な長期保存組み合わせを拒否し、デフォルトOFFでは同意を付与しない', async () => {
  const fake = {
    $transaction: () => {
      throw new Error('must not write');
    },
  } as unknown as PrismaClient;
  assert.equal(
    await updateVcRecapLongTermConsentChoices(fake, 'u1', {
      transcription: false,
      transcriptLongTerm: true,
      audioLongTerm: false,
    }),
    'invalid',
  );
  const prevEnabled = process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'];
  const prevVersion = process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'];
  try {
    delete process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'];
    delete process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'];
    const writes: unknown[] = [];
    const tx = {
      $queryRawUnsafe: async () => [],
      vcRecapErasureRequest: {
        findUnique: async () => null,
        upsert: async (data: unknown) => {
          writes.push(data);
        },
      },
      userDataConsent: { findUnique: async () => ({ voiceTranscriptionConsent: true }) },
      vcRecapExplicitConsent: {
        findMany: async () => [],
        upsert: async (data: unknown) => {
          writes.push(data);
        },
        updateMany: async (data: unknown) => {
          writes.push(data);
        },
      },
    };
    const client = {
      $transaction: async (fn: (t: typeof tx) => Promise<string>) => fn(tx),
    } as unknown as PrismaClient;
    assert.equal(
      await updateVcRecapLongTermConsentChoices(client, 'u1', {
        transcription: true,
        transcriptLongTerm: true,
        audioLongTerm: true,
      }),
      'enrollment_disabled',
    );
    assert.equal(writes.length, 0);
  } finally {
    if (prevEnabled === undefined) delete process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'];
    else process.env['VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED'] = prevEnabled;
    if (prevVersion === undefined) {
      delete process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'];
    } else {
      process.env['VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION'] = prevVersion;
    }
  }
});

test('目的別同意撤回は受付OFFでも削除障壁を作り、他の長期同意も消す', async () => {
  const calls: string[] = [];
  const tx = {
    $queryRawUnsafe: async () => [],
    vcRecapErasureRequest: {
      findUnique: async () => null,
      upsert: async () => {
        calls.push('fence');
      },
    },
    userDataConsent: { findUnique: async () => ({ voiceTranscriptionConsent: true }) },
    vcRecapExplicitConsent: {
      findMany: async () => [consent('audio_long_term'), consent('transcription')],
      updateMany: async () => {
        calls.push('revoke-all');
      },
      upsert: async () => {
        calls.push('grant');
      },
    },
  };
  const client = {
    $transaction: async (fn: (t: typeof tx) => Promise<string>) => fn(tx),
  } as unknown as PrismaClient;
  assert.equal(
    await updateVcRecapLongTermConsentChoices(client, 'u1', {
      transcription: false,
      transcriptLongTerm: false,
      audioLongTerm: false,
    }),
    'erasure_requested',
  );
  assert.deepEqual(calls, ['fence', 'revoke-all']);
});

test('本人削除障壁があれば新同意の再取得を拒否', async () => {
  const tx = {
    $queryRawUnsafe: async () => [],
    vcRecapErasureRequest: { findUnique: async () => ({ userId: 'u1' }) },
    userDataConsent: { findUnique: async () => ({ voiceTranscriptionConsent: true }) },
    vcRecapExplicitConsent: { findMany: async () => [] },
  };
  const client = {
    $transaction: async (fn: (t: typeof tx) => Promise<string>) => fn(tx),
  } as unknown as PrismaClient;
  assert.equal(
    await updateVcRecapLongTermConsentChoices(client, 'u1', {
      transcription: false,
      transcriptLongTerm: false,
      audioLongTerm: false,
    }),
    'erasure_pending',
  );
});

test('以前のポリシー版で未撤回の同意は、現在版の同意とは別に撤回可能と表示する', async () => {
  const client = {
    vcRecapExplicitConsent: {
      findMany: async () => [consent('audio_long_term', { policyVersion: 'previous-v1' })],
    },
    userDataConsent: {
      findUnique: async () => ({ voiceTranscriptionConsent: true }),
    },
    vcRecapErasureRequest: {
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;
  const view = await getVcRecapLongTermConsentView(client, 'user-1');
  assert.deepEqual(view.choices, {
    transcription: false,
    transcriptLongTerm: false,
    audioLongTerm: false,
  });
  assert.equal(view.hasUnrevokedLongTermGrant, true);
  assert.equal(view.erasurePending, false);
});
