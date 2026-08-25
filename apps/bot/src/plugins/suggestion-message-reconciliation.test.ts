import { describe, expect, it, vi } from 'vitest';
import { normalizeSuggestionConfig, suggestionPlugin } from './suggestion.js';
import type { SuggestionSnapshot } from './suggestion-repository.js';

const ID = '11111111-1111-4111-8111-111111111111';

function makeSnapshot(overrides: Partial<SuggestionSnapshot> = {}): SuggestionSnapshot {
  return {
    id: ID,
    guildId: '123',
    authorId: '456',
    channelId: '789',
    messageId: '999',
    content: 'イベント告知専用チャンネルがほしい',
    anonymous: false,
    votingEnabled: true,
    status: 'pending',
    staffNote: null,
    upvotes: 4,
    downvotes: 1,
    createdAt: new Date('2026-08-11T05:00:00.000Z'),
    ...overrides,
  };
}

function createVoteContext(snapshots: SuggestionSnapshot[]) {
  let txQueryCount = 0;
  const tx = {
    $queryRaw: vi.fn(async () => {
      txQueryCount += 1;
      return txQueryCount === 1 ? [{ votingEnabled: true, status: 'pending' }] : [];
    }),
    $executeRaw: vi.fn(async () => 1),
  };
  let rootQueryCount = 0;
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    $queryRaw: vi.fn(async () => {
      const snapshot = snapshots[Math.min(rootQueryCount, snapshots.length - 1)]!;
      rootQueryCount += 1;
      return [snapshot];
    }),
  };
  const edit = vi.fn(async () => undefined);
  const fetchMessage = vi.fn(async () => ({ id: '999', edit }));
  const fetchChannel = vi.fn(async () => ({
    isTextBased: () => true,
    messages: { fetch: fetchMessage },
  }));
  const context = {
    client: {
      channels: { fetch: fetchChannel },
      users: { fetch: vi.fn() },
    },
    prisma,
    logger: { warn: vi.fn() },
    guildId: '123',
    config: normalizeSuggestionConfig(undefined),
    manifest: suggestionPlugin.manifest,
  };
  return { context, edit, getRootQueryCount: () => rootQueryCount };
}

function createVoteInteraction(
  deferUpdate = vi.fn(async () => undefined),
  message?: { id: string; edit(options: unknown): Promise<unknown> },
) {
  return {
    guildId: '123',
    customId: `herta:suggestion:v1:vote:${ID}:up`,
    message,
    user: { id: '777' },
    isButton: () => true,
    reply: vi.fn(async () => undefined),
    deferUpdate,
  };
}

async function executeVote(
  context: ReturnType<typeof createVoteContext>['context'],
  interaction: ReturnType<typeof createVoteInteraction>,
): Promise<void> {
  const event = suggestionPlugin.provideEvents?.(context as never)[0];
  if (!event) throw new Error('Suggestion event is not available');
  await event.handler(context as never, interaction as never);
}

describe('Suggestion message reconciliation', () => {
  it('再同期中に取下げが確定しても最後はwithdrawn表示へ収束する', async () => {
    const pending = makeSnapshot({ upvotes: 4 });
    const newerPending = makeSnapshot({ upvotes: 5 });
    const withdrawn = makeSnapshot({ status: 'withdrawn', upvotes: 5 });
    const { context, edit, getRootQueryCount } = createVoteContext([
      pending,
      newerPending,
      withdrawn,
    ]);
    const interaction = createVoteInteraction();

    await executeVote(context, interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ content: expect.stringContaining('👍 4') }),
    );
    expect(edit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ content: expect.stringContaining('👍 5') }),
    );
    expect(edit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        content: expect.stringContaining('↩️ 取下げ'),
        components: [],
      }),
    );
    expect(getRootQueryCount()).toBeGreaterThanOrEqual(4);
  });

  it('再同期上限直後に取下げを検出した場合も最終snapshotを公開表示へ反映する', async () => {
    const snapshots = [
      makeSnapshot({ upvotes: 4 }),
      makeSnapshot({ upvotes: 5 }),
      makeSnapshot({ upvotes: 6 }),
      makeSnapshot({ upvotes: 7 }),
      makeSnapshot({ upvotes: 8 }),
      makeSnapshot({ upvotes: 9 }),
      makeSnapshot({ status: 'withdrawn', upvotes: 9 }),
    ];
    const { context, edit, getRootQueryCount } = createVoteContext(snapshots);
    const interaction = createVoteInteraction();

    await executeVote(context, interaction);

    expect(edit).toHaveBeenCalledTimes(7);
    expect(edit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('↩️ 取下げ'),
        components: [],
      }),
    );
    expect(getRootQueryCount()).toBe(7);
  });

  it('投票成功時はmessage queueの編集より先にinteractionをackする', async () => {
    const pending = makeSnapshot({ upvotes: 4 });
    const { context, edit } = createVoteContext([pending]);
    const interaction = createVoteInteraction();

    await executeVote(context, interaction);

    const acknowledgementOrder = interaction.deferUpdate.mock.invocationCallOrder[0];
    const editOrder = edit.mock.invocationCallOrder[0];
    expect(acknowledgementOrder).toBeDefined();
    expect(editOrder).toBeDefined();
    expect(acknowledgementOrder!).toBeLessThan(editOrder!);
  });

  it('messageId保存前の投票でもcomponent messageを更新する', async () => {
    const pending = makeSnapshot({ messageId: null, upvotes: 4 });
    const { context, edit } = createVoteContext([pending]);
    const componentEdit = vi.fn(async () => undefined);
    const interaction = createVoteInteraction(
      vi.fn(async () => undefined),
      {
        id: '999',
        edit: componentEdit,
      },
    );

    await executeVote(context, interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(componentEdit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('👍 4') }),
    );
    expect(edit).not.toHaveBeenCalled();
  });

  it('投票ackが失敗しても公開メッセージ再同期後に元のエラーを返す', async () => {
    const pending = makeSnapshot({ upvotes: 4 });
    const { context, edit } = createVoteContext([pending]);
    const acknowledgementError = new Error('Discord interaction expired');
    const interaction = createVoteInteraction(
      vi.fn(async () => Promise.reject(acknowledgementError)),
    );

    await expect(executeVote(context, interaction)).rejects.toBe(acknowledgementError);

    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('👍 4') }),
    );
  });
});
