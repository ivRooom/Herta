import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import type { AiArtifactDiscordMessage } from './artifact-message-handler.js';
import { handleAiConversationMessage } from './conversation-message-handler.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

function createService() {
  const response: AiGenerationResponse = {
    requestId: 'request-1',
    provider: 'openai',
    model: 'gpt-5.6-terra',
    text: '回答です。',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    estimatedCost: 0.0001,
  };
  return {
    generate: vi.fn(async () => response),
  } satisfies AiRuntimeGenerationService;
}

function createOptions(service: AiRuntimeGenerationService, enabled = true) {
  return {
    runtime: new AiArtifactRuntime({
      generationService: service,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    }),
    generationService: service,
    botUserId: '123456789',
    getAiPluginConfig: vi.fn(async () => ({ enabled })),
  };
}

function createMessage(overrides: Partial<AiArtifactDiscordMessage> = {}) {
  const reply = vi.fn<AiArtifactDiscordMessage['reply']>(async () => undefined);
  const message: AiArtifactDiscordMessage = {
    guildId: 'guild-1',
    content: '<@123456789> TypeScriptって何？',
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: { users: { has: (id: string) => id === '123456789' } },
    reply,
    ...overrides,
  };
  return { message, reply };
}

describe('Discord conversation gates', () => {
  it.each([
    ['mentionなし', { content: 'TypeScriptって何？' }],
    ['bot', { author: { id: 'other-bot', bot: true } }],
    ['webhook', { webhookId: 'hook-1' }],
    ['DM', { guildId: null }],
  ])('%s messageではproviderを呼ばない', async (_label, overrides) => {
    const service = createService();
    const { message, reply } = createMessage(overrides as Partial<AiArtifactDiscordMessage>);

    const result = await handleAiConversationMessage(message, createOptions(service));

    expect(result).toEqual({ status: 'ignored' });
    expect(service.generate).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('Guild opt-outではproviderを呼ばない', async () => {
    const service = createService();
    const { message, reply } = createMessage();

    const result = await handleAiConversationMessage(message, createOptions(service, false));

    expect(result).toEqual({ status: 'ignored' });
    expect(service.generate).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('global AI unavailableではsource依存artifactにも返信しない', async () => {
    const service = createService();
    const { message, reply } = createMessage({
      content: '<@123456789> https://example.com/project を元にREADMEを作って',
    });

    const result = await handleAiConversationMessage(message, {
      runtime: null,
      generationService: null,
      botUserId: '123456789',
      getAiPluginConfig: vi.fn(async () => ({ enabled: true })),
    });

    expect(result).toEqual({ status: 'ignored' });
    expect(service.generate).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('provider raw errorをDiscordへ返さない', async () => {
    const service: AiRuntimeGenerationService = {
      generate: vi.fn(async () => {
        throw new Error('PRIVATE-PROVIDER-ERROR-BODY');
      }),
    };
    const { message, reply } = createMessage();

    const result = await handleAiConversationMessage(message, createOptions(service));

    expect(result).toEqual({
      status: 'failed',
      category: 'foundation:internal_error',
    });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(reply.mock.calls[0]?.[0])).not.toContain('PRIVATE-PROVIDER-ERROR-BODY');
  });

  it('Discord delivery failureをsuccess扱いせず二重返信しない', async () => {
    const service = createService();
    const reply = vi.fn<AiArtifactDiscordMessage['reply']>(async () => {
      throw new Error('discord delivery failed');
    });
    const { message } = createMessage({ reply });

    await expect(handleAiConversationMessage(message, createOptions(service))).rejects.toThrow(
      'discord delivery failed',
    );
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
