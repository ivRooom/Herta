import { describe, expect, it, vi } from 'vitest';
import {
  formatSuggestionHistoryPage,
  listSuggestionHistory,
  SUGGESTION_HISTORY_MAX_PAGE,
  SUGGESTION_HISTORY_PAGE_SIZE,
  type SuggestionHistoryRecord,
} from './suggestion-history.js';
import { normalizeSuggestionConfig, suggestionPlugin } from './suggestion.js';
import {
  updateSuggestionStatus,
  type SuggestionSnapshot,
} from './suggestion-repository.js';

const ID = '11111111-1111-4111-8111-111111111111';
const GUILD_ID = '123';
const STAFF_ID = '456';

function makeSnapshot(overrides: Partial<SuggestionSnapshot> = {}): SuggestionSnapshot {
  return {
    id: ID,
    guildId: GUILD_ID,
    authorId: '999999999999999999',
    channelId: '789',
    messageId: '888',
    content: '履歴表示へ直接出してはいけない本文',
    anonymous: true,
    votingEnabled: true,
    status: 'pending',
    staffNote: null,
    upvotes: 3,
    downvotes: 1,
    createdAt: new Date('2026-08-25T01:00:00.000Z'),
    ...overrides,
  };
}

function makeHistoryRecord(
  overrides: Partial<SuggestionHistoryRecord> = {},
): SuggestionHistoryRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    event: 'suggestion.edit',
    changes: {
      before: { contentLength: 12, status: 'reviewing' },
      after: { contentLength: 20, status: 'pending' },
    },
    metadata: { operationSource: 'discord', votesReset: true, reviewReset: true },
    createdAt: new Date('2026-08-25T05:00:00.000Z'),
    ...overrides,
  };
}

function createHistoryContext(input: {
  snapshot?: SuggestionSnapshot | null;
  history?: SuggestionHistoryRecord[];
  config?: Record<string, unknown>;
} = {}) {
  const snapshot = input.snapshot === undefined ? makeSnapshot() : input.snapshot;
  const queryRaw = vi.fn(async (..._args: unknown[]) => (snapshot ? [snapshot] : []));
  const findMany = vi.fn(async (_args: unknown) => input.history ?? []);
  const context = {
    client: {},
    prisma: { $queryRaw: queryRaw, auditLog: { findMany } },
    logger: { warn: vi.fn() },
    guildId: GUILD_ID,
    config: normalizeSuggestionConfig(input.config),
    manifest: suggestionPlugin.manifest,
  };
  return { context, queryRaw, findMany };
}

function createHistoryInteraction(input: {
  guildId?: string;
  id?: string;
  page?: number | null;
  canManage?: boolean;
  staffRoleIds?: string[];
} = {}) {
  const staffRoles = new Set(input.staffRoleIds ?? []);
  return {
    guildId: input.guildId ?? GUILD_ID,
    channelId: '789',
    channel: null,
    user: { id: STAFF_ID },
    memberPermissions: { has: () => input.canManage === true },
    member: { roles: { cache: { has: (id: string) => staffRoles.has(id) } } },
    options: {
      getSubcommand: () => 'history',
      getString: (name: string) => (name === 'id' ? (input.id ?? ID) : null),
      getInteger: (name: string) => (name === 'page' ? (input.page ?? null) : null),
    },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

async function executeHistory(
  context: ReturnType<typeof createHistoryContext>['context'],
  interaction: ReturnType<typeof createHistoryInteraction>,
): Promise<void> {
  const command = suggestionPlugin.provideCommands?.(context as never)[0];
  if (!command) throw new Error('Suggestion command is not available');
  await command.execute(interaction as never);
}

describe('Suggestion staff history', () => {
  it('history subcommandをbounded pagination付きでmanifestへ公開する', () => {
    const history = suggestionPlugin.manifest.commands[0]?.subcommands?.find(
      (subcommand) => subcommand.name === 'history',
    );
    expect(history).toMatchObject({
      name: 'history',
      options: [
        { name: 'id', type: 'string', required: true },
        {
          name: 'page',
          type: 'integer',
          minValue: 1,
          maxValue: SUGGESTION_HISTORY_MAX_PAGE,
        },
      ],
    });
  });

  it('Manage Server Staffは履歴をephemeralかつsafe mentionsで表示できる', async () => {
    const { context, queryRaw, findMany } = createHistoryContext({
      history: [makeHistoryRecord()],
    });
    const interaction = createHistoryInteraction({ canManage: true });

    await executeHistory(context, interaction);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Suggestion History'),
        flags: 64,
        allowedMentions: { parse: [] },
      }),
    );
    expect(interaction.reply.mock.calls[0]?.[0].content).toContain('投稿者編集');
  });

  it('configured Staff Roleでも履歴を表示できる', async () => {
    const { context, findMany } = createHistoryContext({
      config: { staffRoleIds: ['777'] },
    });
    const interaction = createHistoryInteraction({ staffRoleIds: ['777'] });

    await executeHistory(context, interaction);

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('non-StaffはSuggestion存在確認より前に拒否する', async () => {
    const { context, queryRaw, findMany } = createHistoryContext();
    const interaction = createHistoryInteraction();

    await executeHistory(context, interaction);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Suggestion Historyの表示にはManage Server権限または設定済みStaff Roleが必要です。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('不正UUIDはDB照会前に拒否する', async () => {
    const { context, queryRaw, findMany } = createHistoryContext();
    const interaction = createHistoryInteraction({ canManage: true, id: 'not-a-uuid' });

    await executeHistory(context, interaction);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Suggestion IDが正しくありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('missingまたはcross-GuildではAuditを照会せず存在推測を抑制する', async () => {
    const missing = createHistoryContext({ snapshot: null });
    const interaction = createHistoryInteraction({ guildId: '999', canManage: true });

    await executeHistory(missing.context, interaction);

    expect(missing.queryRaw).toHaveBeenCalledTimes(1);
    expect(missing.queryRaw.mock.calls[0]?.slice(1)).toEqual([ID, '999']);
    expect(missing.findMany).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Suggestionが見つからないか、表示権限がありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('空履歴を明示する', async () => {
    const { context } = createHistoryContext();
    const interaction = createHistoryInteraction({ canManage: true });

    await executeHistory(context, interaction);

    expect(interaction.reply.mock.calls[0]?.[0].content).toContain(
      '記録済みのSuggestion履歴はありません。',
    );
  });

  it('page 1はGuild/target scopeとdeterministic orderを1 queryへ固定する', async () => {
    const rows = [makeHistoryRecord()];
    const findMany = vi.fn(async () => rows);

    const result = await listSuggestionHistory(
      { auditLog: { findMany } } as never,
      { guildId: GUILD_ID, suggestionId: ID, page: 1 },
    );

    expect(result.records).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        guildId: GUILD_ID,
        targetType: 'suggestion',
        targetId: ID,
        event: { startsWith: 'suggestion.' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: SUGGESTION_HISTORY_PAGE_SIZE + 1,
      select: {
        id: true,
        event: true,
        changes: true,
        metadata: true,
        createdAt: true,
      },
    });
  });

  it('max pageは許可し、上限外はrepositoryでもDB前に拒否する', async () => {
    const findMany = vi.fn(async () => []);
    await listSuggestionHistory(
      { auditLog: { findMany } } as never,
      { guildId: GUILD_ID, suggestionId: ID, page: SUGGESTION_HISTORY_MAX_PAGE },
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: (SUGGESTION_HISTORY_MAX_PAGE - 1) * SUGGESTION_HISTORY_PAGE_SIZE,
      }),
    );

    const invalidFindMany = vi.fn(async () => []);
    await expect(
      listSuggestionHistory(
        { auditLog: { findMany: invalidFindMany } } as never,
        { guildId: GUILD_ID, suggestionId: ID, page: SUGGESTION_HISTORY_MAX_PAGE + 1 },
      ),
    ).rejects.toThrow('SuggestionHistoryPageOutOfRange');
    expect(invalidFindMany).not.toHaveBeenCalled();
  });

  it('commandでもpage範囲外をSuggestion照会前に拒否する', async () => {
    const { context, queryRaw, findMany } = createHistoryContext();
    const interaction = createHistoryInteraction({ canManage: true, page: 0 });

    await executeHistory(context, interaction);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: `pageは1〜${SUGGESTION_HISTORY_MAX_PAGE}で指定してください。`,
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('raw本文・raw Staff note・actor/author IDを履歴へ漏らさない', () => {
    const rawContent = 'RAW-CONTENT-SECRET';
    const rawNote = 'RAW-STAFF-NOTE-SECRET';
    const actorId = '123456789012345678';
    const authorId = '999999999999999999';
    const output = formatSuggestionHistoryPage(
      {
        records: [
          makeHistoryRecord({
            changes: {
              before: { contentLength: 12, status: 'reviewing', content: rawContent },
              after: { contentLength: 20, status: 'pending' },
            },
            metadata: {
              operationSource: 'discord',
              votesReset: true,
              reviewReset: true,
              actorId,
              authorId,
            },
          }),
          makeHistoryRecord({
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            event: 'suggestion.status',
            changes: {
              before: { status: 'pending', staffNotePresent: false, staffNoteLength: 0 },
              after: {
                status: 'accepted',
                staffNotePresent: true,
                staffNoteLength: rawNote.length,
                staffNote: rawNote,
              },
            },
            metadata: { operationSource: 'discord', actorId },
          }),
        ],
        hasNext: false,
      },
      ID,
      1,
    );

    expect(output).toContain('本文 12文字 → 20文字');
    expect(output).toContain('Staffコメントあり');
    expect(output).not.toContain(rawContent);
    expect(output).not.toContain(rawNote);
    expect(output).not.toContain(actorId);
    expect(output).not.toContain(authorId);
  });

  it('最大件数と未知eventでもDiscord response boundを超えない', () => {
    const records = Array.from({ length: SUGGESTION_HISTORY_PAGE_SIZE }, (_, index) =>
      makeHistoryRecord({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        event: `suggestion.${'x'.repeat(1000)}.${index}`,
      }),
    );
    const output = formatSuggestionHistoryPage({ records, hasNext: true }, ID, 99);

    expect(output.length).toBeLessThanOrEqual(1900);
  });
});

describe('Suggestion status audit regression', () => {
  it('Staff status変更をrow lockとprivacy-safe Auditで同一transactionへ記録する', async () => {
    const beforeNote = '旧Staffコメント本文';
    const afterNote = '新Staffコメント本文';
    const txQueryRaw = vi.fn(async () => [{ status: 'pending', staffNote: beforeNote }]);
    const txExecuteRaw = vi.fn(async () => 1);
    const auditCreate = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: txQueryRaw,
      $executeRaw: txExecuteRaw,
      auditLog: { create: auditCreate },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
    const snapshot = makeSnapshot({ status: 'accepted', staffNote: afterNote });
    const rootQueryRaw = vi.fn(async () => [snapshot]);
    const prisma = { $transaction: transaction, $queryRaw: rootQueryRaw };

    const result = await updateSuggestionStatus(prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      actorId: STAFF_ID,
      status: 'accepted',
      staffNote: afterNote,
    });

    expect(result).toEqual(snapshot);
    expect(transaction).toHaveBeenCalledTimes(1);
    const lockQuery = txQueryRaw.mock.calls[0]?.[0] as readonly string[];
    expect(lockQuery.join(' ')).toContain('FOR UPDATE');
    expect(txQueryRaw.mock.calls[0]?.slice(1)).toEqual([ID, GUILD_ID]);
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        guildId: GUILD_ID,
        actorId: STAFF_ID,
        event: 'suggestion.status',
        targetType: 'suggestion',
        targetId: ID,
        changes: {
          before: {
            status: 'pending',
            staffNotePresent: true,
            staffNoteLength: beforeNote.length,
          },
          after: {
            status: 'accepted',
            staffNotePresent: true,
            staffNoteLength: afterNote.length,
          },
        },
        metadata: { operationSource: 'discord' },
      },
    });
    const auditPayload = JSON.stringify(auditCreate.mock.calls);
    expect(auditPayload).not.toContain(beforeNote);
    expect(auditPayload).not.toContain(afterNote);
  });

  it('withdrawnはstatus変更で復活せずAuditも生成しない', async () => {
    const auditCreate = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: vi.fn(async () => [{ status: 'withdrawn', staffNote: null }]),
      $executeRaw: vi.fn(async () => 1),
      auditLog: { create: auditCreate },
    };
    const rootQueryRaw = vi.fn(async () => [makeSnapshot()]);
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: rootQueryRaw,
    };

    const result = await updateSuggestionStatus(prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      actorId: STAFF_ID,
      status: 'accepted',
      staffNote: null,
    });

    expect(result).toBeNull();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(rootQueryRaw).not.toHaveBeenCalled();
  });

  it('同一status/noteの再実行はidempotentでAuditを増やさない', async () => {
    const note = '同じStaffコメント';
    const auditCreate = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: vi.fn(async () => [{ status: 'reviewing', staffNote: note }]),
      $executeRaw: vi.fn(async () => 1),
      auditLog: { create: auditCreate },
    };
    const snapshot = makeSnapshot({ status: 'reviewing', staffNote: note });
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: vi.fn(async () => [snapshot]),
    };

    const result = await updateSuggestionStatus(prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      actorId: STAFF_ID,
      status: 'reviewing',
      staffNote: note,
    });

    expect(result).toEqual(snapshot);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
