import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiArtifactDiscordMessage } from '../ai/artifact-message-handler.js';
import { aiPlugin, normalizeAiPluginConfig, type AiPluginConfig } from './ai.js';

const BOT_USER_ID = '123456789';
const OTHER_BOT_ID = '999999999';
const OTHER_USER_ID = '555555555';

const handleAiConversationMessageMock = vi.fn();
const createAiFoundationRuntimeMock = vi.fn();
const getAiUsageAnalyticsMock = vi.fn();

vi.mock('../ai/conversation-message-handler.js', () => ({
  handleAiConversationMessage: (...args: unknown[]) => handleAiConversationMessageMock(...args),
}));

vi.mock('../ai/factory.js', () => ({
  createAiFoundationRuntime: (...args: unknown[]) => createAiFoundationRuntimeMock(...args),
}));

vi.mock('@herta/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@herta/db')>();
  return {
    ...actual,
    getAiUsageAnalytics: (...args: unknown[]) => getAiUsageAnalyticsMock(...args),
  };
});

vi.mock('ioredis', () => {
  class FakeRedis {
    on(): void {}
    disconnect(): void {}
    async quit(): Promise<void> {}
  }
  return { Redis: FakeRedis };
});

type Ctx = PluginRuntimeContext<AiPluginConfig, Client, PrismaClient>;

function createContext(
  configOverrides: Partial<AiPluginConfig> = {},
  prisma: PrismaClient = {} as PrismaClient,
): Ctx {
  return {
    client: { user: { id: BOT_USER_ID } } as unknown as Client,
    prisma,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    guildId: 'guild-1',
    config: { enabled: true, triggerRoleId: null, ...configOverrides },
    manifest: { id: 'ai' } as never,
  };
}

/** aiUserModelPreferenceのみをin-memoryで実装する最小限のPrismaClientモック。 */
function createFakeModelPreferencePrisma(): PrismaClient {
  const store = new Map<string, { provider: string; modelProfile: string }>();
  const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
  return {
    aiUserModelPreference: {
      findUnique: vi.fn(
        async ({ where }: { where: { guildId_userId: { guildId: string; userId: string } } }) => {
          const { guildId, userId } = where.guildId_userId;
          const record = store.get(key(guildId, userId));
          return record ? { guildId, userId, ...record, updatedAt: new Date() } : null;
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { guildId_userId: { guildId: string; userId: string } };
          create: { guildId: string; userId: string; provider: string; modelProfile: string };
        }) => {
          const { guildId, userId } = where.guildId_userId;
          store.set(key(guildId, userId), {
            provider: create.provider,
            modelProfile: create.modelProfile,
          });
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { guildId: string; userId: string } }) => {
        const existed = store.delete(key(where.guildId, where.userId));
        return { count: existed ? 1 : 0 };
      }),
    },
  } as unknown as PrismaClient;
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

describe('normalizeAiPluginConfig', () => {
  it('既定値は全機能trueで、triggerRoleIdは未設定ならnull。mcpEnabledのみ既定false', () => {
    expect(normalizeAiPluginConfig({ enabled: true })).toEqual({
      enabled: true,
      triggerRoleId: null,
      imageGenerationEnabled: true,
      codeExecutionEnabled: true,
      weatherGroundingEnabled: true,
      premiumModelRoleId: null,
      mcpEnabled: false,
    });
  });

  it('各機能別トグルを明示的にfalseへできる', () => {
    const config = normalizeAiPluginConfig({
      enabled: true,
      imageGenerationEnabled: false,
      codeExecutionEnabled: false,
      weatherGroundingEnabled: false,
    });
    expect(config.imageGenerationEnabled).toBe(false);
    expect(config.codeExecutionEnabled).toBe(false);
    expect(config.weatherGroundingEnabled).toBe(false);
  });

  it('mcpEnabledはtrueを明示しない限りfalseになる(新機能のため例外的にオプトイン)', () => {
    expect(normalizeAiPluginConfig({ enabled: true }).mcpEnabled).toBe(false);
    expect(normalizeAiPluginConfig({ enabled: true, mcpEnabled: true }).mcpEnabled).toBe(true);
    expect(normalizeAiPluginConfig({ enabled: true, mcpEnabled: false }).mcpEnabled).toBe(false);
  });

  it('enabledはtrueを明示しない限りfalseになる(オプトイン)', () => {
    expect(normalizeAiPluginConfig({ enabled: false }).enabled).toBe(false);
  });
});

describe('/ai ask command', () => {
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
  });

  function getAskHandler(ctx: Ctx) {
    const commands = aiPlugin.provideCommands?.(ctx) ?? [];
    const command = commands.find((candidate) => candidate.definition.name === 'ai');
    if (!command) throw new Error('/ai ask handler is not registered');
    return command;
  }

  function createAskInteraction(prompt: string | null): ChatInputCommandInteraction {
    return {
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'user-1' },
      member: { id: 'user-1', roles: { cache: { has: () => false } } },
      options: { getString: () => prompt, getSubcommand: () => 'ask' },
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
    } as unknown as ChatInputCommandInteraction;
  }

  it('promptをHerta mention形式の合成messageへ変換して会話handlerへ渡す', async () => {
    const command = getAskHandler(context);
    const interaction = createAskInteraction('こんにちは');

    await command.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(handleAiConversationMessageMock).toHaveBeenCalledTimes(1);
    const [message] = handleAiConversationMessageMock.mock.calls[0] as [AiArtifactDiscordMessage];
    expect(message.content).toBe(`<@${BOT_USER_ID}> こんにちは`);
    expect(message.mentions.users.has(BOT_USER_ID)).toBe(true);
  });

  it('Pluginが無効ならephemeralで案内し会話handlerを呼ばない', async () => {
    context = createContext({ enabled: false });
    const command = getAskHandler(context);
    const interaction = createAskInteraction('こんにちは');

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('無効') }),
    );
    expect(handleAiConversationMessageMock).not.toHaveBeenCalled();
  });

  it('空のpromptはephemeralで案内し会話handlerを呼ばない', async () => {
    const command = getAskHandler(context);
    const interaction = createAskInteraction('   ');

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('prompt') }),
    );
    expect(handleAiConversationMessageMock).not.toHaveBeenCalled();
  });
});

describe('/ai model command', () => {
  function getModelHandler(ctx: Ctx) {
    const commands = aiPlugin.provideCommands?.(ctx) ?? [];
    const command = commands.find((candidate) => candidate.definition.name === 'ai');
    if (!command) throw new Error('/ai model handler is not registered');
    return command;
  }

  function createModelInteraction(options: {
    action: string;
    provider?: string | null;
    profile?: string | null;
    roleIds?: string[];
  }): ChatInputCommandInteraction {
    const values: Record<string, string | null> = {
      action: options.action,
      provider: options.provider ?? null,
      profile: options.profile ?? null,
    };
    return {
      guildId: 'guild-1',
      user: { id: 'user-1' },
      member: {
        id: 'user-1',
        roles: { cache: { has: (id: string) => (options.roleIds ?? []).includes(id) } },
      },
      options: {
        getSubcommand: () => 'model',
        getString: (name: string) => values[name] ?? null,
      },
      reply: vi.fn(async () => undefined),
    } as unknown as ChatInputCommandInteraction;
  }

  it('action:showは未設定なら「サーバー既定」と案内する', async () => {
    const context = createContext({}, createFakeModelPreferencePrisma());
    const command = getModelHandler(context);
    const interaction = createModelInteraction({ action: 'show' });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('未設定') }),
    );
  });

  it('action:setでbalancedを選ぶとRole不要で保存され、showに反映される', async () => {
    const context = createContext({}, createFakeModelPreferencePrisma());
    const command = getModelHandler(context);

    await command.execute(
      createModelInteraction({ action: 'set', provider: 'anthropic', profile: 'balanced' }),
    );
    const showInteraction = createModelInteraction({ action: 'show' });
    await command.execute(showInteraction);

    expect(showInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Anthropic') }),
    );
  });

  it('premiumModelRoleId未設定ではqualityを誰も選べない', async () => {
    const context = createContext({ premiumModelRoleId: null }, createFakeModelPreferencePrisma());
    const command = getModelHandler(context);
    const interaction = createModelInteraction({
      action: 'set',
      provider: 'openai',
      profile: 'quality',
    });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('誰も利用できません') }),
    );
  });

  it('premiumModelRoleId設定済みでRole未保持ならqualityを拒否する', async () => {
    const context = createContext(
      { premiumModelRoleId: '999999999999999999' },
      createFakeModelPreferencePrisma(),
    );
    const command = getModelHandler(context);
    const interaction = createModelInteraction({
      action: 'set',
      provider: 'openai',
      profile: 'quality',
      roleIds: ['888888888888888888'],
    });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('専用Role') }),
    );
  });

  it('premiumModelRoleIdを保持していればqualityを設定できる', async () => {
    const context = createContext(
      { premiumModelRoleId: '999999999999999999' },
      createFakeModelPreferencePrisma(),
    );
    const command = getModelHandler(context);
    const interaction = createModelInteraction({
      action: 'set',
      provider: 'openai',
      profile: 'quality',
      roleIds: ['999999999999999999'],
    });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('高品質') }),
    );
  });

  it('action:clearで個人設定を削除する', async () => {
    const context = createContext({}, createFakeModelPreferencePrisma());
    const command = getModelHandler(context);

    await command.execute(
      createModelInteraction({ action: 'set', provider: 'google', profile: 'economy' }),
    );
    const clearInteraction = createModelInteraction({ action: 'clear' });
    await command.execute(clearInteraction);
    const showInteraction = createModelInteraction({ action: 'show' });
    await command.execute(showInteraction);

    expect(clearInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('解除しました') }),
    );
    expect(showInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('未設定') }),
    );
  });

  it('action:setでprovider/profileどちらか欠けていればephemeralで案内する', async () => {
    const context = createContext({}, createFakeModelPreferencePrisma());
    const command = getModelHandler(context);
    const interaction = createModelInteraction({ action: 'set', provider: 'openai' });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('両方') }),
    );
  });
});

describe('/ai usage command', () => {
  function getUsageHandler(ctx: Ctx) {
    const commands = aiPlugin.provideCommands?.(ctx) ?? [];
    const command = commands.find((candidate) => candidate.definition.name === 'ai');
    if (!command) throw new Error('/ai usage handler is not registered');
    return command;
  }

  function createUsageInteraction(options: {
    days?: number | null;
    hasManageGuild?: boolean;
  }): ChatInputCommandInteraction {
    return {
      guildId: 'guild-1',
      memberPermissions: { has: () => options.hasManageGuild ?? true },
      options: {
        getSubcommand: () => 'usage',
        getInteger: () => options.days ?? null,
      },
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
    } as unknown as ChatInputCommandInteraction;
  }

  beforeEach(() => {
    getAiUsageAnalyticsMock.mockReset();
    getAiUsageAnalyticsMock.mockResolvedValue({
      generatedAt: '2026-10-13T00:00:00.000Z',
      timeZone: 'Asia/Tokyo',
      rangeDays: 7,
      today: { total: 3, succeeded: 3, failed: 0 },
      last7Days: { total: 10, succeeded: 9, failed: 1, successRate: 0.9 },
      range: { total: 10, succeeded: 9, failed: 1, successRate: 0.9, estimatedCostUsd: 0.1234 },
      daily: [],
      byProvider: [
        {
          provider: 'openai',
          total: 10,
          succeeded: 9,
          failed: 1,
          successRate: 0.9,
          estimatedCostUsd: 0.1234,
          inputTokens: 1000,
          outputTokens: 500,
        },
      ],
      errors: [{ errorCategory: 'rate_limited', total: 1 }],
    });
  });

  it('ManageGuild権限が無ければ拒否する', async () => {
    const context = createContext();
    const command = getUsageHandler(context);
    const interaction = createUsageInteraction({ hasManageGuild: false });

    await command.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('サーバーの管理') }),
    );
    expect(getAiUsageAnalyticsMock).not.toHaveBeenCalled();
  });

  it('ManageGuild権限があればguildIdでscopeしてusage analyticsを取得し表示する', async () => {
    const context = createContext();
    const command = getUsageHandler(context);
    const interaction = createUsageInteraction({ hasManageGuild: true, days: 14 });

    await command.execute(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: expect.anything() }),
    );
    expect(getAiUsageAnalyticsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ days: 14, guildIds: ['guild-1'] }),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it('daysを省略すると既定7日で取得する', async () => {
    const context = createContext();
    const command = getUsageHandler(context);
    const interaction = createUsageInteraction({ hasManageGuild: true });

    await command.execute(interaction);

    expect(getAiUsageAnalyticsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ days: 7 }),
    );
  });

  it('取得失敗時はエラーメッセージへeditReplyする', async () => {
    getAiUsageAnalyticsMock.mockRejectedValueOnce(new Error('db down'));
    const context = createContext();
    const command = getUsageHandler(context);
    const interaction = createUsageInteraction({ hasManageGuild: true });

    await command.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('失敗') }),
    );
  });
});
