import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateVcRecapExplicitConsent,
  VC_RECAP_LONG_TERM_CONSENT_VERSION,
  type VcRecapExplicitConsentRecord,
} from './vc-recap-explicit-consent.js';

function consent(purpose: string, overrides: Partial<VcRecapExplicitConsentRecord> = {}): VcRecapExplicitConsentRecord {
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
  assert.equal(evaluateVcRecapExplicitConsent([consent('audio_long_term')], false).canRecordAudioLongTerm, true);
  assert.equal(evaluateVcRecapExplicitConsent([consent('audio_long_term')], true).canRecordAudioLongTerm, false);
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
    evaluateVcRecapExplicitConsent(
      [consent('audio_long_term', { revokedAt: new Date() })],
      false,
    ).canRecordAudioLongTerm,
    false,
  );
});
