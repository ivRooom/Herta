import type { Logger } from '@herta/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  verifyAiReplyToBot,
  type AiArtifactDiscordMessage,
} from './artifact-message-handler.js';
import { startAiTypingIndicator } from './typing-indicator.js';

const BOT_USER_ID = '123456789';

type TypingMessage = AiArtifactDiscordMessage & {
  channel: { sendTyping(): Promise<unknown> };
};

function createLogger() {
  return { warn: vi.fn() } as unknown as Pick<Logger, 'warn'>;
}

function createMessage(
  sendTyping: () => Promise<unknown>,
  overrides: Partial<AiArtifactDiscordMessage> = {},
): TypingMessage {
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    content: `<@${BOT_USER_ID}> こんにちは`,
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: { users: { has: (id: string) => id === BOT_USER_ID } },
    reply: async () => undefined,
    channel: { sendTyping },
    ...overrides,
  } as TypingMessage;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AI Discord typing indicator', () => {
  it('real Herta mentionだけでtypingを開始し、処理中はrefreshする', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const logger = createLogger();
    const indicator = startAiTypingIndicator(createMessage(sendTyping), BOT_USER_ID, logger);

    await vi.advanceTimersByTimeAsync(0);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    indicator.stop();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendTyping).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('server-side verified Herta direct replyでもtypingを開始する', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const message = createMessage(sendTyping, {
      content: 'それをもう少し詳しく',
      mentions: { users: { has: () => false } },
      reference: { messageId: 'message-1' },
      fetchReference: async () => ({
        guildId: 'guild-1',
        channelId: 'channel-1',
        author: { id: BOT_USER_ID },
        content: 'TypeScriptはJavaScriptに型を追加した言語だよ。',
      }),
    });

    expect(await verifyAiReplyToBot(message, BOT_USER_ID)).toBe(true);
    const indicator = startAiTypingIndicator(message, BOT_USER_ID, createLogger());

    await vi.advanceTimersByTimeAsync(0);
    expect(sendTyping).toHaveBeenCalledTimes(1);
    indicator.stop();
  });

  it('通常のmentionless messageではtypingを出さない', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const indicator = startAiTypingIndicator(
      createMessage(sendTyping, {
        content: 'これは普通のメッセージ',
        mentions: { users: { has: () => false } },
      }),
      BOT_USER_ID,
      createLogger(),
    );

    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendTyping).not.toHaveBeenCalled();
    indicator.stop();
  });

  it('mentionless other-user replyではtypingを出さない', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const message = createMessage(sendTyping, {
      content: 'これどう思う？',
      mentions: { users: { has: () => false } },
      reference: { messageId: 'message-1' },
      fetchReference: async () => ({
        guildId: 'guild-1',
        channelId: 'channel-1',
        author: { id: 'other-user' },
        content: 'untrusted reference',
      }),
    });

    expect(await verifyAiReplyToBot(message, BOT_USER_ID)).toBe(false);
    const indicator = startAiTypingIndicator(message, BOT_USER_ID, createLogger());

    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendTyping).not.toHaveBeenCalled();
    indicator.stop();
  });

  it('typing API failureはraw errorを保持せずrefreshだけ停止する', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => {
      throw new Error('discord request failed');
    });
    const logger = createLogger();
    const indicator = startAiTypingIndicator(createMessage(sendTyping), BOT_USER_ID, logger);

    await vi.advanceTimersByTimeAsync(0);
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        guildId: 'guild-1',
        errorName: 'Error',
        result: 'typing_failed',
      },
      'AI Discord typing indicatorの送信に失敗しました',
    );

    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendTyping).toHaveBeenCalledTimes(1);
    indicator.stop();
  });
});
