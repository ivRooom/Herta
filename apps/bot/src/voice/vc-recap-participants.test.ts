import { describe, expect, it } from 'vitest';
import { splitVcRecapParticipants } from './vc-recap-participants.js';

describe('splitVcRecapParticipants', () => {
  it('同意済み(true)のユーザーだけをconsentingへ振り分ける', () => {
    const result = splitVcRecapParticipants(
      ['u1', 'u2', 'u3'],
      new Map([
        ['u1', true],
        ['u2', false],
      ]),
    );
    expect(result.consentingUserIds).toEqual(['u1']);
    expect(result.nonConsentingUserIds).toEqual(['u2', 'u3']);
  });

  it('同意レコードが存在しないユーザーはnonConsentingへ振り分ける(既定は不同意)', () => {
    const result = splitVcRecapParticipants(['u1'], new Map());
    expect(result.consentingUserIds).toEqual([]);
    expect(result.nonConsentingUserIds).toEqual(['u1']);
  });

  it('全員が同意している場合nonConsentingUserIdsは空になる', () => {
    const result = splitVcRecapParticipants(
      ['u1', 'u2'],
      new Map([
        ['u1', true],
        ['u2', true],
      ]),
    );
    expect(result.consentingUserIds).toEqual(['u1', 'u2']);
    expect(result.nonConsentingUserIds).toEqual([]);
  });
});
