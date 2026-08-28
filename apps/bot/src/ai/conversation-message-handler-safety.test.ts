import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import type { AiArtifactDiscordMessage } from './artifact-message-handler.js';
import {
  handleAiConversationMessage,
  resolveAiConversationGroundingState,
} from './conversation-message-handler.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

function message(reply: AiArtifactDiscordMessage['reply']): AiArtifactDiscordMessage {
  return {
    guildId: 'guild-1',
    content: '<@123456789> emojiで答えて',
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: { users: { has: (id: string) => id === '123456789' } },
    reply,
  };
}

describe('Discord conversation delivery bounds', () => {
  it('astral文字をUTF-16単位でboundしDiscordへoversized textを送らない', async () => {
    const service: AiRuntimeGenerationService = {
      generate: vi.fn(async (): Promise<AiGenerationResponse> => ({
        requestId: 'request-1',
        provider: 'openai',
        model: 'gpt-5.6-terra',
        text: '😀'.repeat(1_000),
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        estimatedCost: 0.0001,
      })),
    };
    const reply = vi.fn<AiArtifactDiscordMessage['reply']>(async () => undefined);
    const runtime = new AiArtifactRuntime({
      generationService: service,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });

    const result = await handleAiConversationMessage(message(reply), {
      runtime,
      generationService: service,
      botUserId: '123456789',
      getAiPluginConfig: vi.fn(async () => ({ enabled: true })),
    });

    expect(result).toEqual({ status: 'failed', category: 'foundation:output_too_large' });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]?.[0]?.content).toBe('AIの応答が許容サイズを超えました。');
    expect(reply.mock.calls[0]?.[0]?.content).not.toContain('😀');
  });
});

describe('Discord grounding fail-safe boundary', () => {
  it('一般的なsource code説明はnot_requiredのまま扱う', () => {
    expect(resolveAiConversationGroundingState('source codeって何？')).toBe('not_required');
  });

  it('今日のニュースと具体的なPR状態はinsufficientにする', () => {
    expect(resolveAiConversationGroundingState('今日のニュースを教えて')).toBe('insufficient');
    expect(resolveAiConversationGroundingState('PR #351の状態は？')).toBe('insufficient');
  });

  it.each([
    ["What is Bitcoin's price today?", '現在語がcategoryより後ろにあるprice query'],
    ['What is the weather now?', '現在語がcategoryより後ろにあるweather query'],
    ['東京の天気は？', '現在語を省略したlive weather query'],
  ])('%s をsource不足へfail closedする', (input) => {
    expect(resolveAiConversationGroundingState(input)).toBe('insufficient');
  });
});
