import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MODERATION_CONFIG_DRAFT,
  appendCustomRule,
  customRuleSelector,
  removeCustomRule,
  setAutoCaseRule,
  setBuiltInRuleEnabled,
  toModerationConfigDraft,
  updateCustomRule,
} from './moderation-config-ui.ts';

test('不足設定を既定値で補完する', () => {
  const config = toModerationConfigDraft({ automaticMode: 'observe', autoContainsWords: ['test'] });
  assert.equal(config.automaticMode, 'observe');
  assert.deepEqual(config.autoContainsWords, ['test']);
  assert.equal(config.requireReason, true);
  assert.equal(config.autoCaseOnConfirmedEnabled, false);
  assert.equal(config.autoMaxMessageLength, 2000);
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
