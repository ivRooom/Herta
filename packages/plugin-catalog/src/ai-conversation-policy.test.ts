import { describe, expect, it, vi } from 'vitest';
import {
  AI_GROUNDING_STATES,
  AI_RESPONSE_MODES,
  AiConversationPolicyError,
  resolveAiConversationPolicy,
} from './ai-conversation-policy.js';
import { AI_DEFAULTS, estimateInputTokens, estimateOpenAiCostMicroUsd } from './ai-service.js';

describe('AI conversation policy', () => {
  it('通常chatはHerta persona + concise low verbosityをdefaultにする', () => {
    const policy = resolveAiConversationPolicy();

    expect(policy.responseMode).toBe('chat');
    expect(policy.groundingState).toBe('not_required');
    expect(policy.textVerbosity).toBe('low');
    expect(policy.instructions).toContain("ivRooom's Discord companion");
    expect(policy.instructions).toContain('not a customer-support bot');
    expect(policy.instructions).toContain('confident, curious, playful');
    expect(policy.instructions).toContain('natural conversation rather than stiff templates');
    expect(policy.instructions).toContain('usually one to four short sentences');
    expect(policy.instructions).toContain('prefer flowing sentences over bullet lists');
    expect(policy.instructions).toContain('one natural question or playful suggestion');
    expect(policy.instructions).toContain('Do not invent factual claims');
    expect(policy.instructions).toContain('Never present a guess as a confirmed fact');
    expect(policy.instructions).toContain('cannot confirm it, or do not know');
    expect(policy.instructions).toContain('Answer normally without pretending');
    expect(policy.instructions).toContain(
      'say so explicitly instead of silently substituting a different format',
    );
  });

  it('現在日付をtraining cutoffではなくrequest時点のUTC日付でinstructionsへ渡す', () => {
    const policy = resolveAiConversationPolicy({ now: new Date('2026-09-18T03:00:00.000Z') });

    expect(policy.instructions).toContain("Today's actual date is 2026-09-18");
    expect(policy.instructions).toContain('do not rely on your training cutoff');
  });

  it('nowを省略すると実際の現在時刻の日付を使う', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
    try {
      const policy = resolveAiConversationPolicy();
      expect(policy.instructions).toContain("Today's actual date is 2026-09-18");
    } finally {
      vi.useRealTimers();
    }
  });

  it('detailed/artifactは必要な長さを禁止しない', () => {
    const detailed = resolveAiConversationPolicy({ responseMode: 'detailed' });
    const artifact = resolveAiConversationPolicy({ responseMode: 'artifact' });

    expect(detailed.textVerbosity).toBe('medium');
    expect(detailed.instructions).toContain("Keep Herta's natural voice");
    expect(detailed.instructions).toContain('Do not omit necessary steps merely to be brief');
    expect(artifact.textVerbosity).toBe('medium');
    expect(artifact.instructions).toContain('Do not truncate requested code');
    expect(artifact.instructions).toContain('artifact completeness takes priority');
  });

  it('insufficient groundingではmemory補完とfake citationを禁止する', () => {
    const policy = resolveAiConversationPolicy({ groundingState: 'insufficient' });

    expect(policy.instructions).toContain('Required grounding is insufficient');
    expect(policy.instructions).toContain('Do not fill missing external facts from model memory');
    expect(policy.instructions).toContain('Never fabricate a citation or source');
  });

  it('groundedでもsourceにない内容を埋めない', () => {
    const policy = resolveAiConversationPolicy({ groundingState: 'grounded' });

    expect(policy.instructions).toContain(
      'rely on the trusted sources supplied by the application',
    );
    expect(policy.instructions).toContain('say so instead of filling the gap from memory');
  });

  it('全policy envelope込みでも公開済み最大input/outputがdefault quality cost cap内に収まる', () => {
    const maxUserInput = 'あ'.repeat(AI_DEFAULTS.maxInputChars);

    for (const responseMode of AI_RESPONSE_MODES) {
      for (const groundingState of AI_GROUNDING_STATES) {
        const policy = resolveAiConversationPolicy({ responseMode, groundingState });
        const guardedInput = `Server instructions:\n${policy.instructions}\n\nUser input:\n${maxUserInput}`;
        const reservationMicroUsd = estimateOpenAiCostMicroUsd(
          'gpt-5.6-sol',
          estimateInputTokens(guardedInput),
          AI_DEFAULTS.maxOutputTokens,
        );

        expect(reservationMicroUsd).toBeLessThanOrEqual(AI_DEFAULTS.perRequestCostLimitMicroUsd);
      }
    }
  });

  it('server policyを無効化する任意mode/stateを拒否する', () => {
    expect(() => resolveAiConversationPolicy({ responseMode: 'unbounded' as never })).toThrowError(
      expect.objectContaining<Partial<AiConversationPolicyError>>({
        code: 'invalid_response_mode',
      }),
    );
    expect(() =>
      resolveAiConversationPolicy({ groundingState: 'pretend_grounded' as never }),
    ).toThrowError(
      expect.objectContaining<Partial<AiConversationPolicyError>>({
        code: 'invalid_grounding_state',
      }),
    );
  });
});
