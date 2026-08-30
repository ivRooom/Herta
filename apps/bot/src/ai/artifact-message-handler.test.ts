import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import {
  handleAiArtifactMessage,
  isAiArtifactMessageCandidate,
  stripBotMention,
  verifyAiReplyToBot,
  type AiArtifactDiscordMessage,
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

function message(
  content: string,
  reply = replyMock(),
  overrides: Partial<AiArtifactDiscordMessage> = {},
): AiArtifactDiscordMessage {
  return {
    guildId: 'guild-1',
    content,
    webhookId: null,
    author: { id: 'user-1', bot: false },
    member: { id: 'user-1' },
    mentions: { users: { has: (id: string) => id === '123456789' } },
    reply,
    ...overrides,
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

describe('artifact message candidate', () => {
  it('bot mentionのあるuser messageだけ初回runtime bootstrap候補にする', () => {
    expect(isAiArtifactMessageCandidate(message('通常メッセージ'), '123456789')).toBe(false);
    expect(isAiArtifactMessageCandidate(message('<@123456789>   '), '123456789')).toBe(false);
    expect(
      isAiArtifactMessageCandidate(message('<@123456789> Pythonコードを書いて'), '123456789'),
    ).toBe(true);
  });

  it('Herta自身へのdirect replyは参照先をserver-side検証した後だけ候補にする', async () => {
    const directReply = message('遊びたい', replyMock(), {
      reference: { messageId: 'herta-message-1' },
      fetchReference: vi.fn(async () => ({
        guildId: 'guild-1',
        author: { id: '123456789' },
      })),
    });

    expect(isAiArtifactMessageCandidate(directReply, '123456789')).toBe(false);
    await expect(verifyAiReplyToBot(directReply, '123456789')).resolves.toBe(true);
    expect(isAiArtifactMessageCandidate(directReply, '123456789')).toBe(true);
  });

  it('他ユーザーへのreplyや参照取得失敗は候補にしない', async () => {
    const otherUserReply = message('遊びたい', replyMock(), {
      reference: { messageId: 'other-message-1' },
      fetchReference: vi.fn(async () => ({ guildId: 'guild-1', author: { id: 'user-2' } })),
    });
    const missingReply = message('遊びたい', replyMock(), {
      reference: { messageId: 'deleted-message' },
      fetchReference: vi.fn(async () => {
        throw new Error('not found');
      }),
    });

    await expect(verifyAiReplyToBot(otherUserReply, '123456789')).resolves.toBe(false);
    await expect(verifyAiReplyToBot(missingReply, '123456789')).resolves.toBe(false);
    expect(isAiArtifactMessageCandidate(otherUserReply, '123456789')).toBe(false);
    expect(isAiArtifactMessageCandidate(missingReply, '123456789')).toBe(false);
  });

  it('通常のmentionなしmessageはdirect replyでなければ候補にしない', () => {
    expect(isAiArtifactMessageCandidate(message('遊びたい'), '123456789')).toBe(false);
  });
});

describe('stripBotMention', () => {
  it('Discord mentionだけ除去しuser inputを保持する', () => {
    expect(stripBotMention('<@123456789> Pythonコードを書いて', '123456789')).toBe(
      'Pythonコードを書いて',
    );
    expect(stripBotMention('<@!123456789>   README作って', '123456789')).toBe('README作って');
    expect(stripBotMention('遊びたい', '123456789')).toBe('遊びたい');
  });

  it('内部の改行とindentationを壊さない', () => {
    const input = '<@123456789> 変換して\nif ok:\n    print("yes")\n';
    expect(stripBotMention(input, '123456789')).toBe('変換して\nif ok:\n    print("yes")');
  });
});
