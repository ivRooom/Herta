import { describe, expect, it } from 'vitest';
import { resolveAiFoundationConfig } from './ai-service.js';

describe('AI Foundation timeout default', () => {
  it('provider timeoutの既定値を30秒にする', () => {
    expect(resolveAiFoundationConfig({}).timeoutMs).toBe(30_000);
  });

  it('30秒は許可し、それを超える設定はfail closedする', () => {
    expect(resolveAiFoundationConfig({ HERTA_AI_TIMEOUT_MS: '30000' }).timeoutMs).toBe(30_000);
    expect(() => resolveAiFoundationConfig({ HERTA_AI_TIMEOUT_MS: '30001' })).toThrow(
      'HERTA_AI_TIMEOUT_MS',
    );
  });
});
