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

    expect(detector.evaluate(message({ content: ' abc ' }), config)).toContainEqual(
      expect.objectContaining({ kind: 'word_exact', ruleIndex: 0 }),
    );
    expect(detector.evaluate(message({ content: 'これは危険です' }), config)).toContainEqual(
      expect.objectContaining({ kind: 'word_contains', ruleIndex: 0 }),
    );
  });

  it('危険なregexを除外し安全なregexだけを評価する', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      automaticMode: 'observe',
      autoRegexPatterns: ['^foo\\d+$', '(a+)+$', '(?=secret)secret', '[invalid'],
    });

    expect(config.autoRegexPatterns).toEqual(['^foo\\d+$']);
    expect(detector.evaluate(message({ content: 'FOO123' }), config)).toContainEqual(
      expect.objectContaining({ kind: 'word_regex', ruleIndex: 0 }),
    );
  });

  it('Discord招待リンクをallowlist付きで検知する', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      automaticMode: 'observe',
      autoInviteFilterEnabled: true,
      autoInviteAllowlist: ['safe-code'],
    });

    expect(extractInviteCodes('https://discord.gg/safe-code と discord.com/invite/BLOCK')).toEqual([
      'safe-code',
      'block',
    ]);
    expect(
      detector.evaluate(
        message({ content: 'https://discord.gg/safe-code https://discord.gg/BLOCK' }),
        config,
      ),
    ).toContainEqual(expect.objectContaining({ kind: 'invite_link', observedCount: 2 }));
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

    expect(
      detector.evaluate(message({ mentionCount: 3, createdAtMs: 1_000 }), config),
    ).toContainEqual(expect.objectContaining({ kind: 'mention_burst', observedCount: 3 }));
    detector.evaluate(message({ content: 'same', createdAtMs: 2_000 }), config);
    const findings = detector.evaluate(message({ content: 'same', createdAtMs: 3_000 }), config);
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'message_burst' }));
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'duplicate_message' }));
  });

  it('Guild・Channel・Role・User除外を適用する', () => {
    const config = normalizeModerationConfig({
      autoExemptChannelIds: ['200'],
      autoExemptRoleIds: ['400'],
      autoExemptUserIds: ['500'],
    });

    expect(isExempt(message(), config)).toBe(true);
    expect(isExempt(message({ channelId: '201', roleIds: ['400'] }), config)).toBe(true);
    expect(isExempt(message({ channelId: '201', userId: '500' }), config)).toBe(true);
    expect(isExempt(message({ channelId: '201', userId: '501', roleIds: [] }), config)).toBe(
      false,
    );
  });

  it('clearGuild後は連投状態を引き継がない', () => {
    const detector = new AutomaticModerationDetector();
    const config = normalizeModerationConfig({
      autoBurstMessageLimit: 2,
      autoBurstWindowSeconds: 10,
    });
    detector.evaluate(message({ createdAtMs: 1_000 }), config);
    detector.clearGuild('100');
    expect(detector.evaluate(message({ createdAtMs: 2_000 }), config)).not.toContainEqual(
      expect.objectContaining({ kind: 'message_burst' }),
    );
  });
});
