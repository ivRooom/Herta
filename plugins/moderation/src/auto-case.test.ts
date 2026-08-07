import { describe, expect, it } from 'vitest';
import {
  createAutomaticCaseRuleSelector,
  shouldAutoCreateCaseOnConfirmed,
} from './auto-case.js';

describe('Moderation automatic case selector', () => {
  it('word系はdetection kindとrule indexでセレクタを作る', () => {
    expect(
      createAutomaticCaseRuleSelector({ detectionKind: 'word_contains', ruleIndex: 0 }),
    ).toBe('word_contains:0');
    expect(createAutomaticCaseRuleSelector({ detectionKind: 'word_regex', ruleIndex: 12 })).toBe(
      'word_regex:12',
    );
  });

  it('word系でrule indexが無い場合は一致対象にしない', () => {
    expect(
      createAutomaticCaseRuleSelector({ detectionKind: 'word_exact', ruleIndex: null }),
    ).toBeNull();
  });

  it('組み込み検知はdetection kindだけでセレクタを作る', () => {
    expect(createAutomaticCaseRuleSelector({ detectionKind: 'invite_link', ruleIndex: null })).toBe(
      'invite_link',
    );
  });

  it('機能がOFFならルール一致でも自動Case化しない', () => {
    expect(
      shouldAutoCreateCaseOnConfirmed(
        { autoCaseOnConfirmedEnabled: false, autoCaseOnConfirmedRules: ['word_contains:0'] },
        { detectionKind: 'word_contains', ruleIndex: 0 },
      ),
    ).toBe(false);
  });

  it('対象ルールが空なら自動Case化しない', () => {
    expect(
      shouldAutoCreateCaseOnConfirmed(
        { autoCaseOnConfirmedEnabled: true, autoCaseOnConfirmedRules: [] },
        { detectionKind: 'invite_link', ruleIndex: null },
      ),
    ).toBe(false);
  });

  it('wordルールのkindとindexが一致した場合だけ自動Case化する', () => {
    const config = {
      autoCaseOnConfirmedEnabled: true,
      autoCaseOnConfirmedRules: ['word_contains:0', 'word_regex:2'],
    };

    expect(
      shouldAutoCreateCaseOnConfirmed(config, { detectionKind: 'word_contains', ruleIndex: 0 }),
    ).toBe(true);
    expect(
      shouldAutoCreateCaseOnConfirmed(config, { detectionKind: 'word_contains', ruleIndex: 1 }),
    ).toBe(false);
    expect(shouldAutoCreateCaseOnConfirmed(config, { detectionKind: 'word_regex', ruleIndex: 2 })).toBe(
      true,
    );
  });

  it('組み込み検知セレクタが一致した場合に自動Case化する', () => {
    expect(
      shouldAutoCreateCaseOnConfirmed(
        { autoCaseOnConfirmedEnabled: true, autoCaseOnConfirmedRules: ['mention_burst'] },
        { detectionKind: 'mention_burst', ruleIndex: null },
      ),
    ).toBe(true);
  });
});
