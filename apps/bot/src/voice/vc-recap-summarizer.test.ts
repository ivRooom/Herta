import type { VcRecapTranscriptSegmentRecord } from '@herta/db';
import { describe, expect, it, vi } from 'vitest';
import { summarizeVcRecapSession } from './vc-recap-summarizer.js';

const resolveAiOpenAiCredentialMock = vi.fn();

vi.mock('../ai/factory.js', () => ({
  resolveAiOpenAiCredential: (...args: unknown[]) => resolveAiOpenAiCredentialMock(...args),
}));

const prisma = {} as Parameters<typeof summarizeVcRecapSession>[0];

function segment(userId: string, text: string): VcRecapTranscriptSegmentRecord {
  return { userId, text, startedAt: new Date(), endedAt: new Date() };
}

function openAiResponse(outputText: string): Response {
  return new Response(
    JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: outputText }] }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('summarizeVcRecapSession', () => {
  it('segmentsが空ならcredentialを読まずnullを返す', async () => {
    const result = await summarizeVcRecapSession(prisma, [], {});
    expect(result).toBeNull();
    expect(resolveAiOpenAiCredentialMock).not.toHaveBeenCalled();
  });

  it('OpenAI credentialが無ければnullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: null });
    const result = await summarizeVcRecapSession(prisma, [segment('u1', 'hello')], {});
    expect(result).toBeNull();
  });

  it('正常なJSON応答からsummary/topicsを抽出する', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        openAiResponse('{"summary": "みんなでゲームの話をしました", "topics": ["ゲーム", "雑談"]}'),
      );

    const result = await summarizeVcRecapSession(
      prisma,
      [segment('u1', 'hello'), segment('u2', 'world')],
      {},
      fetchImpl,
    );
    expect(result).toEqual({ summary: 'みんなでゲームの話をしました', topics: ['ゲーム', '雑談'] });
  });

  it('```json ... ``` でラップされた応答も解析できる', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(openAiResponse('```json\n{"summary": "要約です", "topics": []}\n```'));

    const result = await summarizeVcRecapSession(prisma, [segment('u1', 'hello')], {}, fetchImpl);
    expect(result).toEqual({ summary: '要約です', topics: [] });
  });

  it('APIがエラーステータスを返した場合nullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));

    const result = await summarizeVcRecapSession(prisma, [segment('u1', 'hello')], {}, fetchImpl);
    expect(result).toBeNull();
  });

  it('不正なJSON応答はnullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse('not valid json'));

    const result = await summarizeVcRecapSession(prisma, [segment('u1', 'hello')], {}, fetchImpl);
    expect(result).toBeNull();
  });

  it('summaryフィールドが無い応答はnullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse('{"topics": ["a"]}'));

    const result = await summarizeVcRecapSession(prisma, [segment('u1', 'hello')], {}, fetchImpl);
    expect(result).toBeNull();
  });

  it('fetchが例外を投げた場合(タイムアウト等)nullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await summarizeVcRecapSession(prisma, [segment('u1', 'hello')], {}, fetchImpl);
    expect(result).toBeNull();
  });
});
