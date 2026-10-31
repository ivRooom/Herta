import { describe, expect, it, vi } from 'vitest';
import { hasVcRecapOpenAiAudioConsent } from './vc-recap-openai-audio-consent.js';

describe('hasVcRecapOpenAiAudioConsent', () => {
  it('allows only the explicit purpose/version with no pending erasure', async () => {
    const query = vi.fn().mockResolvedValue([{ allowed: true }]);
    const allowed = await hasVcRecapOpenAiAudioConsent(
      { $queryRaw: query } as never,
      '123456789012345678',
    );
    expect(allowed).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    // Parameterized Prisma template: user ID is not embedded in raw SQL.
    const template = query.mock.calls[0]?.[0] as TemplateStringsArray;
    expect(template.join('?')).toContain('openai_audio_processing');
    expect(template.join('?')).toContain('vc_recap_erasure_requests');
    expect(query.mock.calls[0]?.[1]).toBe('123456789012345678');
  });

  it('missing consent returns false', async () => {
    const query = vi.fn().mockResolvedValue([{ allowed: false }]);
    expect(await hasVcRecapOpenAiAudioConsent({ $queryRaw: query } as never, '1')).toBe(false);
  });

  it('missing migration, DB outage, or permission denial fail closed', async () => {
    const query = vi.fn().mockRejectedValue(new Error('relation does not exist'));
    expect(await hasVcRecapOpenAiAudioConsent({ $queryRaw: query } as never, '1')).toBe(false);
    expect(await hasVcRecapOpenAiAudioConsent({ $queryRaw: query } as never, '1')).toBe(false);
  });
});
