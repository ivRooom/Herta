import type { VcRecapTranscriptSegmentRecord } from '@herta/db';
import { describe, expect, it, vi } from 'vitest';
import { summarizeVcRecapSession } from './vc-recap-summarizer.js';

const resolveAiOpenAiCredentialMock = vi.fn();
const reserveGuildMonthlyBudgetMock = vi.fn().mockResolvedValue({
  allowed: true,
  reserved: true,
  reservedTotalMicroUsd: 0,
  periodStart: new Date(0),
});
const settleGuildMonthlyBudgetDeltaMock = vi.fn().mockResolvedValue(undefined);
const recordAiGenerationEventMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../ai/factory.js', () => ({
  resolveAiOpenAiCredential: (...args: unknown[]) => resolveAiOpenAiCredentialMock(...args),
}));

vi.mock('@herta/db', () => ({
  reserveGuildMonthlyBudget: (...args: unknown[]) => reserveGuildMonthlyBudgetMock(...args),
  settleGuildMonthlyBudgetDelta: (...args: unknown[]) => settleGuildMonthlyBudgetDeltaMock(...args),
  recordAiGenerationEvent: (...args: unknown[]) => recordAiGenerationEventMock(...args),
}));

const prisma = {} as Parameters<typeof summarizeVcRecapSession>[0];

/** HERTA_AI_ENABLEDは既定falseのため、呼び出しを許可するテストでは明示的にtrueを渡す。 */
const ENABLED_ENV = { HERTA_AI_ENABLED: 'true' };

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
    const result = await summarizeVcRecapSession(prisma, 'guild-1', [], ENABLED_ENV);
    expect(result).toBeNull();
    expect(resolveAiOpenAiCredentialMock).not.toHaveBeenCalled();
  });

  it('HERTA_AI_ENABLEDが既定(未設定=false)ならcredentialを読まずnullを返す', async () => {
    const result = await summarizeVcRecapSession(prisma, 'guild-1', [segment('u1', 'hello')], {});
    expect(result).toBeNull();
    expect(resolveAiOpenAiCredentialMock).not.toHaveBeenCalled();
  });

  it('HERTA_AI_KILL_SWITCHが有効ならguild設定に関係なくcredentialを読まずnullを返す', async () => {
    const result = await summarizeVcRecapSession(prisma, 'guild-1', [segment('u1', 'hello')], {
      ...ENABLED_ENV,
      HERTA_AI_KILL_SWITCH: 'true',
    });
    expect(result).toBeNull();
    expect(resolveAiOpenAiCredentialMock).not.toHaveBeenCalled();
  });

  it('OpenAI credentialが無ければnullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: null });
    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      ENABLED_ENV,
    );
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
      'guild-1',
      [segment('u1', 'hello'), segment('u2', 'world')],
      ENABLED_ENV,
      fetchImpl,
    );
    expect(result).toEqual({ summary: 'みんなでゲームの話をしました', topics: ['ゲーム', '雑談'] });
  });

  it('```json ... ``` でラップされた応答も解析できる', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(openAiResponse('```json\n{"summary": "要約です", "topics": []}\n```'));

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      ENABLED_ENV,
      fetchImpl,
    );
    expect(result).toEqual({ summary: '要約です', topics: [] });
  });

  it('APIがエラーステータスを返した場合nullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      ENABLED_ENV,
      fetchImpl,
    );
    expect(result).toBeNull();
  });

  it('不正なJSON応答はnullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse('not valid json'));

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      ENABLED_ENV,
      fetchImpl,
    );
    expect(result).toBeNull();
  });

  it('summaryフィールドが無い応答はnullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse('{"topics": ["a"]}'));

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      ENABLED_ENV,
      fetchImpl,
    );
    expect(result).toBeNull();
  });

  it('fetchが例外を投げた場合(タイムアウト等)nullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      ENABLED_ENV,
      fetchImpl,
    );
    expect(result).toBeNull();
  });

  it('Guild月次予算のreserveが拒否された場合はcredentialを読まずnullを返す', async () => {
    resolveAiOpenAiCredentialMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: false,
      reserved: false,
      reservedTotalMicroUsd: 5_000_000,
      periodStart: new Date(0),
    });
    const result = await summarizeVcRecapSession(prisma, 'guild-1', [segment('u1', 'hello')], {
      ...ENABLED_ENV,
      HERTA_AI_GUILD_MONTHLY_BUDGET_USD: '5',
    });
    expect(result).toBeNull();
    expect(resolveAiOpenAiCredentialMock).not.toHaveBeenCalled();
  });

  it('予算のreserveが許可されれば通常通り呼び出し、成功時にコストをai_generation_eventsへ記録しsettleする', async () => {
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 100_000,
      periodStart: new Date(0),
    });
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"summary": "要約", "topics": []}' }],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      { ...ENABLED_ENV, HERTA_AI_GUILD_MONTHLY_BUDGET_USD: '5' },
      fetchImpl,
    );
    expect(result).toEqual({ summary: '要約', topics: [] });
    expect(recordAiGenerationEventMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        guildId: 'guild-1',
        feature: 'vc_recap_summary',
        inputTokens: 100,
        outputTokens: 50,
      }),
    );
    expect(settleGuildMonthlyBudgetDeltaMock).toHaveBeenCalledWith(
      prisma,
      'guild-1',
      new Date(0),
      expect.any(Number),
    );
  });

  it('成功応答でもusageが取れない場合はreserveを全額保持する(解放しない)', async () => {
    recordAiGenerationEventMock.mockClear();
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 100_000,
      periodStart: new Date(0),
    });
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(openAiResponse('{"summary": "要約", "topics": []}'));

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      { ...ENABLED_ENV, HERTA_AI_GUILD_MONTHLY_BUDGET_USD: '5' },
      fetchImpl,
    );
    expect(result).toEqual({ summary: '要約', topics: [] });
    expect(recordAiGenerationEventMock).not.toHaveBeenCalled();
    // delta=0で呼ばれる(=実装上は何も変更しない。保守的にreserve全額を保持する)。
    expect(settleGuildMonthlyBudgetDeltaMock).toHaveBeenCalledWith(
      prisma,
      'guild-1',
      new Date(0),
      0,
    );
  });

  it('応答は成功でもsummary解析に失敗した場合はfailedとして記録する', async () => {
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 100_000,
      periodStart: new Date(0),
    });
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'not valid json' }] }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      { ...ENABLED_ENV, HERTA_AI_GUILD_MONTHLY_BUDGET_USD: '5' },
      fetchImpl,
    );
    expect(result).toBeNull();
    expect(recordAiGenerationEventMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ resultCategory: 'failed' }),
    );
  });

  it('reservedがfalse(DB障害によるfail-open)なら成功してもsettleしない', async () => {
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: false,
      reservedTotalMicroUsd: 0,
      periodStart: new Date(0),
    });
    resolveAiOpenAiCredentialMock.mockResolvedValueOnce({ apiKey: 'test-key' });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"summary": "要約", "topics": []}' }],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await summarizeVcRecapSession(
      prisma,
      'guild-1',
      [segment('u1', 'hello')],
      { ...ENABLED_ENV, HERTA_AI_GUILD_MONTHLY_BUDGET_USD: '5' },
      fetchImpl,
    );
    expect(result).toEqual({ summary: '要約', topics: [] });
    // reserved:false(何も書き込まれていない)なので、settleは呼ばれない(Codexレビュー指摘)。
    expect(settleGuildMonthlyBudgetDeltaMock).not.toHaveBeenCalled();
  });

  it('予算が見積りコストより小さい場合、予約額を頭打ちせず素直に拒否する', async () => {
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: false,
      reserved: false,
      reservedTotalMicroUsd: 1,
      periodStart: new Date(0),
    });
    const result = await summarizeVcRecapSession(prisma, 'guild-1', [segment('u1', 'hello')], {
      ...ENABLED_ENV,
      // 1 micro USD(=0.000001 USD)という極端に小さい予算。見積りコストは必ずこれより大きい。
      HERTA_AI_GUILD_MONTHLY_BUDGET_USD: '0.000001',
    });
    expect(result).toBeNull();
    // 予約額は頭打ちされず、本来の見積り(1より大きい)のまま渡す。収まらなければ拒否するのが
    // 正しい(Codexレビュー指摘)。
    const call = reserveGuildMonthlyBudgetMock.mock.calls.at(-1)?.[1] as
      { amountMicroUsd: number; limitMicroUsd: number } | undefined;
    expect(call?.limitMicroUsd).toBe(1);
    expect(call?.amountMicroUsd).toBeGreaterThan(1);
  });
});
