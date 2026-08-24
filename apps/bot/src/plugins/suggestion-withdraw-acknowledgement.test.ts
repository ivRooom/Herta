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
    content: '公開表示も取下げ状態へ同期する',
    anonymous: false,
    votingEnabled: true,
    status: 'withdrawn',
    staffNote: null,
    upvotes: 2,
    downvotes: 0,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
  };
}

describe('Suggestion withdraw acknowledgement failure', () => {
  it('ephemeral応答が失敗しても公開メッセージを再同期してから元のエラーを返す', async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ authorId: '456', status: 'pending' }]),
      $executeRaw: vi.fn(async () => 1),
      auditLog: { create: vi.fn(async () => undefined) },
    };
    const snapshot = makeSnapshot();
    const rootQueryRaw = vi.fn(async (..._args: unknown[]) => [snapshot]);
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: rootQueryRaw,
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

    await expect(command.execute(interaction as never)).rejects.toBe(replyError);

    expect(fetchChannel).toHaveBeenCalledWith('789');
    expect(fetchMessage).toHaveBeenCalledWith('999');
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('↩️ 取下げ'),
        components: [],
      }),
    );
    expect(rootQueryRaw).toHaveBeenCalledTimes(2);
  });
});
