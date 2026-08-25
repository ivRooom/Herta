import { describe, expect, it, vi } from 'vitest';
import {
  formatSuggestionQueuePage,
  normalizeSuggestionConfig,
  suggestionPlugin,
} from './suggestion.js';
import {
  listSuggestionQueue,
  SUGGESTION_QUEUE_MAX_PAGE,
  SUGGESTION_QUEUE_PAGE_SIZE,
  type SuggestionQueueRecord,
} from './suggestion-repository.js';

const ID = '11111111-1111-4111-8111-111111111111';

interface QueueTestInteraction {
  guildId: string | null;
  channelId: string | null;
  channel: null;
  user: { id: string };
  memberPermissions: { has(permission: string): boolean } | null;
  member: { roles: { cache: { has(id: string): boolean } } } | null;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
  };
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
}

function makeRecord(overrides: Partial<SuggestionQueueRecord> = {}): SuggestionQueueRecord {
  return {
    id: ID,
    authorId: '456',
    content: 'イベント告知専用チャンネルがほしい',
    anonymous: false,
    status: 'pending',
    upvotes: 3,
    downvotes: 1,
    createdAt: new Date('2026-08-25T01:00:00.000Z'),
    ...overrides,
  };
}

function createQueueContext(rows: SuggestionQueueRecord[], config: Record<string, unknown> = {}) {
  const queryRaw = vi.fn(async (..._args: unknown[]) => rows);
  const context = {
    client: {},
    prisma: { $queryRaw: queryRaw },
    logger: { warn: vi.fn() },
    guildId: '123',
    config: normalizeSuggestionConfig(config),
    manifest: suggestionPlugin.manifest,
  };
  return { context, queryRaw };
}

function createQueueInteraction(
  input: {
    guildId?: string;
    canManage?: boolean;
    staffRoleIds?: string[];
    status?: string | null;
    page?: number | null;
  } = {},
): QueueTestInteraction {
  const staffRoleIds = new Set(input.staffRoleIds ?? []);
  return {
    guildId: input.guildId ?? '123',
    channelId: '789',
    channel: null,
    user: { id: '456' },
    memberPermissions: { has: () => input.canManage === true },
    member: { roles: { cache: { has: (id) => staffRoleIds.has(id) } } },
    options: {
      getSubcommand: () => 'queue',
      getString: (name) => (name === 'status' ? (input.status ?? null) : null),
      getInteger: (name) => (name === 'page' ? (input.page ?? null) : null),
    },
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

async function executeQueueCommand(
  context: ReturnType<typeof createQueueContext>['context'],
  interaction: QueueTestInteraction,
): Promise<void> {
  const command = suggestionPlugin.provideCommands?.(context as never)[0];
  if (!command) throw new Error('Suggestion command is not available');
  await command.execute(interaction as never);
}

describe('Suggestion staff queue', () => {
  it('queue subcommandとbounded paginationをmanifestへ公開する', () => {
    const queue = suggestionPlugin.manifest.commands[0]?.subcommands?.find(
      (subcommand) => subcommand.name === 'queue',
    );
    expect(queue).toMatchObject({
      name: 'queue',
      options: [
        expect.objectContaining({
          name: 'status',
          type: 'string',
          choices: expect.arrayContaining([
            { name: '未処理', value: 'open' },
            { name: '未確認', value: 'pending' },
            { name: '検討中', value: 'reviewing' },
            { name: '取下げ', value: 'withdrawn' },
            { name: 'すべて', value: 'all' },
          ]),
        }),
        expect.objectContaining({
          name: 'page',
          type: 'integer',
          minValue: 1,
          maxValue: SUGGESTION_QUEUE_MAX_PAGE,
        }),
      ],
    });
  });

  it('Manage Server Staffは未処理Queueをephemeralかつsafe mentionsで表示できる', async () => {
    const rows = [makeRecord()];
    const { context, queryRaw } = createQueueContext(rows);
    const interaction = createQueueInteraction({ canManage: true });

    await executeQueueCommand(context, interaction);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as readonly string[];
    expect(query.join(' ')).toContain(`s."status" IN ('pending', 'reviewing')`);
    expect(query.join(' ')).toContain('ORDER BY s."created_at" DESC, s."id" DESC');
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual(['123', SUGGESTION_QUEUE_PAGE_SIZE + 1, 0]);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Suggestion Staff Queue'),
        flags: 64,
        allowedMentions: { parse: [] },
      }),
    );
  });

  it('non-StaffはDB照会前に拒否する', async () => {
    const { context, queryRaw } = createQueueContext([]);
    const interaction = createQueueInteraction();

    await executeQueueCommand(context, interaction);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Suggestion Queueの表示にはManage Server権限または設定済みStaff Roleが必要です。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('configured Staff RoleでもQueueを表示できる', async () => {
    const { context, queryRaw } = createQueueContext([], { staffRoleIds: ['777'] });
    const interaction = createQueueInteraction({ staffRoleIds: ['777'] });

    await executeQueueCommand(context, interaction);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('該当するSuggestionはありません。'),
        flags: 64,
      }),
    );
  });

  it('interaction Guild IDをquery scopeへ固定してcross-Guild leakageを防ぐ', async () => {
    const { context, queryRaw } = createQueueContext([]);
    const interaction = createQueueInteraction({ guildId: '999', canManage: true });

    await executeQueueCommand(context, interaction);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]?.slice(1)[0]).toBe('999');
  });

  it('status filterをparameterized queryへ渡す', async () => {
    const { context, queryRaw } = createQueueContext([makeRecord({ status: 'accepted' })]);
    const interaction = createQueueInteraction({ canManage: true, status: 'accepted', page: 2 });

    await executeQueueCommand(context, interaction);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as readonly string[];
    expect(query.join(' ')).toContain('s."status" =');
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([
      '123',
      'accepted',
      SUGGESTION_QUEUE_PAGE_SIZE + 1,
      SUGGESTION_QUEUE_PAGE_SIZE,
    ]);
    expect(interaction.reply.mock.calls[0]?.[0].content).toContain('✅ 採用');
  });

  it('空Queueを明示する', async () => {
    const { context } = createQueueContext([]);
    const interaction = createQueueInteraction({ canManage: true, status: 'reviewing' });

    await executeQueueCommand(context, interaction);

    expect(interaction.reply.mock.calls[0]?.[0].content).toContain(
      '該当するSuggestionはありません。',
    );
  });

  it('page上限は許可し、上限外はDB照会前に拒否する', async () => {
    const allowed = createQueueContext([]);
    const allowedInteraction = createQueueInteraction({
      canManage: true,
      page: SUGGESTION_QUEUE_MAX_PAGE,
    });
    await executeQueueCommand(allowed.context, allowedInteraction);
    expect(allowed.queryRaw).toHaveBeenCalledTimes(1);
    expect(allowed.queryRaw.mock.calls[0]?.slice(1)).toEqual([
      '123',
      SUGGESTION_QUEUE_PAGE_SIZE + 1,
      (SUGGESTION_QUEUE_MAX_PAGE - 1) * SUGGESTION_QUEUE_PAGE_SIZE,
    ]);

    const invalid = createQueueContext([]);
    const invalidInteraction = createQueueInteraction({
      canManage: true,
      page: SUGGESTION_QUEUE_MAX_PAGE + 1,
    });
    await executeQueueCommand(invalid.context, invalidInteraction);
    expect(invalid.queryRaw).not.toHaveBeenCalled();
    expect(invalidInteraction.reply).toHaveBeenCalledWith({
      content: `pageは1〜${SUGGESTION_QUEUE_MAX_PAGE}で指定してください。`,
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('anonymous Suggestionのauthor IDをStaff Queueへ漏らさない', () => {
    const output = formatSuggestionQueuePage(
      {
        records: [makeRecord({ anonymous: true, authorId: '999999999999999999' })],
        hasNext: false,
      },
      'open',
      1,
    );

    expect(output).toContain('投稿者: 匿名');
    expect(output).not.toContain('999999999999999999');
  });

  it('最大件数・最大本文でもDiscord response上限を超えない', () => {
    const records = Array.from({ length: SUGGESTION_QUEUE_PAGE_SIZE }, (_, index) =>
      makeRecord({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        authorId: `99999999999999999${index}`,
        content: 'x'.repeat(1000),
      }),
    );
    const output = formatSuggestionQueuePage({ records, hasNext: true }, 'all', 99);

    expect(output.length).toBeLessThanOrEqual(1900);
  });

  it('vote集計を含むページを1 queryで取得しN+1を発生させない', async () => {
    const rows = [
      makeRecord(),
      makeRecord({
        id: '22222222-2222-4222-8222-222222222222',
        upvotes: 7,
        downvotes: 2,
      }),
    ];
    const queryRaw = vi.fn(async (..._args: unknown[]) => rows);

    const result = await listSuggestionQueue({ $queryRaw: queryRaw } as never, {
      guildId: '123',
      filter: 'all',
      page: 1,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0]?.[0] as readonly string[];
    expect(query.join(' ')).toContain('LEFT JOIN "suggestion_votes"');
    expect(result.records).toHaveLength(2);
    expect(result.records[1]).toMatchObject({ upvotes: 7, downvotes: 2 });
  });

  it('repository自体もpage範囲外を拒否してbounded queryを保証する', async () => {
    const queryRaw = vi.fn(async (..._args: unknown[]) => []);

    await expect(
      listSuggestionQueue({ $queryRaw: queryRaw } as never, {
        guildId: '123',
        filter: 'open',
        page: 0,
      }),
    ).rejects.toThrow('SuggestionQueuePageOutOfRange');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
