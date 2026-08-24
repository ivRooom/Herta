import { describe, expect, it, vi } from 'vitest';
import {
  buildSuggestionMessage,
  canViewSuggestion,
  formatSuggestionInfo,
  formatSuggestionListPages,
  normalizeSuggestionConfig,
  suggestionPlugin,
  type SuggestionConfig,
} from './suggestion.js';
import type { SuggestionListRecord, SuggestionSnapshot } from './suggestion-repository.js';

const INFO_ID = '11111111-1111-4111-8111-111111111111';

interface InfoTestInteraction {
  guildId: string | null;
  channelId: string | null;
  channel: null;
  user: { id: string };
  memberPermissions: { has(permission: string): boolean } | null;
  member: { roles: { cache: { has(id: string): boolean } } } | null;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
  };
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
}

function createInfoContext(rows: SuggestionSnapshot[]) {
  const queryRaw = vi.fn(async (..._args: unknown[]) => rows);
  const context = {
    client: {},
    prisma: { $queryRaw: queryRaw },
    logger: { warn: vi.fn() },
    guildId: '123',
    config: normalizeSuggestionConfig(undefined) satisfies SuggestionConfig,
    manifest: suggestionPlugin.manifest,
  };
  return { context, queryRaw };
}

function createInfoInteraction(
  input: {
    guildId?: string;
    userId?: string;
    id?: string;
    canManage?: boolean;
  } = {},
): InfoTestInteraction {
  return {
    guildId: input.guildId ?? '123',
    channelId: '789',
    channel: null,
    user: { id: input.userId ?? '456' },
    memberPermissions: { has: () => input.canManage === true },
    member: { roles: { cache: { has: () => false } } },
    options: {
      getSubcommand: () => 'info',
      getString: (name) => (name === 'id' ? (input.id ?? INFO_ID) : null),
    },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

async function executeInfoCommand(
  context: ReturnType<typeof createInfoContext>['context'],
  interaction: InfoTestInteraction,
): Promise<void> {
  const command = suggestionPlugin.provideCommands?.(context as never)[0];
  if (!command) throw new Error('Suggestion command is not available');
  await command.execute(interaction as never);
}

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

  it('不正なUUIDはDB照会前に拒否する', async () => {
    const { context, queryRaw } = createInfoContext([]);
    const interaction = createInfoInteraction({ id: 'not-a-uuid' });

    await executeInfoCommand(context, interaction);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Suggestion IDが正しくありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('第三者にはSuggestionの存在や内容を開示しない', async () => {
    const snapshot = makeSnapshot({ content: '第三者へ開示しない内容' });
    const { context } = createInfoContext([snapshot]);
    const interaction = createInfoInteraction({ userId: '777' });

    await executeInfoCommand(context, interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Suggestionが見つからないか、表示権限がありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
    expect(JSON.stringify(interaction.reply.mock.calls)).not.toContain('第三者へ開示しない内容');
  });

  it('別GuildのID照会ではinteraction Guildをrepository scopeへ渡す', async () => {
    const { context, queryRaw } = createInfoContext([]);
    const interaction = createInfoInteraction({ guildId: '999' });

    await executeInfoCommand(context, interaction);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([INFO_ID, '999']);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Suggestionが見つからないか、表示権限がありません。',
        flags: 64,
      }),
    );
  });

  it('Staffは匿名Suggestionをephemeralかつsafe mentionsで確認できる', async () => {
    const { context } = createInfoContext([
      makeSnapshot({ anonymous: true, staffNote: '対応方針を確認中' }),
    ]);
    const interaction = createInfoInteraction({ userId: '777', canManage: true });

    await executeInfoCommand(context, interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const reply = interaction.reply.mock.calls[0]?.[0] as
      | { content?: string; flags?: number; allowedMentions?: { parse: [] } }
      | undefined;
    expect(reply).toMatchObject({ flags: 64, allowedMentions: { parse: [] } });
    expect(reply?.content).toContain('投稿者: 匿名');
    expect(reply?.content).toContain('Staff: 対応方針を確認中');
    expect(reply?.content).not.toContain('456');
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
