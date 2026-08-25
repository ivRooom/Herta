import { describe, expect, it, vi } from 'vitest';
import { normalizeSuggestionConfig, suggestionPlugin } from './suggestion.js';
import {
  editSuggestion,
  type SuggestionSnapshot,
  type SuggestionStatus,
} from './suggestion-repository.js';

const ID = '11111111-1111-4111-8111-111111111111';
const GUILD_ID = '123';
const AUTHOR_ID = '456';

type EditRow = {
  authorId: string;
  status: SuggestionStatus;
  content: string;
};

function makeSnapshot(overrides: Partial<SuggestionSnapshot> = {}): SuggestionSnapshot {
  return {
    id: ID,
    guildId: GUILD_ID,
    authorId: AUTHOR_ID,
    channelId: '789',
    messageId: '999',
    content: '編集後のSuggestion',
    anonymous: false,
    votingEnabled: true,
    status: 'pending',
    staffNote: null,
    upvotes: 3,
    downvotes: 1,
    createdAt: new Date('2026-08-25T01:00:00.000Z'),
    ...overrides,
  };
}

function createPrismaHarness(row: EditRow | null, snapshots: SuggestionSnapshot[] = []) {
  const txQueryRaw = vi.fn(async (..._args: unknown[]) => (row ? [row] : []));
  const txExecuteRaw = vi.fn(async (..._args: unknown[]) => 1);
  const auditCreate = vi.fn(async () => undefined);
  const tx = {
    $queryRaw: txQueryRaw,
    $executeRaw: txExecuteRaw,
    auditLog: { create: auditCreate },
  };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );
  let snapshotIndex = 0;
  const rootQueryRaw = vi.fn(async () => {
    if (snapshots.length === 0) return [];
    const snapshot = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
    snapshotIndex += 1;
    return snapshot ? [snapshot] : [];
  });
  return {
    prisma: { $transaction: transaction, $queryRaw: rootQueryRaw },
    transaction,
    txQueryRaw,
    txExecuteRaw,
    auditCreate,
    rootQueryRaw,
  };
}

function createCommandHarness(
  input: {
    id?: string;
    content?: string;
    guildId?: string;
    userId?: string;
    row?: EditRow | null;
    snapshots?: SuggestionSnapshot[];
    messageEditError?: Error;
  } = {},
) {
  const id = input.id ?? ID;
  const content = input.content ?? '編集後のSuggestion';
  const guildId = input.guildId ?? GUILD_ID;
  const userId = input.userId ?? AUTHOR_ID;
  const row =
    input.row === undefined
      ? { authorId: AUTHOR_ID, status: 'pending' as const, content: '編集前のSuggestion' }
      : input.row;
  const snapshots = input.snapshots ?? [makeSnapshot({ guildId, authorId: AUTHOR_ID, content })];
  const prisma = createPrismaHarness(row, snapshots);
  const edit = input.messageEditError
    ? vi.fn(async (_options: unknown) => Promise.reject(input.messageEditError))
    : vi.fn(async (_options: unknown) => undefined);
  const fetchMessage = vi.fn(async () => ({ id: '999', edit }));
  const fetchChannel = vi.fn(async () => ({
    isTextBased: () => true,
    messages: { fetch: fetchMessage },
  }));
  const reply = vi.fn(async () => undefined);
  const context = {
    client: {
      channels: { fetch: fetchChannel },
      users: { fetch: vi.fn() },
    },
    prisma: prisma.prisma,
    logger: { warn: vi.fn() },
    guildId,
    config: normalizeSuggestionConfig(undefined),
    manifest: suggestionPlugin.manifest,
  };
  const interaction = {
    guildId,
    channelId: '789',
    channel: null,
    user: { id: userId },
    memberPermissions: { has: () => false },
    member: { roles: { cache: { has: () => false } } },
    options: {
      getSubcommand: () => 'edit',
      getString: (name: string) => {
        if (name === 'id') return id;
        if (name === 'content') return content;
        return null;
      },
      getInteger: () => null,
    },
    reply,
    followUp: vi.fn(async () => undefined),
  };
  return {
    ...prisma,
    context,
    interaction,
    reply,
    edit,
    fetchMessage,
    fetchChannel,
  };
}

async function executeEdit(
  context: ReturnType<typeof createCommandHarness>['context'],
  interaction: ReturnType<typeof createCommandHarness>['interaction'],
): Promise<void> {
  const command = suggestionPlugin.provideCommands?.(context as never)[0];
  if (!command) throw new Error('Suggestion command is not available');
  await command.execute(interaction as never);
}

describe('Suggestion author edit', () => {
  it('edit subcommandをid/content必須でmanifestへ公開する', () => {
    const edit = suggestionPlugin.manifest.commands[0]?.subcommands?.find(
      (subcommand) => subcommand.name === 'edit',
    );
    expect(edit).toMatchObject({
      name: 'edit',
      options: [
        { name: 'id', type: 'string', required: true },
        { name: 'content', type: 'string', required: true },
      ],
    });
  });

  it('pendingをrow lock下で編集しprivacy-safe Auditを同一transactionへ記録する', async () => {
    const before = 'raw-before-secret';
    const after = 'raw-after-secret';
    const snapshot = makeSnapshot({ content: after });
    const harness = createPrismaHarness(
      { authorId: AUTHOR_ID, status: 'pending', content: before },
      [snapshot],
    );

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: after,
    });

    expect(result).toEqual({ outcome: 'edited', snapshot });
    expect(harness.transaction).toHaveBeenCalledTimes(1);
    const lockQuery = harness.txQueryRaw.mock.calls[0]?.[0] as readonly string[];
    expect(lockQuery.join(' ')).toContain('FOR UPDATE');
    expect(lockQuery.join(' ')).toContain('"guild_id" =');
    expect(harness.txQueryRaw.mock.calls[0]?.slice(1)).toEqual([ID, GUILD_ID]);
    expect(harness.txExecuteRaw).toHaveBeenCalledTimes(1);
    const updateQuery = harness.txExecuteRaw.mock.calls[0]?.[0] as readonly string[];
    expect(updateQuery.join(' ')).toContain(`"status" IN ('pending', 'reviewing')`);
    expect(harness.auditCreate).toHaveBeenCalledWith({
      data: {
        guildId: GUILD_ID,
        actorId: AUTHOR_ID,
        event: 'suggestion.edit',
        targetType: 'suggestion',
        targetId: ID,
        changes: {
          before: { contentLength: before.length },
          after: { contentLength: after.length },
        },
        metadata: { operationSource: 'discord' },
      },
    });
    const auditPayload = JSON.stringify(harness.auditCreate.mock.calls);
    expect(auditPayload).not.toContain(before);
    expect(auditPayload).not.toContain(after);
  });

  it('reviewingも編集できる', async () => {
    const harness = createPrismaHarness(
      { authorId: AUTHOR_ID, status: 'reviewing', content: 'before' },
      [makeSnapshot({ status: 'reviewing', content: 'after' })],
    );

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: 'after',
    });

    expect(result.outcome).toBe('edited');
    expect(harness.txExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('同一本文の再実行はUPDATE/Auditを増やさず再同期用snapshotを返す', async () => {
    const snapshot = makeSnapshot({ content: 'same' });
    const harness = createPrismaHarness(
      { authorId: AUTHOR_ID, status: 'pending', content: 'same' },
      [snapshot],
    );

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: 'same',
    });

    expect(result).toEqual({ outcome: 'unchanged', snapshot });
    expect(harness.txExecuteRaw).not.toHaveBeenCalled();
    expect(harness.auditCreate).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'rejected', 'completed', 'withdrawn'] as const)(
    '%sは競合後のcurrent stateを尊重して編集しない',
    async (status) => {
      const harness = createPrismaHarness({
        authorId: AUTHOR_ID,
        status,
        content: 'before',
      });

      const result = await editSuggestion(harness.prisma as never, {
        id: ID,
        guildId: GUILD_ID,
        authorId: AUTHOR_ID,
        content: 'after',
      });

      expect(result).toEqual({ outcome: 'not_editable', snapshot: null });
      expect(harness.txExecuteRaw).not.toHaveBeenCalled();
      expect(harness.auditCreate).not.toHaveBeenCalled();
      expect(harness.rootQueryRaw).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: 'third-party',
      row: { authorId: AUTHOR_ID, status: 'pending' as const, content: 'secret' },
    },
    { label: 'missing', row: null },
  ])('$labelは同じoutcomeで存在推測を抑制する', async ({ row }) => {
    const harness = createPrismaHarness(row, [makeSnapshot({ content: 'secret' })]);

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: row ? '777' : AUTHOR_ID,
      content: 'after',
    });

    expect(result).toEqual({ outcome: 'not_found_or_forbidden', snapshot: null });
    expect(harness.txExecuteRaw).not.toHaveBeenCalled();
    expect(harness.auditCreate).not.toHaveBeenCalled();
    expect(harness.rootQueryRaw).not.toHaveBeenCalled();
  });

  it('不正UUIDはDB transaction前に拒否する', async () => {
    const harness = createCommandHarness({ id: 'not-a-uuid' });

    await executeEdit(harness.context, harness.interaction);

    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.reply).toHaveBeenCalledWith({
      content: 'Suggestion IDが正しくありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it.each([
    { label: 'empty', content: '', accepted: false },
    { label: 'whitespace', content: '   ', accepted: false },
    { label: '1 char', content: 'x', accepted: true },
    { label: '1000 chars', content: 'x'.repeat(1000), accepted: true },
    { label: '1001 chars', content: 'x'.repeat(1001), accepted: false },
  ])('content境界: $label', async ({ content, accepted }) => {
    const snapshot = makeSnapshot({ content: content.trim(), messageId: null });
    const harness = createCommandHarness({ content, snapshots: [snapshot] });

    await executeEdit(harness.context, harness.interaction);

    if (accepted) {
      expect(harness.transaction).toHaveBeenCalledTimes(1);
      expect(harness.reply).toHaveBeenCalledWith({
        content: `Suggestion \`${ID}\` を更新しました。`,
        flags: 64,
        allowedMentions: { parse: [] },
      });
    } else {
      expect(harness.transaction).not.toHaveBeenCalled();
      expect(harness.reply).toHaveBeenCalledWith({
        content: 'contentは1〜1000文字で入力してください。',
        flags: 64,
        allowedMentions: { parse: [] },
      });
    }
  });

  it('interaction Guildをquery scopeへ固定してcross-Guild編集を防ぐ', async () => {
    const harness = createCommandHarness({
      guildId: '999',
      row: null,
      snapshots: [],
    });

    await executeEdit(harness.context, harness.interaction);

    expect(harness.txQueryRaw.mock.calls[0]?.slice(1)).toEqual([ID, '999']);
    expect(harness.reply).toHaveBeenCalledWith({
      content: 'Suggestionが見つからないか、編集権限がありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('第三者への応答からSuggestion本文を漏らさない', async () => {
    const harness = createCommandHarness({
      userId: '777',
      row: { authorId: AUTHOR_ID, status: 'pending', content: '秘密の本文' },
      snapshots: [makeSnapshot({ content: '秘密の本文' })],
    });

    await executeEdit(harness.context, harness.interaction);

    expect(harness.reply).toHaveBeenCalledWith({
      content: 'Suggestionが見つからないか、編集権限がありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
    expect(JSON.stringify(harness.reply.mock.calls)).not.toContain('秘密の本文');
  });

  it('anonymous編集後もauthor identityを漏らさずsafe mentionsを維持する', async () => {
    const content = '@everyone 新しい内容 <@999999999999999999>';
    const snapshot = makeSnapshot({ anonymous: true, content });
    const harness = createCommandHarness({
      content,
      snapshots: [snapshot, snapshot],
    });

    await executeEdit(harness.context, harness.interaction);

    expect(harness.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('投稿者: 匿名'),
        allowedMentions: { parse: [] },
      }),
    );
    expect(JSON.stringify(harness.edit.mock.calls)).not.toContain(`<@${AUTHOR_ID}>`);
    expect(harness.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64, allowedMentions: { parse: [] } }),
    );
  });

  it('公開message更新失敗でもDB変更をrollbackしない', async () => {
    const content = 'DBでは確定済み';
    const snapshot = makeSnapshot({ content });
    const harness = createCommandHarness({
      content,
      snapshots: [snapshot],
      messageEditError: new Error('Discord edit failed'),
    });

    await executeEdit(harness.context, harness.interaction);

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(harness.auditCreate).toHaveBeenCalledTimes(1);
    expect(harness.reply).toHaveBeenCalledWith({
      content: `Suggestion \`${ID}\` を更新しました。`,
      flags: 64,
      allowedMentions: { parse: [] },
    });
    expect(harness.context.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ suggestionId: ID }),
      '編集後のSuggestionメッセージ再同期に失敗しました',
    );
  });

  it('競合した後発editの最新contentへ公開messageをreconcileする', async () => {
    const first = makeSnapshot({ content: 'first edit' });
    const latest = makeSnapshot({ content: 'latest edit' });
    const harness = createCommandHarness({
      content: 'first edit',
      snapshots: [first, latest, latest],
    });

    await executeEdit(harness.context, harness.interaction);

    expect(harness.edit).toHaveBeenCalledTimes(2);
    const firstPayload = harness.edit.mock.calls[0]?.[0] as { content: string } | undefined;
    const latestPayload = harness.edit.mock.calls[1]?.[0] as { content: string } | undefined;
    expect(firstPayload?.content).toContain('first edit');
    expect(latestPayload?.content).toContain('latest edit');
  });
});
