import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import { handleAiArtifactMessage } from './artifact-message-handler.js';
import type { AiCodeExecutionService } from './code-execution-service.js';
import type { DiscordArtifactReplyOptions } from './discord-artifact-delivery.js';
import type { DiscordSafeTextReplyOptions } from './artifact-message-handler.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

type Reply = (
  options: DiscordArtifactReplyOptions | DiscordSafeTextReplyOptions,
) => Promise<unknown>;

function generationService(): AiRuntimeGenerationService {
  return {
    generate: vi.fn(async (): Promise<AiGenerationResponse> => {
      throw new Error('generation service must not be used');
    }),
  };
}

function executionService(withFile: boolean): AiCodeExecutionService {
  return {
    execute: vi.fn(async () => ({
      requestId: 'request-1',
      provider: 'openai' as const,
      model: 'gpt-5.6-terra' as const,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      estimatedCost: 0.0301,
      durationMs: 50,
      summary: 'Python処理は正常に完了しました。',
      files: withFile
        ? [
            {
              filename: 'result.csv',
              mimeType: 'text/csv',
              bytes: new TextEncoder().encode('name,value\na,1\n'),
              kind: 'data' as const,
            },
          ]
        : [],
      sandboxDestroyed: true as const,
      pricingVerifiedAt: '2026-08-27',
    })),
  };
}

function runtime(withFile: boolean) {
  return new AiArtifactRuntime({
    generationService: generationService(),
    executionService: executionService(withFile),
    artifactConfig: { maxBytes: 4096, maxFiles: 2 },
  });
}

function message(reply: ReturnType<typeof vi.fn<Reply>>) {
  return {
    guildId: 'guild-1',
    content: '<@123456789> このPythonコードを実行してCSVにして',
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: { users: { has: (id: string) => id === '123456789' } },
    reply,
  };
}

function options(aiRuntime: AiArtifactRuntime) {
  return {
    runtime: aiRuntime,
    botUserId: '123456789',
    getAiPluginConfig: vi.fn(async () => ({ enabled: true })),
  };
}

describe('artifact message handler Phase 2 execution', () => {
  it('実行成功かつfileありなら実bytesをattachmentとして返す', async () => {
    const reply = vi.fn<Reply>(async () => undefined);

    const result = await handleAiArtifactMessage(message(reply), options(runtime(true)));

    expect(result).toEqual({ status: 'handled', intent: 'code_execution' });
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0]?.[0];
    expect(payload?.content).toContain('実行が完了しました。');
    expect(payload?.content).toContain('`result.csv`');
    expect(payload && 'files' in payload).toBe(true);
    if (!payload || !('files' in payload)) throw new Error('expected attachment payload');
    expect(payload.files[0]?.attachment.toString('utf8')).toBe('name,value\na,1\n');
  });

  it('実行成功かつfileなしならbounded summaryだけ返す', async () => {
    const reply = vi.fn<Reply>(async () => undefined);

    const result = await handleAiArtifactMessage(message(reply), options(runtime(false)));

    expect(result).toEqual({ status: 'handled', intent: 'code_execution' });
    const payload = reply.mock.calls[0]?.[0];
    expect(payload?.content).toContain('実行が完了しました。');
    expect(payload?.content).toContain('Python処理は正常に完了しました。');
    expect(payload && 'files' in payload).toBe(false);
  });

  it('Discord attachment delivery失敗をsuccessへ変換しない', async () => {
    const reply = vi.fn<Reply>(async () => {
      throw new Error('Discord delivery failed with sensitive payload');
    });

    await expect(handleAiArtifactMessage(message(reply), options(runtime(true)))).rejects.toThrow(
      'Discord delivery failed',
    );
  });
});
