import { describe, expect, it } from 'vitest';
import {
  communityPointsRatesFromConfig,
  evaluateMessageActivity,
  hasMessageCooldownElapsed,
  normalizeActivityRulesConfig,
  shouldCountCommandPoints,
  shouldCountGamePresence,
  shouldCountLfgPoints,
  shouldCountMessage,
  shouldCountOnlinePresence,
  shouldCountPollPoints,
  shouldCountTeamSplitPoints,
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
      countOnlinePresence: true,
      countGamePresence: true,
      countCommandPoints: true,
      messagePointsPerMessage: 2,
      reactionPointsPerReaction: 1,
      voicePointsPer10Minutes: 1,
      onlinePointsPerHour: 1,
      onlinePointsDailyCap: 2,
      gamePointsPerHour: 1,
      gamePointsDailyCap: 2,
      achievementPoints: 5,
      commandPointsPerUse: 1,
      commandPointsDailyCap: 10,
      countLfgPoints: true,
      lfgPointsPerJoin: 3,
      lfgPointsDailyCap: 15,
      countTeamSplitPoints: true,
      teamSplitPointsPerJoin: 3,
      teamSplitPointsDailyCap: 15,
      countPollPoints: true,
      pollPointsPerVote: 1,
      pollPointsDailyCap: 10,
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

  it('プレゼンス集計は設定OFFまたは除外Roleで無効化できる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(shouldCountOnlinePresence(defaultConfig, {})).toBe(true);
    expect(shouldCountGamePresence(defaultConfig, {})).toBe(true);

    const disabledConfig = normalizeActivityRulesConfig({
      countOnlinePresence: false,
      countGamePresence: false,
    });
    expect(shouldCountOnlinePresence(disabledConfig, {})).toBe(false);
    expect(shouldCountGamePresence(disabledConfig, {})).toBe(false);

    const excludedRoleConfig = normalizeActivityRulesConfig({ excludedRoleIds: ['400'] });
    expect(shouldCountOnlinePresence(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountGamePresence(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountOnlinePresence(excludedRoleConfig, { roleIds: ['999'] })).toBe(true);
  });

  it('コマンド使用ポイントは設定OFFまたは除外Roleで無効化できる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(shouldCountCommandPoints(defaultConfig, {})).toBe(true);

    const disabledConfig = normalizeActivityRulesConfig({ countCommandPoints: false });
    expect(shouldCountCommandPoints(disabledConfig, {})).toBe(false);

    const excludedRoleConfig = normalizeActivityRulesConfig({ excludedRoleIds: ['400'] });
    expect(shouldCountCommandPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountCommandPoints(excludedRoleConfig, { roleIds: ['999'] })).toBe(true);
  });

  it('オンライン・ゲームは既定で低単価+1日上限、OFF時は単価0になる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(communityPointsRatesFromConfig(defaultConfig)).toEqual({
      messagePointsPerMessage: 2,
      reactionPointsPerReaction: 1,
      voicePointsPer10Minutes: 1,
      onlinePointsPerHour: 1,
      onlinePointsDailyCap: 2,
      gamePointsPerHour: 1,
      gamePointsDailyCap: 2,
      achievementPoints: 5,
      commandPointsPerUse: 1,
      commandPointsDailyCap: 10,
      lfgPointsPerJoin: 3,
      lfgPointsDailyCap: 15,
      teamSplitPointsPerJoin: 3,
      teamSplitPointsDailyCap: 15,
      pollPointsPerVote: 1,
      pollPointsDailyCap: 10,
    });

    const disabledConfig = normalizeActivityRulesConfig({
      countOnlinePresence: false,
      countGamePresence: false,
      countCommandPoints: false,
      countLfgPoints: false,
      countTeamSplitPoints: false,
      countPollPoints: false,
    });
    const disabledRates = communityPointsRatesFromConfig(disabledConfig);
    expect(disabledRates.onlinePointsPerHour).toBe(0);
    expect(disabledRates.gamePointsPerHour).toBe(0);
    expect(disabledRates.commandPointsPerUse).toBe(0);
    expect(disabledRates.lfgPointsPerJoin).toBe(0);
    expect(disabledRates.teamSplitPointsPerJoin).toBe(0);
    expect(disabledRates.pollPointsPerVote).toBe(0);
  });

  it('LFG・Team Split・Poll参加ポイントは設定OFFまたは除外Roleで無効化できる', () => {
    const defaultConfig = normalizeActivityRulesConfig(undefined);
    expect(shouldCountLfgPoints(defaultConfig, {})).toBe(true);
    expect(shouldCountTeamSplitPoints(defaultConfig, {})).toBe(true);
    expect(shouldCountPollPoints(defaultConfig, {})).toBe(true);

    const disabledConfig = normalizeActivityRulesConfig({
      countLfgPoints: false,
      countTeamSplitPoints: false,
      countPollPoints: false,
    });
    expect(shouldCountLfgPoints(disabledConfig, {})).toBe(false);
    expect(shouldCountTeamSplitPoints(disabledConfig, {})).toBe(false);
    expect(shouldCountPollPoints(disabledConfig, {})).toBe(false);

    const excludedRoleConfig = normalizeActivityRulesConfig({ excludedRoleIds: ['400'] });
    expect(shouldCountLfgPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountTeamSplitPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountPollPoints(excludedRoleConfig, { roleIds: ['400'] })).toBe(false);
    expect(shouldCountLfgPoints(excludedRoleConfig, { roleIds: ['999'] })).toBe(true);
  });
});
