import { describe, expect, it } from 'vitest';
import { evaluateChannelPolicyMessage, type ChannelPolicyRule } from './channel-policy.js';

function makeLinksOnlyRule(): ChannelPolicyRule {
  return {
    enabled: true,
    channelId: '1234567890',
    mode: 'links_only',
    action: 'log_only',
    allowCaption: true,
    allowStickers: false,
    includeThreads: true,
    exemptRoleIds: [],
    exemptUserIds: [],
    warningMessage: null,
  };
}

function makeMessage(content: string) {
  return {
    content,
    attachments: {
      size: 0,
      values: () => [][Symbol.iterator](),
    },
    stickers: { size: 0 },
  };
}

describe('Channel Policy links_only', () => {
  it('DiscordのMasked Linkだけの投稿を許可する', () => {
    expect(
      evaluateChannelPolicyMessage(
        makeMessage('[OpenAI](https://example.com/path)'),
        makeLinksOnlyRule(),
      ).allowed,
    ).toBe(true);
  });

  it('Masked Link以外の本文があれば拒否する', () => {
    expect(
      evaluateChannelPolicyMessage(
        makeMessage('おすすめ [OpenAI](https://example.com/path)'),
        makeLinksOnlyRule(),
      ).allowed,
    ).toBe(false);
  });
});
