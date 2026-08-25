import { describe, expect, it, vi } from 'vitest';
import { normalizeSuggestionConfig, suggestionPlugin } from './suggestion.js';
import type { SuggestionSnapshot } from './suggestion-repository.js';

const ID = '11111111-1111-4111-8111-111111111111';

function makeSnapshot(): SuggestionSnapshot {
  return {
    id: ID,
    guildId: '123',
    authorId: '456',
    channelId: '789',
    messageId: '999',
    content: '状態更新後も公開表示を同期する',
    anonymous: false,
    votingEnabled: true,
    status: 'accepted',
    staffNote: '採用します',
    upvotes: 4,
    downvotes: 1,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
  };
}

describe('Suggestion status acknowledgement failure', () => {
  it('ephemeral応答が失敗しても公開メッセージを再同期してから元のエラーを返す', async () => {
    const snapshot = makeSnapshot();
    const tx = {
      $queryRaw: vi.fn(async () => [{ status: 'pending', staffNote: null }]),
      $executeRaw: vi.fn(async () => 1),
      auditLog: { create: vi.fn(async () => undefined) },
    };
    const queryRaw = vi.fn(async () => [snapshot]);
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: queryRaw,
    };
    const edit = vi.fn(async () => undefined);
    const fetchMessage = vi.fn(async () => ({ id: '999', edit }));
    const fetchChannel = vi.fn(async () => ({
      isTextBased: () => true,
      messages: { fetch: fetchMessage },
    }));
    const replyError = new Error('Interaction expired');
    const reply = vi.fn(async () => {
      throw replyError;
    });
    const context = {
      client: {
        channels: { fetch: fetchChannel },
        users: { fetch: vi.fn() },
      },
      prisma,
      logger: { warn: vi.fn() },
      guildId: '123',
      config: normalizeSuggestionConfig({ notifyAuthorOnStatusChange: false }),
      manifest: suggestionPlugin.manifest,
    };
    const interaction = {
      guildId: '123',
      channelId: '789',
      channel: null,
      user: { id: 'staff' },
      memberPermissions: { has: () => true },
      member: null,
      options: {
        getSubcommand: () => 'status',
        getString: (name: string) => {
          if (name === 'id') return ID;
          if (name === 'status') return 'accepted';
          if (name === 'note') return '採用します';
          return null;
        },
      },
      reply,
      followUp: vi.fn(async () => undefined),
    };
    const command = suggestionPlugin.provideCommands?.(context as never)[0];
    if (!command) throw new Error('Suggestion command is not available');

    await expect(command.execute(interaction as never)).rejects.toBe(replyError);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(fetchChannel).toHaveBeenCalledWith('789');
    expect(fetchMessage).toHaveBeenCalledWith('999');
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('✅ 採用'),
        components: [],
      }),
    );
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
