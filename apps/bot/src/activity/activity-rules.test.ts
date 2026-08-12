import { describe, expect, it } from 'vitest';
import {
  hasMessageCooldownElapsed,
  normalizeActivityRulesConfig,
  shouldCountMessage,
  shouldCountVoice,
} from './activity-rules.js';

describe('Activity Rules v1', () => {
  it('既存Community Activityと同じ挙動を既定値にする', () => {
    expect(normalizeActivityRulesConfig(undefined)).toEqual({
      excludedTextChannelIds: [],
      excludedVoiceChannelIds: [],
      excludedRoleIds: [],
      messageCooldownSeconds: 0,
      minimumMessageLength: 0,
      countReactionsGiven: true,
      countReactionsReceived: true,
      countSelfMutedVoice: true,
      countServerMutedVoice: true,
      countSelfDeafenedVoice: true,
      countServerDeafenedVoice: true,
    });
  });

  it('IDと数値設定を安全な範囲へ正規化する', () => {
    const config = normalizeActivityRulesConfig({
      excludedTextChannelIds: ['123', '123', 'bad'],
      excludedVoiceChannelIds: ['456', 'bad'],
      excludedRoleIds: ['789', 'bad'],
      messageCooldownSeconds: 999,
      minimumMessageLength: -5,
      countReactionsGiven: false,
      countSelfMutedVoice: false,
    });

    expect(config).toMatchObject({
      excludedTextChannelIds: ['123'],
      excludedVoiceChannelIds: ['456'],
      excludedRoleIds: ['789'],
      messageCooldownSeconds: 300,
      minimumMessageLength: 0,
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

  it('Message Content Intentが無い場合は文字数条件だけをスキップする', () => {
    const config = normalizeActivityRulesConfig({ minimumMessageLength: 50 });
    expect(
      shouldCountMessage(config, {
        channelId: '101',
        roleIds: [],
        contentAvailable: false,
        contentLength: 0,
      }),
    ).toBe(true);
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
