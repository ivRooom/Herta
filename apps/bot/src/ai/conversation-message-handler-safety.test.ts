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
    expect(resolveAiConversationGroundingState('ソースコードって何？')).toBe('not_required');
  });

  it('今日のニュースと具体的なPR状態はinsufficientにする', () => {
    expect(resolveAiConversationGroundingState('今日のニュースを教えて')).toBe('insufficient');
    expect(resolveAiConversationGroundingState('PR #351の状態は？')).toBe('insufficient');
  });

  it('現在語の語順と暗黙live queryをsource不足へfail closedする', () => {
    expect(resolveAiConversationGroundingState('Bitcoin price today?')).toBe('insufficient');
    expect(resolveAiConversationGroundingState('What is the weather now?')).toBe('insufficient');
    expect(resolveAiConversationGroundingState('東京の天気は？')).toBe('insufficient');
  });

  it('一般的なrepository操作やversion管理はlive stateと誤判定しない', () => {
    expect(resolveAiConversationGroundingState('GitHubでPRをmergeする手順を教えて')).toBe('not_required');
    expect(resolveAiConversationGroundingState('repositoryのversion管理を説明して')).toBe('not_required');
  });

  it('source依存artifact requestはproviderを呼ばず成果物生成を拒否する', async () => {
    const service: AiRuntimeGenerationService = {
      generate: vi.fn(async (): Promise<AiGenerationResponse> => ({
        requestId: 'request-1',
        provider: 'openai',
        model: 'gpt-5.6-terra',
        text: 'unused',
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        estimatedCost: 0.0001,
      })),
    };
    const reply = vi.fn<AiArtifactDiscordMessage['reply']>(async () => undefined);
    const runtime = new AiArtifactRuntime({
      generationService: service,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });
    const sourceDependentMessage = message(reply);
    sourceDependentMessage.content = '<@123456789> https://example.com/project を元にREADMEを作って';

    const result = await handleAiConversationMessage(sourceDependentMessage, {
      runtime,
      generationService: service,
      botUserId: '123456789',
      getAiPluginConfig: vi.fn(async () => ({ enabled: true })),
    });

    expect(result).toEqual({ status: 'failed', category: 'grounding:insufficient' });
    expect(service.generate).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]?.[0]).toEqual({
      content: 'この依頼には外部情報の確認が必要ですが、現在は参照できません。成果物は作成していません。',
      allowedMentions: { parse: [] },
    });
  });
});
