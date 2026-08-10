import { describe, expect, it } from 'vitest';
import {
  normalizeOnboardingConfig,
  onboardingPlugin,
  renderOnboardingMessage,
} from './onboarding.js';

describe('Onboarding v1', () => {
  it('Welcome commandと参加・退出eventを定義する', () => {
    expect(onboardingPlugin.manifest.id).toBe('onboarding');
    expect(onboardingPlugin.manifest.commands[0]?.name).toBe('welcome');
    expect(onboardingPlugin.manifest.commands[0]?.subcommands?.map((item) => item.name)).toEqual([
      'preview',
      'test',
    ]);
    expect(onboardingPlugin.manifest.events).toEqual(['guildMemberAdd', 'guildMemberRemove']);
  });

  it('不足設定を安全な既定値で補完する', () => {
    expect(normalizeOnboardingConfig({})).toMatchObject({
      enabled: true,
      welcomeEnabled: true,
      welcomeChannelId: null,
      goodbyeEnabled: true,
      goodbyeChannelId: null,
      autoRoleEnabled: false,
      autoRoleIds: [],
      mentionNewMember: true,
    });
  });

  it('不正IDと重複Roleを除去し最大10件へ制限する', () => {
    const config = normalizeOnboardingConfig({
      welcomeChannelId: 'abc',
      goodbyeChannelId: '123',
      autoRoleIds: ['100', '100', 'bad', ...Array.from({ length: 20 }, (_, index) => String(200 + index))],
    });
    expect(config.welcomeChannelId).toBeNull();
    expect(config.goodbyeChannelId).toBe('123');
    expect(config.autoRoleIds).toHaveLength(10);
    expect(new Set(config.autoRoleIds).size).toBe(config.autoRoleIds.length);
    expect(config.autoRoleIds).not.toContain('bad');
  });

  it('Welcomeテンプレートの予約tokenを展開する', () => {
    expect(
      renderOnboardingMessage('{user} / {username} / {server} / {memberCount}', {
        userId: '123456789',
        username: 'herta-user',
        serverName: 'Herta Guild',
        memberCount: 42,
      }),
    ).toBe('<@123456789> / herta-user / Herta Guild / 42');
  });

  it('未知tokenは保持しメンバー数を0未満にしない', () => {
    expect(
      renderOnboardingMessage('{unknown}:{memberCount}', {
        userId: '1',
        username: 'user',
        serverName: 'Guild',
        memberCount: -5,
      }),
    ).toBe('{unknown}:0');
  });

  it('長すぎるメッセージをDiscord送信用上限へ切り詰める', () => {
    const rendered = renderOnboardingMessage('a'.repeat(2_000), {
      userId: '1',
      username: 'user',
      serverName: 'Guild',
      memberCount: 1,
    });
    expect(rendered).toHaveLength(1_500);
  });
});
