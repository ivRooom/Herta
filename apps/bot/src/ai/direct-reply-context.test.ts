import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import {
  getVerifiedAiReplyContext,
  verifyAiReplyToBot,
  type AiArtifactDiscordMessage,
} from './artifact-message-handler.js';
import type { AiCodeExecutionService } from './code-execution-service.js';
import {
  withAiDirectReplyCodeExecutionContext,
  withAiDirectReplyContext,
  withAiDirectReplyImageGenerationContext,
} from './direct-reply-context.js';
import type { AiImageGenerationService } from './image-generation-service.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

type GenerationRequest = Parameters<AiRuntimeGenerationService['generate']>[0];
type RateLimitRequest = Parameters<NonNullable<AiRuntimeGenerationService['consumeRateLimit']>>[0];
type CodeExecutionRequest = Parameters<AiCodeExecutionService['execute']>[0];
type ImageGenerationRequest = Parameters<AiImageGenerationService['generate']>[0];

function generationResponse(): AiGenerationResponse {
  return {
    requestId: 'request-1',
    provider: 'openai',
    model: 'gpt-5.6-terra',
    text: '詳しく話すね。',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    estimatedCost: 0.0001,
  };
}

function artifactGenerationResponse(): AiGenerationResponse {
  return {
    ...generationResponse(),
    text: JSON.stringify({
      artifacts: [
        {
          filename: 'README.md',
          mimeType: 'text/markdown',
          content: '# README\n',
        },
      ],
    }),
  };
}

function directReply(referencedContent: string): AiArtifactDiscordMessage {
  return {
    guildId: 'guild-1',
    content: 'それを詳しく',
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: { users: { has: () => false } },
    reference: { messageId: 'herta-message-1' },
    fetchReference: vi.fn(async () => ({
      guildId: 'guild-1',
      author: { id: '123456789' },
      content: referencedContent,
    })),
    reply: vi.fn(async () => undefined),
  };
}

describe('AI direct reply context', () => {
  it('server-side検証したHerta本文だけを会話contextとしてgenerationへ渡す', async () => {
    const message = directReply('TypeScriptの型安全性について話していたよ。');
    await expect(verifyAiReplyToBot(message, '123456789')).resolves.toBe(true);

    const context = getVerifiedAiReplyContext(message);
    expect(context).toBe('TypeScriptの型安全性について話していたよ。');

    const generate = vi.fn(async (_request: GenerationRequest) => generationResponse());
    const consumeRateLimit = vi.fn(async (_request: RateLimitRequest) => undefined);
    const service: AiRuntimeGenerationService = { generate, consumeRateLimit };
    const contextualService = withAiDirectReplyContext(service, context);

    await contextualService.generate({
      feature: 'ai.conversation',
      input: 'それを詳しく',
      guildId: 'guild-1',
      scopeGuildId: 'guild-1',
      userId: 'user-1',
      authorized: true,
      pluginEnabled: true,
      guildOptIn: true,
      responseMode: 'detailed',
      groundingState: 'not_required',
      trustedInstructions: ['existing trusted instruction'],
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const forwarded = generate.mock.calls[0]?.[0];
    expect(forwarded).toBeDefined();
    if (!forwarded) throw new Error('expected forwarded generation request');
    expect(JSON.parse(forwarded.input)).toEqual({
      referencedHertaMessage: 'TypeScriptの型安全性について話していたよ。',
      currentUserMessage: 'それを詳しく',
    });
    expect(forwarded.trustedInstructions).toContain('existing trusted instruction');
    expect(forwarded.trustedInstructions?.join('\n')).toContain('bounded conversation context');
    expect(forwarded.trustedInstructions?.join('\n')).not.toContain(
      'TypeScriptの型安全性について話していたよ。',
    );

    await contextualService.consumeRateLimit?.({
      input: 'それを詳しく',
      guildId: 'guild-1',
      scopeGuildId: 'guild-1',
      userId: 'user-1',
      authorized: true,
      pluginEnabled: true,
      guildOptIn: true,
    });
    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'それを詳しく' }),
    );
  });

  it('artifact runtimeにもverified contextをuser-input planeのまま渡せる', async () => {
    const generate = vi.fn(async (_request: GenerationRequest) => artifactGenerationResponse());
    const service: AiRuntimeGenerationService = { generate };
    const runtime = new AiArtifactRuntime({
      generationService: withAiDirectReplyContext(service, '前のHerta返答'),
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });

    const result = await runtime.prepare({
      input: 'READMEをMarkdownで作って',
      guildId: 'guild-1',
      scopeGuildId: 'guild-1',
      userId: 'user-1',
      authorized: true,
      pluginEnabled: true,
      guildOptIn: true,
    });

    expect(result.status).toBe('ready');
    expect(generate).toHaveBeenCalledTimes(1);
    const forwarded = generate.mock.calls[0]?.[0];
    expect(forwarded).toBeDefined();
    if (!forwarded) throw new Error('expected forwarded artifact request');
    expect(JSON.parse(forwarded.input)).toEqual({
      referencedHertaMessage: '前のHerta返答',
      currentUserMessage: 'READMEをMarkdownで作って',
    });
    expect(forwarded.trustedInstructions?.join('\n')).not.toContain('前のHerta返答');
  });

  it('Code Interpreterと画像生成にもverified contextをuser-input planeで渡す', async () => {
    const execute = vi.fn(async (_request: CodeExecutionRequest) => {
      throw new Error('captured execution request');
    });
    const executionService: AiCodeExecutionService = { execute };
    const contextualExecutionService = withAiDirectReplyCodeExecutionContext(
      executionService,
      '前のHerta返答',
    );
    if (!contextualExecutionService) throw new Error('expected contextual execution service');

    await expect(
      contextualExecutionService.execute({
        input: 'そのコードを実行して',
        guildId: 'guild-1',
        scopeGuildId: 'guild-1',
        userId: 'user-1',
        authorized: true,
        pluginEnabled: true,
        guildOptIn: true,
        artifactConfig: { maxBytes: 4096, maxFiles: 2 },
      }),
    ).rejects.toThrow('captured execution request');
    const executionRequest = execute.mock.calls[0]?.[0];
    expect(executionRequest).toBeDefined();
    if (!executionRequest) throw new Error('expected execution request');
    expect(JSON.parse(executionRequest.input)).toEqual({
      referencedHertaMessage: '前のHerta返答',
      currentUserMessage: 'そのコードを実行して',
    });

    const generateImage = vi.fn(async (_request: ImageGenerationRequest) => {
      throw new Error('captured image request');
    });
    const imageGenerationService: AiImageGenerationService = { generate: generateImage };
    const contextualImageGenerationService = withAiDirectReplyImageGenerationContext(
      imageGenerationService,
      '前のHerta返答',
    );
    if (!contextualImageGenerationService) {
      throw new Error('expected contextual image generation service');
    }

    await expect(
      contextualImageGenerationService.generate({
        input: 'その内容で画像を作って',
        guildId: 'guild-1',
        scopeGuildId: 'guild-1',
        userId: 'user-1',
        authorized: true,
        pluginEnabled: true,
        guildOptIn: true,
      }),
    ).rejects.toThrow('captured image request');
    const imageRequest = generateImage.mock.calls[0]?.[0];
    expect(imageRequest).toBeDefined();
    if (!imageRequest) throw new Error('expected image generation request');
    expect(JSON.parse(imageRequest.input)).toEqual({
      referencedHertaMessage: '前のHerta返答',
      currentUserMessage: 'その内容で画像を作って',
    });
  });

  it('referenced Herta本文はDiscord境界内へboundedに保持する', async () => {
    const message = directReply('x'.repeat(2_500));
    await expect(verifyAiReplyToBot(message, '123456789')).resolves.toBe(true);

    expect(getVerifiedAiReplyContext(message)).toHaveLength(1_900);
  });
});
