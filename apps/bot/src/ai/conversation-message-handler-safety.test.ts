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
    expect(resolveAiConversationGroundingState('source-codeって何？')).toBe('not_required');
    expect(resolveAiConversationGroundingState('source_codeって何？')).toBe('not_required');
    expect(resolveAiConversationGroundingState('ソースコードって何？')).toBe('not_required');
  });

  it('open source artifactはsource lookupと誤判定しない', () => {
    expect(resolveAiConversationGroundingState('Create an open source README')).toBe(
      'not_required',
    );
    expect(resolveAiConversationGroundingState('オープンソースREADMEを作って')).toBe(
      'not_required',
    );
  });

  it('literal source text artifactはsource lookupと誤判定しない', () => {
    expect(
      resolveAiConversationGroundingState('Create a .txt file containing the word source'),
    ).toBe('not_required');
    expect(resolveAiConversationGroundingState('Give me sources for this claim')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('ソースを教えて')).toBe('insufficient');
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

  it('英語imperative live queryをsource不足へfail closedする', () => {
    expect(resolveAiConversationGroundingState('Give me the weather for Tokyo')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('Tell me the stock price for AAPL')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('Show me the exchange rate for USD/JPY')).toBe(
      'insufficient',
    );
  });

  it('列挙外の明示的な現在情報もsource不足へfail closedする', () => {
    expect(resolveAiConversationGroundingState('Who is the current president of France?')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('What was the score today?')).toBe('insufficient');
    expect(resolveAiConversationGroundingState('What time is it now?')).toBe('insufficient');
    expect(resolveAiConversationGroundingState('現在時刻は？')).toBe('insufficient');
  });

  it('current値を取得または入力で受けるコード生成は外部事実の回答と誤判定しない', () => {
    expect(
      resolveAiConversationGroundingState('Write Python code that prints the current time'),
    ).toBe('not_required');
    expect(
      resolveAiConversationGroundingState(
        'Write Python code that displays the current stock price passed in as an argument',
      ),
    ).toBe('not_required');
    expect(
      resolveAiConversationGroundingState(
        'Write Python code with the current AAPL stock price hard-coded',
      ),
    ).toBe('insufficient');
  });

  it('liveカテゴリを含む一般説明はnot_requiredのまま扱う', () => {
    expect(resolveAiConversationGroundingState('How does weather forecasting work?')).toBe(
      'not_required',
    );
    expect(resolveAiConversationGroundingState('What causes stock prices to change?')).toBe(
      'not_required',
    );
    expect(resolveAiConversationGroundingState('What is electric current?')).toBe('not_required');
  });

  it('local lookupは外部検索と誤判定しない', () => {
    expect(
      resolveAiConversationGroundingState('Write Python code to look up a key in a dictionary'),
    ).toBe('not_required');
    expect(resolveAiConversationGroundingState('Look up the Herta release notes')).toBe(
      'insufficient',
    );
  });

  it('一般的なrepository操作やversion管理はlive stateと誤判定しない', () => {
    expect(resolveAiConversationGroundingState('GitHubでPRをmergeする手順を教えて')).toBe(
      'not_required',
    );
    expect(resolveAiConversationGroundingState('repositoryのversion管理を説明して')).toBe(
      'not_required',
    );
  });

  it('URL文字列だけを変換する依頼は外部参照扱いにしない', () => {
    expect(
      resolveAiConversationGroundingState('Create a text file containing https://example.com'),
    ).toBe('not_required');
    expect(
      resolveAiConversationGroundingState('Turn https://example.com into a Markdown link'),
    ).toBe('not_required');
  });

  it('URL内容を直接尋ねる依頼はsource不足へfail closedする', () => {
    expect(resolveAiConversationGroundingState('What does https://example.com say?')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('What is on https://example.com?')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('Tell me what is on https://example.com')).toBe(
      'insufficient',
    );
    expect(resolveAiConversationGroundingState('Can you inspect https://example.com?')).toBe(
      'insufficient',
    );
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
    sourceDependentMessage.content =
      '<@123456789> https://example.com/project を元にREADMEを作って';

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
      content:
        'この依頼には外部情報の確認が必要ですが、現在は参照できません。成果物は作成していません。',
      allowedMentions: { parse: [] },
    });
  });
});
