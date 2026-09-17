import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiArtifactDiscordMessage } from '../ai/artifact-message-handler.js';
import { aiPlugin, type AiPluginConfig } from './ai.js';

const BOT_USER_ID = '123456789';
const OTHER_BOT_ID = '999999999';
const OTHER_USER_ID = '555555555';

const handleAiConversationMessageMock = vi.fn();
const createAiFoundationRuntimeMock = vi.fn();

vi.mock('../ai/conversation-message-handler.js', () => ({
  handleAiConversationMessage: (...args: unknown[]) => handleAiConversationMessageMock(...args),
}));

vi.mock('../ai/factory.js', () => ({
  createAiFoundationRuntime: (...args: unknown[]) => createAiFoundationRuntimeMock(...args),
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    on(): void {}
    disconnect(): void {}
    async quit(): Promise<void> {}
  }
  return { Redis: FakeRedis };
});

type Ctx = PluginRuntimeContext<AiPluginConfig, Client, PrismaClient>;

function createContext(configOverrides: Partial<AiPluginConfig> = {}): Ctx {
  return {
    client: { user: { id: BOT_USER_ID } } as unknown as Client,
    prisma: {} as PrismaClient,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    guildId: 'guild-1',
    config: { enabled: true, triggerRoleId: null, ...configOverrides },
    manifest: { id: 'ai' } as never,
  };
}

type TypingMessage = AiArtifactDiscordMessage & {
  channel: { sendTyping(): Promise<unknown> };
};

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
    reply: vi.fn(async () => undefined),
    channel: { sendTyping },
    ...overrides,
  } as TypingMessage;
}

function getMessageCreateHandler(context: Ctx) {
  const events = aiPlugin.provideEvents?.(context) ?? [];
  const event = events.find((candidate) => candidate.event === 'messageCreate');
  if (!event) throw new Error('messageCreate handler is not registered');
  return event;
}

describe('aiPlugin typing indicator lifecycle', () => {
  let context: Ctx;

  beforeEach(async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    handleAiConversationMessageMock.mockReset();
    createAiFoundationRuntimeMock.mockReset();
    createAiFoundationRuntimeMock.mockResolvedValue({
      service: { generate: vi.fn() },
      executionService: undefined,
      imageGenerationService: undefined,
      status: 'ready',
      credentialSource: 'runtime_secret_store',
    });
    handleAiConversationMessageMock.mockResolvedValue({ status: 'handled', intent: 'chat' });
    context = createContext();
    await aiPlugin.onEnable?.(context);
  });

  afterEach(async () => {
    await aiPlugin.onDisable?.(context);
    vi.useRealTimers();
  });

  it('real Herta mentionでtypingを開始し、処理完了後にrefreshを停止する', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const message = createMessage(sendTyping);
    const event = getMessageCreateHandler(context);

    await event.handler(context, message);

    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(handleAiConversationMessageMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(32_000);
    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it('server-side verified Herta direct replyでtypingを開始する', async () => {
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
        content: '直前の回答',
      }),
    });
    const event = getMessageCreateHandler(context);

    await event.handler(context, message);

    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(handleAiConversationMessageMock).toHaveBeenCalledTimes(1);
  });

  it('candidate外のmentionless messageではtypingもprovider呼び出しも発生しない', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const message = createMessage(sendTyping, {
      content: '今日は良い天気ですね',
      mentions: { users: { has: () => false } },
    });
    const event = getMessageCreateHandler(context);

    await event.handler(context, message);
    await vi.advanceTimersByTimeAsync(16_000);

    expect(sendTyping).not.toHaveBeenCalled();
    expect(createAiFoundationRuntimeMock).not.toHaveBeenCalled();
    expect(handleAiConversationMessageMock).not.toHaveBeenCalled();
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
        author: { id: OTHER_USER_ID },
        content: 'untrusted reference',
      }),
    });
    const event = getMessageCreateHandler(context);

    await event.handler(context, message);

    expect(sendTyping).not.toHaveBeenCalled();
    expect(handleAiConversationMessageMock).not.toHaveBeenCalled();
  });

  it('mentionless other-bot replyではtypingを出さない', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const message = createMessage(sendTyping, {
      content: 'それってどうなの',
      mentions: { users: { has: () => false } },
      reference: { messageId: 'message-1' },
      fetchReference: async () => ({
        guildId: 'guild-1',
        channelId: 'channel-1',
        author: { id: OTHER_BOT_ID },
        content: 'other bot content',
      }),
    });
    const event = getMessageCreateHandler(context);

    await event.handler(context, message);

    expect(sendTyping).not.toHaveBeenCalled();
    expect(handleAiConversationMessageMock).not.toHaveBeenCalled();
  });

  it('provider safe failure後もtyping refreshを確実に停止する', async () => {
    vi.useFakeTimers();
    handleAiConversationMessageMock.mockResolvedValue({
      status: 'failed',
      category: 'provider_error',
    });
    const sendTyping = vi.fn(async () => undefined);
    const message = createMessage(sendTyping);
    const event = getMessageCreateHandler(context);

    await event.handler(context, message);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(32_000);
    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it('typing API failureはAI処理本体を壊さない', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => {
      throw new Error('discord request failed');
    });
    const message = createMessage(sendTyping);
    const event = getMessageCreateHandler(context);

    await expect(event.handler(context, message)).resolves.toBeUndefined();

    expect(handleAiConversationMessageMock).toHaveBeenCalledTimes(1);
  });

  it('複数candidate messageを処理してもshared runtimeは一度だけ初期化される', async () => {
    vi.useFakeTimers();
    const messages = [
      createMessage(vi.fn(async () => undefined)),
      createMessage(
        vi.fn(async () => undefined),
        {
          content: `<@${BOT_USER_ID}> Pythonでコードを書いて`,
        },
      ),
      createMessage(
        vi.fn(async () => undefined),
        {
          content: `<@${BOT_USER_ID}> 画像を生成して`,
        },
      ),
    ];
    const event = getMessageCreateHandler(context);

    for (const message of messages) {
      await event.handler(context, message);
    }

    expect(createAiFoundationRuntimeMock).toHaveBeenCalledTimes(1);
    expect(handleAiConversationMessageMock).toHaveBeenCalledTimes(messages.length);
  });

  it('candidate外messageの後もtimerが残らない', async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn(async () => undefined);
    const ignoredMessage = createMessage(sendTyping, {
      content: 'ただの雑談',
      mentions: { users: { has: () => false } },
    });
    const event = getMessageCreateHandler(context);

    await event.handler(context, ignoredMessage);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sendTyping).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
