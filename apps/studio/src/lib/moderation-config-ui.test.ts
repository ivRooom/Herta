import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MODERATION_CONFIG_DRAFT,
  appendCustomRule,
  customRuleSelector,
  getEnforcementPolicy,
  removeCustomRule,
  setAutoCaseRule,
  setBuiltInRuleEnabled,
  setEnforcementPolicy,
  toModerationConfigDraft,
  updateCustomRule,
} from './moderation-config-ui.ts';

test('不足設定を既定値で補完する', () => {
  const config = toModerationConfigDraft({ automaticMode: 'observe', autoContainsWords: ['test'] });
  assert.equal(config.automaticMode, 'observe');
  assert.deepEqual(config.autoContainsWords, ['test']);
  assert.equal(config.requireReason, true);
  assert.equal(config.autoEnforcementEnabled, false);
  assert.equal(config.autoAlertMinimumSeverity, 'high');
  assert.equal(config.autoCaseOnConfirmedEnabled, false);
  assert.equal(config.autoMaxMessageLength, 2000);
});

test('既存JSONの基本設定をGUI読込時に保持する', () => {
  const config = toModerationConfigDraft({
    requireReason: false,
    dmTarget: false,
    logChannelId: '444444444444444444',
    defaultResponseEphemeral: false,
    maxReasonLength: 750,
    caseRetentionDays: 730,
    allowedModeratorRoleIds: ['555555555555555555'],
    automaticMode: 'observe',
    autoMaxMessageLength: 3500,
  });

  assert.equal(config.requireReason, false);
  assert.equal(config.dmTarget, false);
  assert.equal(config.logChannelId, '444444444444444444');
  assert.equal(config.defaultResponseEphemeral, false);
  assert.equal(config.maxReasonLength, 750);
  assert.equal(config.caseRetentionDays, 730);
  assert.deepEqual(config.allowedModeratorRoleIds, ['555555555555555555']);
  assert.equal(config.automaticMode, 'observe');
  assert.equal(config.autoMaxMessageLength, 3500);
});

test('既存JSONの自動Case・built-in・除外設定をGUI読込時に保持する', () => {
  const config = toModerationConfigDraft({
    automaticMode: 'observe',
    autoCaseOnConfirmedEnabled: true,
    autoCaseOnConfirmedRules: ['word_contains:0', 'invite_link', 'message_burst'],
    autoContainsWords: ['herta-auto-case-e2e-20260807'],
    autoInviteFilterEnabled: true,
    autoInviteAllowlist: ['trusted-code'],
    autoMentionLimit: 7,
    autoBurstMessageLimit: 6,
    autoBurstWindowSeconds: 12,
    autoDuplicateMessageLimit: 4,
    autoDuplicateWindowSeconds: 45,
    autoExemptChannelIds: ['111111111111111111'],
    autoExemptRoleIds: ['222222222222222222'],
    autoExemptUserIds: ['333333333333333333'],
  });

  assert.equal(config.autoCaseOnConfirmedEnabled, true);
  assert.deepEqual(config.autoCaseOnConfirmedRules, [
    'word_contains:0',
    'invite_link',
    'message_burst',
  ]);
  assert.deepEqual(config.autoContainsWords, ['herta-auto-case-e2e-20260807']);
  assert.equal(config.autoInviteFilterEnabled, true);
  assert.deepEqual(config.autoInviteAllowlist, ['trusted-code']);
  assert.equal(config.autoMentionLimit, 7);
  assert.equal(config.autoBurstMessageLimit, 6);
  assert.equal(config.autoBurstWindowSeconds, 12);
  assert.equal(config.autoDuplicateMessageLimit, 4);
  assert.equal(config.autoDuplicateWindowSeconds, 45);
  assert.deepEqual(config.autoExemptChannelIds, ['111111111111111111']);
  assert.deepEqual(config.autoExemptRoleIds, ['222222222222222222']);
  assert.deepEqual(config.autoExemptUserIds, ['333333333333333333']);
});

test('自動対応・緊急Alert設定をGUI読込時に保持する', () => {
  const config = toModerationConfigDraft({
    autoEnforcementEnabled: true,
    autoEnforcementPolicies: [
      {
        selector: 'word_contains:0',
        action: 'timeout',
        severity: 'critical',
        timeoutMinutes: 30,
        roleId: null,
        warningMessage: null,
        banDeleteMessageSeconds: 0,
      },
    ],
    autoAlertChannelId: '999999999999999999',
    autoAlertMinimumSeverity: 'high',
    autoAlertMentionRoleIds: ['888888888888888888'],
    autoAlertIncludeExcerpt: true,
    autoAlertCooldownSeconds: 90,
  });

  assert.equal(config.autoEnforcementEnabled, true);
  assert.equal(getEnforcementPolicy(config, 'word_contains:0').action, 'timeout');
  assert.equal(getEnforcementPolicy(config, 'word_contains:0').severity, 'critical');
  assert.equal(config.autoAlertChannelId, '999999999999999999');
  assert.deepEqual(config.autoAlertMentionRoleIds, ['888888888888888888']);
  assert.equal(config.autoAlertIncludeExcerpt, true);
  assert.equal(config.autoAlertCooldownSeconds, 90);
});

test('カスタムルールを追加・編集できる', () => {
  const added = appendCustomRule(DEFAULT_MODERATION_CONFIG_DRAFT, 'word_contains', 'foo');
  assert.deepEqual(added.autoContainsWords, ['foo']);

  const updated = updateCustomRule(added, 'word_contains', 0, 'bar');
  assert.deepEqual(updated.autoContainsWords, ['bar']);
});

test('カスタムルール削除時に自動Case selectorのindexを詰め直す', () => {
  const config = {
    ...DEFAULT_MODERATION_CONFIG_DRAFT,
    autoContainsWords: ['a', 'b', 'c'],
    autoCaseOnConfirmedRules: [
      'word_contains:0',
      'word_contains:1',
      'word_contains:2',
      'invite_link',
    ],
  };

  const removed = removeCustomRule(config, 'word_contains', 1);
  assert.deepEqual(removed.autoContainsWords, ['a', 'c']);
  assert.deepEqual(removed.autoCaseOnConfirmedRules, [
    'word_contains:0',
    'word_contains:1',
    'invite_link',
  ]);
});

test('カスタムルール削除時に自動対応Policyも削除・再採番する', () => {
  let config = {
    ...DEFAULT_MODERATION_CONFIG_DRAFT,
    autoContainsWords: ['a', 'b', 'c'],
  };
  config = setEnforcementPolicy(config, 'word_contains:0', {
    action: 'warn',
    severity: 'medium',
  });
  config = setEnforcementPolicy(config, 'word_contains:1', {
    action: 'ban',
    severity: 'critical',
  });
  config = setEnforcementPolicy(config, 'word_contains:2', {
    action: 'timeout',
    severity: 'high',
  });

  const removed = removeCustomRule(config, 'word_contains', 1);
  assert.deepEqual(removed.autoContainsWords, ['a', 'c']);
  assert.equal(getEnforcementPolicy(removed, 'word_contains:0').action, 'warn');
  assert.equal(getEnforcementPolicy(removed, 'word_contains:1').action, 'timeout');
  assert.equal(
    removed.autoEnforcementPolicies.some((policy) => policy.action === 'ban'),
    false,
  );
});

test('自動Case selectorを重複なく追加・削除する', () => {
  const selector = customRuleSelector('word_regex', 2);
  const enabled = setAutoCaseRule(DEFAULT_MODERATION_CONFIG_DRAFT, selector, true);
  const enabledAgain = setAutoCaseRule(enabled, selector, true);
  assert.deepEqual(enabledAgain.autoCaseOnConfirmedRules, [selector]);

  const disabled = setAutoCaseRule(enabledAgain, selector, false);
  assert.deepEqual(disabled.autoCaseOnConfirmedRules, []);
});

test('built-in ruleを無効化すると自動Case selectorも解除する', () => {
  const config = {
    ...DEFAULT_MODERATION_CONFIG_DRAFT,
    autoInviteFilterEnabled: true,
    autoCaseOnConfirmedRules: ['invite_link'],
  };

  const disabled = setBuiltInRuleEnabled(config, 'invite_link', false);
  assert.equal(disabled.autoInviteFilterEnabled, false);
  assert.deepEqual(disabled.autoCaseOnConfirmedRules, []);
});

test('built-in ruleを有効化すると安全な初期閾値を設定する', () => {
  const mention = setBuiltInRuleEnabled(DEFAULT_MODERATION_CONFIG_DRAFT, 'mention_burst', true);
  const burst = setBuiltInRuleEnabled(DEFAULT_MODERATION_CONFIG_DRAFT, 'message_burst', true);
  const duplicate = setBuiltInRuleEnabled(
    DEFAULT_MODERATION_CONFIG_DRAFT,
    'duplicate_message',
    true,
  );

  assert.equal(mention.autoMentionLimit, 5);
  assert.equal(burst.autoBurstMessageLimit, 5);
  assert.equal(duplicate.autoDuplicateMessageLimit, 3);
});
