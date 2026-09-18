import { describe, expect, it } from 'vitest';
import { resolveAiFoundationConfig } from './ai-service.js';

describe('AI Foundation timezone default', () => {
  it('timezoneの既定値をAsia/Tokyo(JST)にする', () => {
    expect(resolveAiFoundationConfig({}).timezone).toBe('Asia/Tokyo');
  });

  it('有効なIANA timezoneはHERTA_AI_TIMEZONEで上書きできる', () => {
    expect(resolveAiFoundationConfig({ HERTA_AI_TIMEZONE: 'America/New_York' }).timezone).toBe(
      'America/New_York',
    );
    expect(resolveAiFoundationConfig({ HERTA_AI_TIMEZONE: 'UTC' }).timezone).toBe('UTC');
  });

  it('不正なtimezone文字列はsilent fallbackせずfail closedする', () => {
    expect(() => resolveAiFoundationConfig({ HERTA_AI_TIMEZONE: 'Not/A_Timezone' })).toThrow(
      'HERTA_AI_TIMEZONE',
    );
  });
});
