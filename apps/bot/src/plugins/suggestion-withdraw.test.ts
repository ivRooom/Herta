import { describe, expect, it, vi } from 'vitest';
import { buildSuggestionMessage, suggestionPlugin } from './suggestion.js';
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
