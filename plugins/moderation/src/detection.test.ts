import { describe, expect, it } from 'vitest';
import { normalizeModerationConfig } from './config.js';
import {
  AutomaticModerationDetector,
  extractInviteCodes,
  isExempt,
  type AutomaticModerationMessageSnapshot,
} from './detection.js';

function message(
  overrides: Partial<AutomaticModerationMessageSnapshot> = {},
): AutomaticModerationMessageSnapshot {
  return {
    guildId: '100',
    channelId: '200',
    userId: '300',
    roleIds: [],
    content: 'hello',
    mentionCount: 0,
    createdAtMs: 1_000,
    ...overrides,
  };
}

describe('Moderation automatic detection', () => {
  it('既定値では自動検知を無効化する', () => {
    const config = normalizeModerationConfig({});

    expect(config.automaticMode).toBe('disabled');
    expect(config.autoExactWords).toEqual([]);
    expect(config.autoBurstMessageLimit).toBe(0);
  });

  it('Unicode NFKC正規化後にexactとcontainsを検知する', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      automaticMode: 'observe',
      autoExactWords: ['ＡＢＣ'],
      autoContainsWords: ['危険'],
    });

    const exact = detector.evaluate(message({ content: ' abc ' }), config);
    const contains = detector.evaluate(message({ content: 'これは危険です' }), config);

    expect(exact.map((finding) => finding.kind)).toContain('word_exact');
    expect(contains.map((finding) => finding.kind)).toContain('word_contains');
  });

  it('危険なregexを除外し安全なregexだけを評価する', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      automaticMode: 'observe',
      autoRegexPatterns: ['^foo\\d+$', '(a+)+$', '(?=secret)secret', '[invalid'],
    });

    const findings = detector.evaluate(message({ content: 'FOO123' }), config);

    expect(config.autoRegexPatterns).toEqual(['^foo\\d+$']);
    expect(findings.map((finding) => finding.kind)).toContain('word_regex');
  });

  it('Discord招待リンクをallowlist付きで検知する', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      automaticMode: 'observe',
      autoInviteFilterEnabled: true,
      autoInviteAllowlist: ['ok'],
    });

    const codes = extractInviteCodes('discord.gg/ok discord.com/invite/NO');
    const findings = detector.evaluate(message({ content: 'discord.gg/ok discord.gg/NO' }), config);

    expect(codes).toEqual(['ok', 'no']);
    expect(findings.map((finding) => finding.kind)).toContain('invite_link');
  });

  it('大量メンション、連投、重複投稿をsliding windowで検知する', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      automaticMode: 'observe',
      autoMentionLimit: 3,
      autoBurstMessageLimit: 3,
      autoBurstWindowSeconds: 10,
      autoDuplicateMessageLimit: 2,
      autoDuplicateWindowSeconds: 30,
    });

    const mention = detector.evaluate(message({ mentionCount: 3, createdAtMs: 1_000 }), config);
    detector.evaluate(message({ content: 'same', createdAtMs: 2_000 }), config);
    const repeated = detector.evaluate(message({ content: 'same', createdAtMs: 3_000 }), config);

    expect(mention.map((finding) => finding.kind)).toContain('mention_burst');
    expect(repeated.map((finding) => finding.kind)).toContain('message_burst');
    expect(repeated.map((finding) => finding.kind)).toContain('duplicate_message');
  });

  it('連投検知をchannel scopeへ分離できる', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      autoBurstMessageLimit: 2,
      autoBurstWindowSeconds: 10,
      autoBurstScope: 'channel',
    });

    detector.evaluate(message({ channelId: '200', createdAtMs: 1_000 }), config);
    const otherChannel = detector.evaluate(
      message({ channelId: '201', createdAtMs: 2_000 }),
      config,
    );
    const sameChannel = detector.evaluate(
      message({ channelId: '201', createdAtMs: 3_000 }),
      config,
    );

    expect(otherChannel.map((finding) => finding.kind)).not.toContain('message_burst');
    expect(sameChannel.map((finding) => finding.kind)).toContain('message_burst');
  });

  it('重複投稿は最低文字数を満たす本文だけをchannel単位で集計する', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      autoDuplicateMessageLimit: 2,
      autoDuplicateWindowSeconds: 30,
      autoDuplicateScope: 'channel',
      autoDuplicateMinimumLength: 3,
    });

    detector.evaluate(message({ channelId: '200', content: 'ok', createdAtMs: 1_000 }), config);
    const shortRepeated = detector.evaluate(
      message({ channelId: '200', content: 'ok', createdAtMs: 2_000 }),
      config,
    );
    detector.evaluate(message({ channelId: '200', content: 'same', createdAtMs: 3_000 }), config);
    const otherChannel = detector.evaluate(
      message({ channelId: '201', content: 'same', createdAtMs: 4_000 }),
      config,
    );
    const sameChannel = detector.evaluate(
      message({ channelId: '201', content: 'same', createdAtMs: 5_000 }),
      config,
    );

    expect(shortRepeated.map((finding) => finding.kind)).not.toContain('duplicate_message');
    expect(otherChannel.map((finding) => finding.kind)).not.toContain('duplicate_message');
    expect(sameChannel.map((finding) => finding.kind)).toContain('duplicate_message');
  });

  it('Guild・Channel・Role・User除外を適用する', () => {
    const config = normalizeModerationConfig({
      autoExemptChannelIds: ['200'],
      autoExemptRoleIds: ['400'],
      autoExemptUserIds: ['500'],
    });

    const byChannel = isExempt(message(), config);
    const byRole = isExempt(message({ channelId: '201', roleIds: ['400'] }), config);
    const byUser = isExempt(message({ channelId: '201', userId: '500' }), config);
    const active = isExempt(message({ channelId: '201', userId: '501', roleIds: [] }), config);

    expect(byChannel).toBe(true);
    expect(byRole).toBe(true);
    expect(byUser).toBe(true);
    expect(active).toBe(false);
  });

  it('clearGuild後は連投状態を引き継がない', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      autoBurstMessageLimit: 2,
      autoBurstWindowSeconds: 10,
    });

    detector.evaluate(message({ createdAtMs: 1_000 }), config);
    detector.clearGuild('100');
    const findings = detector.evaluate(message({ createdAtMs: 2_000 }), config);

    expect(findings.map((finding) => finding.kind)).not.toContain('message_burst');
  });
});
