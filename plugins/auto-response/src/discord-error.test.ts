import { describe, expect, it } from 'vitest';
import { sanitizeDiscordSendError } from './discord-error.js';

describe('Discord send error sanitization', () => {
  it('requestBody・message・stackを返さない', () => {
    const error = Object.assign(new Error('configured secret response'), {
      name: 'DiscordAPIError[50013]',
      code: 50013,
      status: 403,
      requestBody: {
        json: { content: 'configured secret response' },
      },
    });

    const sanitized = sanitizeDiscordSendError(error);

    expect(sanitized).toEqual({
      errorName: 'DiscordAPIError[50013]',
      errorCode: 50013,
      httpStatus: 403,
    });
    expect(JSON.stringify(sanitized)).not.toContain('configured secret response');
    expect(sanitized).not.toHaveProperty('requestBody');
    expect(sanitized).not.toHaveProperty('stack');
  });

  it('識別できない値は固定名へ正規化する', () => {
    expect(sanitizeDiscordSendError({ requestBody: { content: 'secret' } })).toEqual({
      errorName: 'DiscordSendError',
      errorCode: null,
      httpStatus: null,
    });
  });
});
