import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import {
  handleAiArtifactMessage,
  stripBotMention,
  type DiscordSafeTextReplyOptions,
} from './artifact-message-handler.js';
import type { DiscordArtifactReplyOptions } from './discord-artifact-delivery.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

type ArtifactReply = (
  options: DiscordArtifactReplyOptions | DiscordSafeTextReplyOptions,
) => Promise<unknown>;

function replyMock() {
  return vi.fn<ArtifactReply>(async () => undefined);
}

function successService(source = 'print("hello")\n'): AiRuntimeGenerationService {
  return {
    generate: vi.fn(async (): Promise<AiGenerationResponse> => ({
      requestId: 'request-1',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      text: JSON.stringify({
        artifacts: [{ filename: 'hello.py', mimeType: 'text/x-python', content: source }],
      }),
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      estimatedCost: 0.0001,
    })),
  };
}

function message(content: string, reply = replyMock()) {
  return {
    guildId: 'guild-1',
    content,
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: { users: { has: (id: string) => id === '123456789' } },
    reply,
  };
}

function options(runtime: AiArtifactRuntime | null) {
  return {
    runtime,
    botUserId: '123456789',
    getAiPluginConfig: vi.fn(async () => ({ enabled: true })),
  };
}

describe('artifact Discord mention handler', () => {
  it('validated artifactだけを短い本文 + attachmentとして返信する', async () => {
    const source = 'print("complete source")\n';
    const runtime = new AiArtifactRuntime({
      generationService: successService(source),
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });
    const reply = replyMock();

    const result = await handleAiArtifactMessage(
      message('<@123456789> Pythonコードを書いて', reply),
      options(runtime),
    );

    expect(result).toEqual({ status: 'handled', intent: 'code_artifact' });
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0]?.[0];
    expect(payload?.content).toBe('作成しました。`hello.py` を添付します。');
    expect(payload?.content).not.toContain(source);
    expect('files' in (payload ?? {})).toBe(true);
    if (!payload || !('files' in payload)) throw new Error('expected files payload');
    expect(payload.files[0]?.attachment.toString('utf8')).toBe(source);
  });

  it('artifact生成失敗時は成功messageを返さない', async () => {
    const generationService: AiRuntimeGenerationService = {
      generate: vi.fn(async (): Promise<AiGenerationResponse> => ({
        requestId: 'request-1',
        provider: 'openai',
        model: 'gpt-5.6-terra',
        text: JSON.stringify({
          artifacts: [
            {
              filename: '../unsafe.py',
              mimeType: 'text/x-python',
              content: 'print(1)',
            },
          ],
        }),
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        estimatedCost: 0,
      })),
    };
    const runtime = new AiArtifactRuntime({
      generationService,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });
    const reply = replyMock();

    const result = await handleAiArtifactMessage(
      message('<@123456789> Pythonコードを書いて', reply),
      options(runtime),
    );

    expect(result).toMatchObject({ status: 'failed' });
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0]?.[0];
    expect(payload?.content).toBe('成果物を安全に生成できませんでした。');
    expect(payload?.content).not.toContain('作成しました');
    expect(payload && 'files' in payload).toBe(false);
  });

  it('code_executionは実行せず未実行messageだけを返す', async () => {
    const generationService = successService();
    const runtime = new AiArtifactRuntime({
      generationService,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });
    const reply = replyMock();

    const result = await handleAiArtifactMessage(
      message('<@123456789> Pythonコードを実行して', reply),
      options(runtime),
    );

    expect(result).toEqual({ status: 'handled', intent: 'code_execution' });
    expect(generationService.generate).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]?.content).toContain('実行していません');
    expect(reply.mock.calls[0]?.[0]?.content).not.toContain('作成しました');
  });

  it('chat intentは既存会話surfaceを壊さず無視する', async () => {
    const generationService = successService();
    const runtime = new AiArtifactRuntime({
      generationService,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });
    const reply = replyMock();

    const result = await handleAiArtifactMessage(
      message('<@123456789> おはよう', reply),
      options(runtime),
    );

    expect(result).toEqual({ status: 'ignored' });
    expect(generationService.generate).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('AI plugin opt-inが無効ならproviderを呼ばない', async () => {
    const generationService = successService();
    const runtime = new AiArtifactRuntime({
      generationService,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });
    const reply = replyMock();

    const result = await handleAiArtifactMessage(
      message('<@123456789> Pythonコードを書いて', reply),
      {
        runtime,
        botUserId: '123456789',
        getAiPluginConfig: vi.fn(async () => ({ enabled: false })),
      },
    );

    expect(result).toEqual({ status: 'ignored' });
    expect(generationService.generate).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('stripBotMention', () => {
  it('Discord mentionだけ除去しuser inputを保持する', () => {
    expect(stripBotMention('<@123456789> Pythonコードを書いて', '123456789')).toBe(
      'Pythonコードを書いて',
    );
    expect(stripBotMention('<@!123456789>   README作って', '123456789')).toBe('README作って');
  });
});
