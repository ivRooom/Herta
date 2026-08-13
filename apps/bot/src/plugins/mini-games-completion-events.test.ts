import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emitMiniGameCompletion,
  miniGameCompletionSubscriberCount,
  subscribeMiniGameCompletion,
  unsubscribeMiniGameCompletion,
} from './mini-games-completion-events.js';

const subscriberIds = ['test:first', 'test:second'];

afterEach(() => {
  for (const id of subscriberIds) unsubscribeMiniGameCompletion(id);
});

describe('Mini Games completion events', () => {
  it('戦績確定後に呼び出せる明示イベントで購読者へ通知する', async () => {
    const reply = vi.fn(async () => undefined);
    const called: string[] = [];
    subscribeMiniGameCompletion('test:first', async (event) => {
      called.push(`${event.guildId}:${event.userId}`);
      await event.reply({ content: 'Achievement unlocked' });
    });

    await emitMiniGameCompletion({
      guildId: 'guild-1',
      userId: 'user-1',
      guild: null,
      reply,
    });

    expect(called).toEqual(['guild-1:user-1']);
    expect(reply).toHaveBeenCalledWith({ content: 'Achievement unlocked' });
  });

  it('購読解除後は同じGuildの処理を残さない', async () => {
    const handler = vi.fn(async () => undefined);
    subscribeMiniGameCompletion('test:second', handler);
    expect(miniGameCompletionSubscriberCount()).toBe(1);
    unsubscribeMiniGameCompletion('test:second');
    expect(miniGameCompletionSubscriberCount()).toBe(0);

    await emitMiniGameCompletion({
      guildId: 'guild-1',
      userId: 'user-1',
      guild: null,
      reply: async () => undefined,
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
