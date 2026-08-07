import { describe, expect, it } from 'vitest';
import {
  buildAutomaticAlertEmbed,
  buildAutomaticWarningEmbed,
  buildModerationCaseEmbed,
  buildModerationHistoryEmbed,
  buildModerationStatusEmbed,
  moderationVisualImageUrl,
} from './discord-ui.js';

const baseCase = {
  id: 'case-id',
  guildId: '123456789012345678',
  caseNumber: 42,
  action: 'timeout' as const,
  status: 'active' as const,
  targetUserId: '111111111111111111',
  moderatorUserId: '222222222222222222',
  reason: 'テスト理由',
  durationSeconds: 600,
  expiresAt: new Date('2026-08-07T12:10:00.000Z'),
  source: 'discord' as const,
  originDetectionId: null,
  discordActionId: null,
  createdAt: new Date('2026-08-07T12:00:00.000Z'),
  updatedAt: new Date('2026-08-07T12:00:00.000Z'),
};

describe('Discord visual UI', () => {
  it('危険度に応じた生成画像URLを持つAlert Embedを返す', () => {
    const embed = buildAutomaticAlertEmbed({
      severity: 'critical',
      action: 'ban',
      targetUserId: '111111111111111111',
      channelId: '333333333333333333',
      matchedSelectors: ['word_contains:0'],
      jumpUrl: 'https://discord.com/channels/1/2/3',
      createdTimestamp: Date.parse('2026-08-07T12:00:00.000Z'),
      excerpt: '危険なメッセージ',
    });

    expect(embed.color).toBe(0xec425b);
    expect(embed.image?.url).toBe('https://herta.ivrm.jp/api/discord-assets/moderation/critical');
    expect(embed.fields?.some((field) => field.value.includes('CRITICAL'))).toBe(true);
    expect(embed.url).toBe('https://discord.com/channels/1/2/3');
  });

  it('失敗Alertはfailed画像へ切り替える', () => {
    const embed = buildAutomaticAlertEmbed({
      severity: 'high',
      action: 'timeout',
      targetUserId: '111111111111111111',
      channelId: '333333333333333333',
      matchedSelectors: ['word_regex:1'],
      jumpUrl: 'https://discord.com/channels/1/2/3',
      createdTimestamp: Date.now(),
      failure: true,
      errorMessage: 'Missing Permissions',
    });

    expect(embed.image?.url).toContain('/failed');
    expect(embed.title).toContain('失敗');
  });

  it('警告DMに内部selectorを露出しない', () => {
    const embed = buildAutomaticWarningEmbed(
      {
        selector: 'word_contains:0',
        severity: 'high',
        action: 'warn',
        timeoutMinutes: 10,
        roleId: null,
        warningMessage: null,
        banDeleteMessageSeconds: 0,
      },
      'サーバールールに抵触する可能性があります。',
    );

    expect(JSON.stringify(embed)).not.toContain('word_contains:0');
    expect(embed.image?.url).toContain('/warning');
  });

  it('Caseと履歴にCase画像と主要情報を持たせる', () => {
    const caseEmbed = buildModerationCaseEmbed(baseCase);
    const historyEmbed = buildModerationHistoryEmbed({
      targetUserId: baseCase.targetUserId,
      items: [baseCase],
      page: 1,
      totalPages: 1,
    });

    expect(caseEmbed.image?.url).toContain('/case');
    expect(JSON.stringify(caseEmbed)).toContain('#42');
    expect(historyEmbed.image?.url).toContain('/case');
    expect(historyEmbed.description).toContain('#42');
  });

  it('Status Embedのfield数と文字数をDiscord制約内へ正規化する', () => {
    const embed = buildModerationStatusEmbed({
      title: 'status',
      description: 'test',
      variant: 'info',
      fields: Array.from({ length: 30 }, (_, index) => ({
        name: `${index}-${'n'.repeat(300)}`,
        value: 'v'.repeat(1200),
        inline: index % 2 === 0,
      })),
    });

    expect(embed.fields).toHaveLength(25);
    expect(embed.fields?.every((field) => field.name.length <= 256)).toBe(true);
    expect(embed.fields?.every((field) => field.value.length <= 1024)).toBe(true);
  });

  it('公開Base URLを末尾slashなしで生成する', () => {
    const previous = process.env.HERTA_PUBLIC_BASE_URL;
    try {
      delete process.env.HERTA_PUBLIC_BASE_URL;
      expect(moderationVisualImageUrl('info')).toBe(
        'https://herta.ivrm.jp/api/discord-assets/moderation/info',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.HERTA_PUBLIC_BASE_URL;
      } else {
        process.env.HERTA_PUBLIC_BASE_URL = previous;
      }
    }
  });

  it('公開Base URLを指定した場合は末尾slashを除去して利用する', () => {
    const previous = process.env.HERTA_PUBLIC_BASE_URL;
    try {
      process.env.HERTA_PUBLIC_BASE_URL = 'https://visual.herta.example///';
      expect(moderationVisualImageUrl('critical')).toBe(
        'https://visual.herta.example/api/discord-assets/moderation/critical',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.HERTA_PUBLIC_BASE_URL;
      } else {
        process.env.HERTA_PUBLIC_BASE_URL = previous;
      }
    }
  });
});
