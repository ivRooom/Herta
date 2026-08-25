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

function createRepositoryHarness(input: {
  row?: { authorId: string; status: SuggestionStatus; content: string } | null;
  snapshots?: SuggestionSnapshot[];
}) {
  const txQueryRaw = vi.fn(async () => (input.row === null ? [] : [input.row]));
  const txExecuteRaw = vi.fn(async () => 1);
  const auditCreate = vi.fn(async () => undefined);
  const tx = {
    $queryRaw: txQueryRaw,
    $executeRaw: txExecuteRaw,
    auditLog: { create: auditCreate },
  };
  let snapshotIndex = 0;
  const snapshots = input.snapshots ?? [];
  const rootQueryRaw = vi.fn(async () => {
    const snapshot = snapshots[Math.min(snapshotIndex, Math.max(0, snapshots.length - 1))];
    snapshotIndex += 1;
    return snapshot ? [snapshot] : [];
  });
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  const prisma = {
    $transaction: transaction,
    $queryRaw: rootQueryRaw,
  };
  return {
    prisma,
    transaction,
    txQueryRaw,
    txExecuteRaw,
    auditCreate,
    rootQueryRaw,
  };
}

function createCommandHarness(input: {
  id?: string;
  content?: string;
  guildId?: string;
  userId?: string;
  row?: { authorId: string; status: SuggestionStatus; content: string } | null;
  snapshots?: SuggestionSnapshot[];
  messageEditError?: Error;
}) {
  const id = input.id ?? ID;
  const content = input.content ?? '編集後のSuggestion';
  const guildId = input.guildId ?? GUILD_ID;
  const userId = input.userId ?? AUTHOR_ID;
  const repository = createRepositoryHarness({
    row:
      input.row === undefined
        ? { authorId: AUTHOR_ID, status: 'pending', content: '編集前のSuggestion' }
        : input.row,
    snapshots:
      input.snapshots ?? [makeSnapshot({ guildId, authorId: AUTHOR_ID, content })],
  });
  const edit = input.messageEditError
    ? vi.fn(async () => Promise.reject(input.messageEditError))
    : vi.fn(async () => undefined);
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
    prisma: repository.prisma,
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
    ...repository,
    context,
    interaction,
    reply,
    edit,
    fetchMessage,
    fetchChannel,
  };
}

async function executeEditCommand(
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

  it('投稿者本人はpending Suggestionをrow lock下で編集しAuditを同一transactionへ記録する', async () => {
    const snapshot = makeSnapshot({ content: '新しい本文' });
    const harness = createRepositoryHarness({
      row: { authorId: AUTHOR_ID, status: 'pending', content: '古い本文' },
      snapshots: [snapshot],
    });

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: '新しい本文',
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
          before: { contentLength: 4 },
          after: { contentLength: 5 },
        },
        metadata: { operationSource: 'discord' },
      },
    });
  });

  it('reviewing Suggestionも編集できる', async () => {
    const harness = createRepositoryHarness({
      row: { authorId: AUTHOR_ID, status: 'reviewing', content: '古い本文' },
      snapshots: [makeSnapshot({ status: 'reviewing', content: '新しい本文' })],
    });

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: '新しい本文',
    });

    expect(result.outcome).toBe('edited');
    expect(harness.txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(harness.auditCreate).toHaveBeenCalledTimes(1);
  });

  it('同一本文の再実行はidempotentでUPDATE/Auditを増やさず再同期用snapshotを返す', async () => {
    const snapshot = makeSnapshot({ content: '同じ本文' });
    const harness = createRepositoryHarness({
      row: { authorId: AUTHOR_ID, status: 'pending', content: '同じ本文' },
      snapshots: [snapshot],
    });

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: '同じ本文',
    });

    expect(result).toEqual({ outcome: 'unchanged', snapshot });
    expect(harness.txExecuteRaw).not.toHaveBeenCalled();
    expect(harness.auditCreate).not.toHaveBeenCalled();
    expect(harness.rootQueryRaw).toHaveBeenCalledTimes(1);
  });

  it.each(['accepted', 'rejected', 'completed', 'withdrawn'] as const)(
    '%s Suggestionは編集できず、競合後のcurrent stateを尊重する',
    async (status) => {
      const harness = createRepositoryHarness({
        row: { authorId: AUTHOR_ID, status, content: '古い本文' },
        snapshots: [makeSnapshot()],
      });

      const result = await editSuggestion(harness.prisma as never, {
        id: ID,
        guildId: GUILD_ID,
        authorId: AUTHOR_ID,
        content: '新しい本文',
      });

      expect(result).toEqual({ outcome: 'not_editable', snapshot: null });
      expect(harness.txExecuteRaw).not.toHaveBeenCalled();
      expect(harness.auditCreate).not.toHaveBeenCalled();
      expect(harness.rootQueryRaw).not.toHaveBeenCalled();
    },
  );

  it('第三者にはmissingと同じoutcomeを返し本文を再照会しない', async () => {
    const harness = createRepositoryHarness({
      row: { authorId: AUTHOR_ID, status: 'pending', content: '秘密の本文' },
      snapshots: [makeSnapshot({ content: '秘密の本文' })],
    });

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: '777',
      content: '不正な変更',
    });

    expect(result).toEqual({ outcome: 'not_found_or_forbidden', snapshot: null });
    expect(harness.txExecuteRaw).not.toHaveBeenCalled();
    expect(harness.auditCreate).not.toHaveBeenCalled();
    expect(harness.rootQueryRaw).not.toHaveBeenCalled();
  });

  it('存在しないSuggestionも第三者と同じoutcomeにする', async () => {
    const harness = createRepositoryHarness({ row: null, snapshots: [] });

    const result = await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: '新しい本文',
    });

    expect(result).toEqual({ outcome: 'not_found_or_forbidden', snapshot: null });
    expect(harness.txExecuteRaw).not.toHaveBeenCalled();
    expect(harness.rootQueryRaw).not.toHaveBeenCalled();
  });

  it('Auditへ変更前後のraw本文を保存しない', async () => {
    const before = 'raw-before-secret';
    const after = 'raw-after-secret';
    const harness = createRepositoryHarness({
      row: { authorId: AUTHOR_ID, status: 'pending', content: before },
      snapshots: [makeSnapshot({ content: after })],
    });

    await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: after,
    });

    const auditPayload = JSON.stringify(harness.auditCreate.mock.calls);
    expect(auditPayload).not.toContain(before);
    expect(auditPayload).not.toContain(after);
    expect(auditPayload).toContain('contentLength');
  });

  it('不正UUIDはDB transaction前に拒否する', async () => {
    const harness = createCommandHarness({ id: 'not-a-uuid' });

    await executeEditCommand(harness.context, harness.interaction);

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
    const harness = createCommandHarness({
      content,
      row: { authorId: AUTHOR_ID, status: 'pending', content: 'before' },
      snapshots: [makeSnapshot({ content: content.trim(), messageId: null })],
    });

    await executeEditCommand(harness.context, harness.interaction);

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

  it('interaction Guildをrepository scopeへ固定してcross-Guild編集を防ぐ', async () => {
    const harness = createCommandHarness({
      guildId: '999',
      row: null,
      snapshots: [],
    });

    await executeEditCommand(harness.context, harness.interaction);

    expect(harness.txQueryRaw.mock.calls[0]?.slice(1)).toEqual([ID, '999']);
    expect(harness.reply).toHaveBeenCalledWith({
      content: 'Suggestionが見つからないか、編集権限がありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
  });

  it('第三者のcommand応答からSuggestionの存在・本文を推測させない', async () => {
    const harness = createCommandHarness({
      userId: '777',
      content: '不正な変更',
      row: { authorId: AUTHOR_ID, status: 'pending', content: '秘密の本文' },
      snapshots: [makeSnapshot({ content: '秘密の本文' })],
    });

    await executeEditCommand(harness.context, harness.interaction);

    expect(harness.reply).toHaveBeenCalledWith({
      content: 'Suggestionが見つからないか、編集権限がありません。',
      flags: 64,
      allowedMentions: { parse: [] },
    });
    expect(JSON.stringify(harness.reply.mock.calls)).not.toContain('秘密の本文');
  });

  it('anonymous Suggestion編集後も公開messageでauthor identityを漏らさずsafe mentionsを維持する', async () => {
    const content = '@everyone 新しい内容 <@999999999999999999>';
    const snapshot = makeSnapshot({ anonymous: true, content });
    const harness = createCommandHarness({
      content,
      row: { authorId: AUTHOR_ID, status: 'pending', content: 'before' },
      snapshots: [snapshot, snapshot],
    });

    await executeEditCommand(harness.context, harness.interaction);

    expect(harness.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(content),
        allowedMentions: { parse: [] },
      }),
    );
    const publicPayload = harness.edit.mock.calls[0]?.[0];
    expect(publicPayload.content).toContain('投稿者: 匿名');
    expect(publicPayload.content).not.toContain(`<@${AUTHOR_ID}>`);
    expect(publicPayload.allowedMentions.users).toBeUndefined();
    expect(harness.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: 64, allowedMentions: { parse: [] } }),
    );
  });

  it('公開message更新失敗でもDB確定変更をrollbackせずephemeral成功応答を維持する', async () => {
    const snapshot = makeSnapshot({ content: 'DBでは確定済み' });
    const harness = createCommandHarness({
      content: 'DBでは確定済み',
      row: { authorId: AUTHOR_ID, status: 'pending', content: 'before' },
      snapshots: [snapshot],
      messageEditError: new Error('Discord edit failed'),
    });

    await executeEditCommand(harness.context, harness.interaction);

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

  it('古いedit描画の後に別editが確定した場合は最新contentへreconcileする', async () => {
    const first = makeSnapshot({ content: 'first edit' });
    const latest = makeSnapshot({ content: 'latest edit' });
    const harness = createCommandHarness({
      content: 'first edit',
      row: { authorId: AUTHOR_ID, status: 'pending', content: 'before' },
      snapshots: [first, latest, latest],
    });

    await executeEditCommand(harness.context, harness.interaction);

    expect(harness.edit).toHaveBeenCalledTimes(2);
    expect(harness.edit.mock.calls[0]?.[0].content).toContain('first edit');
    expect(harness.edit.mock.calls[1]?.[0].content).toContain('latest edit');
  });

  it('withdraw/status/vote/edit競合は同じSuggestion row lockとcurrent status再確認で直列化する', async () => {
    const harness = createRepositoryHarness({
      row: { authorId: AUTHOR_ID, status: 'withdrawn', content: 'before' },
      snapshots: [],
    });

    await editSuggestion(harness.prisma as never, {
      id: ID,
      guildId: GUILD_ID,
      authorId: AUTHOR_ID,
      content: 'after',
    });

    const lockQuery = harness.txQueryRaw.mock.calls[0]?.[0] as readonly string[];
    expect(lockQuery.join(' ')).toContain('FOR UPDATE');
    expect(harness.txExecuteRaw).not.toHaveBeenCalled();
  });
});
