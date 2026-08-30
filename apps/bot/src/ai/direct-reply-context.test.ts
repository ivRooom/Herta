import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import {
  getVerifiedAiReplyContext,
  verifyAiReplyToBot,
  type AiArtifactDiscordMessage,
} from './artifact-message-handler.js';
import { withAiDirectReplyContext } from './direct-reply-context.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

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

    const generate = vi.fn(async () => generationResponse());
    const consumeRateLimit = vi.fn(async () => undefined);
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
    expect(JSON.parse(forwarded?.input ?? '{}')).toEqual({
      referencedHertaMessage: 'TypeScriptの型安全性について話していたよ。',
      currentUserMessage: 'それを詳しく',
    });
    expect(forwarded?.trustedInstructions).toContain('existing trusted instruction');
    expect(forwarded?.trustedInstructions?.join('\n')).toContain('bounded conversation context');
    expect(forwarded?.trustedInstructions?.join('\n')).not.toContain(
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
    const generate = vi.fn(async () => artifactGenerationResponse());
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
    expect(JSON.parse(forwarded?.input ?? '{}')).toEqual({
      referencedHertaMessage: '前のHerta返答',
      currentUserMessage: 'READMEをMarkdownで作って',
    });
    expect(forwarded?.trustedInstructions?.join('\n')).not.toContain('前のHerta返答');
  });

  it('referenced Herta本文はDiscord境界内へboundedに保持する', async () => {
    const message = directReply('x'.repeat(2_500));
    await expect(verifyAiReplyToBot(message, '123456789')).resolves.toBe(true);

    expect(getVerifiedAiReplyContext(message)).toHaveLength(1_900);
  });
});
