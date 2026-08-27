import { describe, expect, it, vi } from 'vitest';
import { isAiArtifactMessageCandidate } from './artifact-message-handler.js';

describe('AI Discord message candidate self safety', () => {
  it('bot user自身のmessageはauthor.bot値に依存せず除外する', () => {
    const botUserId = '123456789';
    const candidate = {
      guildId: 'guild-1',
      content: `<@${botUserId}> hello`,
      webhookId: null,
      author: { id: botUserId, bot: false },
      member: { id: botUserId },
      mentions: { users: { has: (id: string) => id === botUserId } },
      reply: vi.fn(async () => undefined),
    };

    expect(isAiArtifactMessageCandidate(candidate, botUserId)).toBe(false);
  });
});
