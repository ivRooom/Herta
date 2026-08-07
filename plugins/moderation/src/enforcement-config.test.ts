import { describe, expect, it } from 'vitest';
import {
  isSeverityAtLeast,
  normalizeModerationEnforcementConfig,
  resolveAutomaticEnforcementPolicy,
} from './enforcement-config.js';

describe('Moderation enforcement config', () => {
  it('未設定では自動対応OFF・高以上通知になる', () => {
    expect(normalizeModerationEnforcementConfig({})).toMatchObject({
      autoEnforcementEnabled: false,
      autoEnforcementPolicies: [],
      autoAlertChannelId: null,
      autoAlertMinimumSeverity: 'high',
      autoAlertMentionRoleIds: [],
      autoAlertIncludeExcerpt: false,
      autoAlertCooldownSeconds: 60,
    });
  });

  it('有効なルールポリシーを正規化する', () => {
    const config = normalizeModerationEnforcementConfig({
      autoEnforcementEnabled: true,
      autoEnforcementPolicies: [
        {
          selector: 'word_contains:0',
          action: 'timeout',
          severity: 'critical',
          timeoutMinutes: 45,
          roleId: '123456789',
          warningMessage: '違反メッセージを検知しました',
          banDeleteMessageSeconds: 120,
        },
      ],
      autoAlertChannelId: '999999999',
      autoAlertMinimumSeverity: 'medium',
      autoAlertMentionRoleIds: ['111111111', '111111111', 'invalid'],
      autoAlertIncludeExcerpt: true,
      autoAlertCooldownSeconds: 30,
    });

    expect(config.autoEnforcementPolicies).toEqual([
      {
        selector: 'word_contains:0',
        action: 'timeout',
        severity: 'critical',
        timeoutMinutes: 45,
        roleId: '123456789',
        warningMessage: '違反メッセージを検知しました',
        banDeleteMessageSeconds: 120,
      },
    ]);
    expect(config.autoAlertChannelId).toBe('999999999');
    expect(config.autoAlertMentionRoleIds).toEqual(['111111111']);
  });

  it('不正なselectorを捨て、不正Actionは検知のみにする', () => {
    const config = normalizeModerationEnforcementConfig({
      autoEnforcementPolicies: [
        { selector: 'unknown', action: 'ban' },
        { selector: 'invite_link', action: 'destroy', severity: 'critical' },
      ],
    });

    expect(config.autoEnforcementPolicies).toHaveLength(1);
    expect(config.autoEnforcementPolicies[0]).toMatchObject({
      selector: 'invite_link',
      action: 'observe',
      severity: 'critical',
    });
  });

  it('findingからword系selectorを解決する', () => {
    const config = normalizeModerationEnforcementConfig({
      autoEnforcementPolicies: [
        { selector: 'word_regex:2', action: 'ban', severity: 'critical' },
      ],
    });

    expect(
      resolveAutomaticEnforcementPolicy(config.autoEnforcementPolicies, {
        kind: 'word_regex',
        ruleIndex: 2,
      }),
    ).toMatchObject({ selector: 'word_regex:2', action: 'ban', severity: 'critical' });
  });

  it('未設定findingはlow/observeへフォールバックする', () => {
    const policy = resolveAutomaticEnforcementPolicy([], {
      kind: 'mention_burst',
    });
    expect(policy).toMatchObject({ selector: 'mention_burst', action: 'observe', severity: 'low' });
  });

  it('危険度の閾値を順序どおり判定する', () => {
    expect(isSeverityAtLeast('critical', 'high')).toBe(true);
    expect(isSeverityAtLeast('high', 'high')).toBe(true);
    expect(isSeverityAtLeast('medium', 'high')).toBe(false);
    expect(isSeverityAtLeast('low', 'medium')).toBe(false);
  });
});
