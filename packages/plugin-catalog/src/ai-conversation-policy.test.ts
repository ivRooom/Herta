import { describe, expect, it } from 'vitest';
import {
  AiConversationPolicyError,
  resolveAiConversationPolicy,
} from './ai-conversation-policy.js';

describe('AI conversation policy', () => {
  it('通常chatはconcise low verbosityをdefaultにする', () => {
    const policy = resolveAiConversationPolicy();

    expect(policy.responseMode).toBe('chat');
    expect(policy.groundingState).toBe('not_required');
    expect(policy.textVerbosity).toBe('low');
    expect(policy.instructions).toContain('usually two to five sentences');
    expect(policy.instructions).toContain('Do not invent or claim unverified facts');
    expect(policy.instructions).toContain('cannot confirm it or do not know');
  });

  it('detailed/artifactは必要な長さを禁止しない', () => {
    const detailed = resolveAiConversationPolicy({ responseMode: 'detailed' });
    const artifact = resolveAiConversationPolicy({ responseMode: 'artifact' });

    expect(detailed.textVerbosity).toBe('medium');
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
