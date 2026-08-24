import { describe, expect, it } from 'vitest';
import {
  buildSuggestionMessage,
  canViewSuggestion,
  formatSuggestionInfo,
  formatSuggestionListPages,
  normalizeSuggestionConfig,
  suggestionPlugin,
} from './suggestion.js';
import type { SuggestionListRecord, SuggestionSnapshot } from './suggestion-repository.js';

describe('Suggestion v1', () => {
  it('Studio設定を安全な範囲へ正規化する', () => {
    expect(normalizeSuggestionConfig(undefined)).toEqual({
      enabled: true,
      suggestionChannelId: null,
      anonymousSubmissions: false,
      enableVoting: true,
      maxOpenPerUser: 5,
      staffRoleIds: [],
      notifyAuthorOnStatusChange: true,
    });
    expect(
      normalizeSuggestionConfig({
        suggestionChannelId: '123',
        maxOpenPerUser: 99,
        staffRoleIds: ['1', '1', 'x', '2'],
      }),
    ).toMatchObject({
      suggestionChannelId: '123',
      maxOpenPerUser: 20,
      staffRoleIds: ['1', '2'],
    });
  });

  it('公開投稿では投稿者mentionと投票Buttonを表示する', () => {
    const message = buildSuggestionMessage(makeSnapshot());
    expect(message.content).toContain('<@456>');
    expect(message.content).toContain('👍 3 · 👎 1');
    expect(message.components).toHaveLength(1);
    expect(message.allowedMentions.users).toEqual(['456']);
  });

  it('匿名投稿では投稿者IDを公開しない', () => {
    const message = buildSuggestionMessage(makeSnapshot({ anonymous: true }));
    expect(message.content).not.toContain('<@456>');
    expect(message.content).toContain('投稿者: 匿名');
    expect(message.allowedMentions.users).toBeUndefined();
  });

  it('投票無効時はButtonを出さない', () => {
    const message = buildSuggestionMessage(makeSnapshot({ votingEnabled: false }));
    expect(message.components).toHaveLength(0);
    expect(message.content).toContain('投票: 無効');
  });

  it('Staffコメントと状態を表示する', () => {
    const message = buildSuggestionMessage(
      makeSnapshot({ status: 'accepted', staffNote: '次回リリースで対応します' }),
    );
    expect(message.content).toContain('✅ 採用');
    expect(message.content).toContain('Staff: 次回リリースで対応します');
  });

  it('一覧をDiscord文字数上限以下へ分割する', () => {
    const records: SuggestionListRecord[] = Array.from({ length: 25 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      content: `要望 ${index + 1} ${'x'.repeat(120)}`,
      status: 'pending',
      createdAt: new Date('2026-08-11T05:00:00.000Z'),
    }));
    const pages = formatSuggestionListPages(records);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1900)).toBe(true);
    for (const record of records) expect(pages.join('\n')).toContain(record.id);
  });

  it('info subcommandをPlugin command定義へ公開する', () => {
    const info = suggestionPlugin.manifest.commands[0]?.subcommands?.find(
      (subcommand) => subcommand.name === 'info',
    );
    expect(info).toMatchObject({
      name: 'info',
      options: [{ name: 'id', type: 'string', required: true }],
    });
  });

  it('詳細表示は投稿者本人またはStaffだけに許可する', () => {
    const snapshot = makeSnapshot();
    expect(canViewSuggestion(snapshot, { userId: '456', canManage: false })).toBe(true);
    expect(canViewSuggestion(snapshot, { userId: '999', canManage: true })).toBe(true);
    expect(canViewSuggestion(snapshot, { userId: '999', canManage: false })).toBe(false);
  });

  it('匿名Suggestionの詳細で投稿者IDを漏らさない', () => {
    const output = formatSuggestionInfo(
      makeSnapshot({
        anonymous: true,
        staffNote: 'Staffだけの識別情報は含めない',
        content: 'x'.repeat(1000),
      }),
      '999',
    );
    expect(output).toContain('投稿者: 匿名');
    expect(output).toContain('Staff: Staffだけの識別情報は含めない');
    expect(output).not.toContain('<@456>');
    expect(output).not.toContain('投稿者: 456');
    expect(output.length).toBeLessThanOrEqual(1900);
  });

  it('投稿者本人の詳細では本人だと分かる表示にする', () => {
    const output = formatSuggestionInfo(makeSnapshot(), '456');
    expect(output).toContain('投稿者: あなた');
    expect(output).toContain('ID: `11111111-1111-4111-8111-111111111111`');
    expect(output).toContain('作成: <t:');
  });
});

function makeSnapshot(overrides: Partial<SuggestionSnapshot> = {}): SuggestionSnapshot {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    guildId: '123',
    authorId: '456',
    channelId: '789',
    messageId: '999',
    content: 'イベント告知専用チャンネルがほしい',
    anonymous: false,
    votingEnabled: true,
    status: 'pending',
    staffNote: null,
    upvotes: 3,
    downvotes: 1,
    createdAt: new Date('2026-08-11T05:00:00.000Z'),
    ...overrides,
  };
}
