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

describe('Suggestion message reconciliation', () => {
  it('再同期中に取下げが確定しても最後はwithdrawn表示へ収束する', async () => {
    let txQueryCount = 0;
    const tx = {
      $queryRaw: vi.fn(async () => {
        txQueryCount += 1;
        return txQueryCount === 1 ? [{ votingEnabled: true, status: 'pending' }] : [];
      }),
      $executeRaw: vi.fn(async () => 1),
    };
    const pending = makeSnapshot({ upvotes: 4 });
    const newerPending = makeSnapshot({ upvotes: 5 });
    const withdrawn = makeSnapshot({ status: 'withdrawn', upvotes: 5 });
    let rootQueryCount = 0;
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: vi.fn(async () => {
        rootQueryCount += 1;
        if (rootQueryCount === 1) return [pending];
        if (rootQueryCount === 2) return [newerPending];
        return [withdrawn];
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
    const update = vi.fn(async () => undefined);
    const interaction = {
      guildId: '123',
      customId: `herta:suggestion:v1:vote:${ID}:up`,
      user: { id: '777' },
      isButton: () => true,
      reply: vi.fn(async () => undefined),
      update,
    };
    const event = suggestionPlugin.provideEvents?.(context as never)[0];
    if (!event) throw new Error('Suggestion event is not available');

    await event.handler(context as never, interaction as never);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('👍 4') }),
    );
    expect(edit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ content: expect.stringContaining('👍 5') }),
    );
    expect(edit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: expect.stringContaining('↩️ 取下げ'),
        components: [],
      }),
    );
    expect(rootQueryCount).toBeGreaterThanOrEqual(4);
  });
});
