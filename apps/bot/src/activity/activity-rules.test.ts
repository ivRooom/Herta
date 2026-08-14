import { describe, expect, it } from 'vitest';
import {
  evaluateMessageActivity,
  hasMessageCooldownElapsed,
  normalizeActivityRulesConfig,
  shouldCountMessage,
  shouldCountVoice,
} from './activity-rules.js';

describe('Activity Rules v1.3', () => {
  it('既存Community ActivityとXPの挙動を既定値で維持する', () => {
    expect(normalizeActivityRulesConfig(undefined)).toEqual({
      excludedTextChannelIds: [],
      excludedVoiceChannelIds: [],
      excludedRoleIds: [],
      messageCooldownSeconds: 0,
      minimumMessageLength: 0,
      excludeCommandMessages: false,
      commandPrefixes: ['/', '!'],
      applyMessageRulesToXp: false,
      countReactionsGiven: true,
      countReactionsReceived: true,
      countSelfMutedVoice: true,
      countServerMutedVoice: true,
      countSelfDeafenedVoice: true,
      countServerDeafenedVoice: true,
    });
  });

  it('ID・数値・コマンドprefix・XP適用設定を安全な範囲へ正規化する', () => {
    const config = normalizeActivityRulesConfig({
      excludedTextChannelIds: ['123', '123', 'bad'],
      excludedVoiceChannelIds: ['456', 'bad'],
      excludedRoleIds: ['789', 'bad'],
      messageCooldownSeconds: 999,
      minimumMessageLength: -5,
      excludeCommandMessages: true,
      commandPrefixes: ['!', ' ! ', '?', 'too-long', 'has space'],
      applyMessageRulesToXp: true,
      countReactionsGiven: false,
      countSelfMutedVoice: false,
    });

    expect(config).toMatchObject({
      excludedTextChannelIds: ['123'],
      excludedVoiceChannelIds: ['456'],
      excludedRoleIds: ['789'],
      messageCooldownSeconds: 300,
      minimumMessageLength: 0,
      excludeCommandMessages: true,
      commandPrefixes: ['!', '?'],
      applyMessageRulesToXp: true,
      countReactionsGiven: false,
      countSelfMutedVoice: false,
    });
  });

  it('除外チャンネル・Role・文字数で発言集計を制御する', () => {
    const config = normalizeActivityRulesConfig({
      excludedTextChannelIds: ['100'],
      excludedRoleIds: ['200'],
      minimumMessageLength: 5,
    });

    expect(
      shouldCountMessage(config, {
        channelId: '100',
        roleIds: [],
        contentAvailable: true,
        contentLength: 20,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        roleIds: ['200'],
        contentAvailable: true,
        contentLength: 20,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        roleIds: [],
        contentAvailable: true,
        contentLength: 4,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        roleIds: [],
        contentAvailable: true,
        contentLength: 5,
      }),
    ).toBe(true);
  });

  it('設定したprefixのコマンド形式メッセージを発言数から除外する', () => {
    const config = normalizeActivityRulesConfig({
      excludeCommandMessages: true,
      commandPrefixes: ['/', '!', '?'],
    });

    expect(
      shouldCountMessage(config, {
        channelId: '101',
        contentAvailable: true,
        content: '/rank',
        contentLength: 5,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        contentAvailable: true,
        content: '   !help',
        contentLength: 8,
      }),
    ).toBe(false);
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        contentAvailable: true,
        content: 'これは!通常メッセージ',
        contentLength: 11,
      }),
    ).toBe(true);
  });

  it('診断用評価は除外理由と一致prefixを返す', () => {
    const config = normalizeActivityRulesConfig({
      excludeCommandMessages: true,
      commandPrefixes: ['!', '?'],
    });
    expect(
      evaluateMessageActivity(config, {
        channelId: '101',
        contentAvailable: true,
        content: '  !help',
      }),
    ).toEqual({
      counted: false,
      blockingReason: 'command_prefix',
      matchedCommandPrefix: '!',
      notices: [],
    });
  });

  it('Message Content Intentが無い場合は本文依存条件だけをスキップして理由を返す', () => {
    const config = normalizeActivityRulesConfig({
      minimumMessageLength: 50,
      excludeCommandMessages: true,
      commandPrefixes: ['!'],
    });
    const evaluation = evaluateMessageActivity(config, {
      channelId: '101',
      roleIds: [],
      contentAvailable: false,
      content: '!help',
      contentLength: 0,
    });

    expect(evaluation.counted).toBe(true);
    expect(evaluation.notices).toEqual([
      'command_check_skipped_without_content',
      'length_check_skipped_without_content',
    ]);
  });

  it('Cooldownの経過を判定する', () => {
    const config = normalizeActivityRulesConfig({ messageCooldownSeconds: 10 });
    expect(hasMessageCooldownElapsed(config, undefined, 20_000)).toBe(true);
    expect(hasMessageCooldownElapsed(config, 15_000, 20_000)).toBe(false);
    expect(hasMessageCooldownElapsed(config, 10_000, 20_000)).toBe(true);
  });

  it('VC除外・Role・mute/deaf条件を適用する', () => {
    const config = normalizeActivityRulesConfig({
      excludedVoiceChannelIds: ['300'],
      excludedRoleIds: ['400'],
      countSelfMutedVoice: false,
      countServerMutedVoice: false,
      countSelfDeafenedVoice: false,
      countServerDeafenedVoice: false,
    });

    expect(shouldCountVoice(config, { channelId: null })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '300' })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', roleIds: ['400'] })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', selfMute: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', serverMute: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', selfDeaf: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301', serverDeaf: true })).toBe(false);
    expect(shouldCountVoice(config, { channelId: '301' })).toBe(true);
  });
});
