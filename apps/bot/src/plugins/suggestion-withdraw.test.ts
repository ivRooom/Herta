import { describe, expect, it, vi } from 'vitest';
import {
  buildSuggestionMessage,
  normalizeSuggestionConfig,
  suggestionPlugin,
} from './suggestion.js';
import {
  updateSuggestionStatus,
  withdrawSuggestion,
  type SuggestionSnapshot,
} from './suggestion-repository.js';

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
    upvotes: 3,
    downvotes: 1,
    createdAt: new Date('2026-08-11T05:00:00.000Z'),
    ...overrides,
  };
}

describe('Suggestion author withdraw', () => {
  it('withdraw subcommandを公開する', () => {
    const withdraw = suggestionPlugin.manifest.commands[0]?.subcommands?.find(
      (subcommand) => subcommand.name === 'withdraw',
    );
    expect(withdraw).toMatchObject({
      name: 'withdraw',
      options: [{ name: 'id', type: 'string', required: true }],
    });
  });

  it('取下げ済みSuggestionでは投票Buttonを表示しない', () => {
    const message = buildSuggestionMessage(makeSnapshot({ status: 'withdrawn' }));
    expect(message.content).toContain('↩️ 取下げ');
    expect(message.components).toHaveLength(0);
  });

  it('投稿者本人がpendingを取下げるとAuditを同一transactionで記録する', async () => {
    const txQueryRaw = vi.fn(async () => [{ authorId: '456', status: 'pending' }]);
    const txExecuteRaw = vi.fn(async () => 1);
    const auditCreate = vi.fn(async () => undefined);
    const snapshot = makeSnapshot({ status: 'withdrawn' });
    const rootQueryRaw = vi.fn(async () => [snapshot]);
    const tx = {
      $queryRaw: txQueryRaw,
      $executeRaw: txExecuteRaw,
      auditLog: { create: auditCreate },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: rootQueryRaw,
    };

    const result = await withdrawSuggestion(prisma as never, {
      id: ID,
      guildId: '123',
      authorId: '456',
    });

    expect(result).toEqual({ outcome: 'withdrawn', snapshot });
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guildId: '123',
        actorId: '456',
        event: 'suggestion.withdraw',
        targetType: 'suggestion',
        targetId: ID,
        changes: { before: { status: 'pending' }, after: { status: 'withdrawn' } },
        metadata: { operationSource: 'discord' },
      }),
    });
  });

  it('取下げ再実行はidempotentでAuditを二重生成しない', async () => {
    const auditCreate = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: vi.fn(async () => [{ authorId: '456', status: 'withdrawn' }]),
      $executeRaw: vi.fn(async () => 1),
      auditLog: { create: auditCreate },
    };
    const snapshot = makeSnapshot({ status: 'withdrawn' });
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: vi.fn(async () => [snapshot]),
    };

    const result = await withdrawSuggestion(prisma as never, {
      id: ID,
      guildId: '123',
      authorId: '456',
    });

    expect(result.outcome).toBe('already_withdrawn');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('取下げ再実行時に公開メッセージを取下げ状態へ再同期する', async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ authorId: '456', status: 'withdrawn' }]),
      $executeRaw: vi.fn(async () => 1),
      auditLog: { create: vi.fn(async () => undefined) },
    };
    const snapshot = makeSnapshot({ status: 'withdrawn' });
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: vi.fn(async () => [snapshot]),
    };
    const edit = vi.fn(async () => undefined);
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
      prisma,
      logger: { warn: vi.fn() },
      guildId: '123',
      config: normalizeSuggestionConfig(undefined),
      manifest: suggestionPlugin.manifest,
    };
    const interaction = {
      guildId: '123',
      channelId: '789',
      channel: null,
      user: { id: '456' },
      options: {
        getSubcommand: () => 'withdraw',
        getString: (name: string) => (name === 'id' ? ID : null),
      },
      reply,
      followUp: vi.fn(async () => undefined),
    };
    const command = suggestionPlugin.provideCommands?.(context as never)[0];
    if (!command) throw new Error('Suggestion command is not available');

    await command.execute(interaction as never);

    expect(reply).toHaveBeenCalledWith({
      content: `Suggestion \`${ID}\` はすでに取り下げ済みです。`,
      flags: 64,
      allowedMentions: { parse: [] },
    });
    expect(fetchChannel).toHaveBeenCalledWith('789');
    expect(fetchMessage).toHaveBeenCalledWith('999');
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('↩️ 取下げ'),
        components: [],
      }),
    );
  });

  it('処理済みSuggestionは投稿者本人でも取下げできない', async () => {
    const auditCreate = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: vi.fn(async () => [{ authorId: '456', status: 'accepted' }]),
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

    const result = await withdrawSuggestion(prisma as never, {
      id: ID,
      guildId: '123',
      authorId: '456',
    });

    expect(result).toEqual({ outcome: 'not_withdrawable', snapshot: null });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(rootQueryRaw).not.toHaveBeenCalled();
  });

  it('第三者は取下げできずSuggestion内容も再照会しない', async () => {
    const auditCreate = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: vi.fn(async () => [{ authorId: '456', status: 'pending' }]),
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

    const result = await withdrawSuggestion(prisma as never, {
      id: ID,
      guildId: '123',
      authorId: '777',
    });

    expect(result).toEqual({ outcome: 'not_found_or_forbidden', snapshot: null });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(rootQueryRaw).not.toHaveBeenCalled();
  });

  it('Staff status更新ではwithdrawnを復活させない', async () => {
    const queryRaw = vi.fn(async () => []);
    const prisma = { $queryRaw: queryRaw };

    const result = await updateSuggestionStatus(prisma as never, {
      id: ID,
      guildId: '123',
      status: 'accepted',
      staffNote: null,
    });

    expect(result).toBeNull();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
