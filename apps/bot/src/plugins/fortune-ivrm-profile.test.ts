import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  buildFortuneProfileRequest,
  fetchIvrmFortuneProfile,
  resolveFortuneProfileConfig,
} from './fortune-ivrm-profile.js';
const contract = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/herta-fortune-profile.v1.bundle.json', import.meta.url),
    'utf8',
  ),
);
const config = {
  apiBaseUrl: 'https://api.ivrm.jp',
  secret: 'test-secret',
  guildId: '123456789012345678',
};
const guild = '123456789012345678',
  user = '223456789012345678';
afterEach(() => vi.unstubAllGlobals());
function mockResponse(profile: unknown, edit: Record<string, unknown> = {}) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    return Response.json({
      schemaVersion: 1,
      requestId: request.requestId,
      discordUserId: user,
      profile,
      ...edit,
    });
  });
}
describe('private ivrm-web profile client', () => {
  it('restricts base URLs and configuration', () => {
    for (const value of [
      'http://api.ivrm.jp',
      'https://user:pass@api.ivrm.jp',
      'https://api.ivrm.jp/?secret=x',
      'https://api.ivrm.jp/foo',
    ])
      expect(
        resolveFortuneProfileConfig({ IVRM_WEB_API_BASE_URL: value, HERTA_MBTI_SYNC_SECRET: 'x' }),
      ).toBeNull();
    expect(
      resolveFortuneProfileConfig({
        IVRM_WEB_API_BASE_URL: config.apiBaseUrl,
        HERTA_MBTI_SYNC_SECRET: 'test-secret',
        IVRM_INTEGRATION_GUILD_ID: guild,
      }),
    ).toEqual(config);
  });
  it('requires an explicit guild and never sends other guild member IDs', async () => {
    expect(
      resolveFortuneProfileConfig({
        IVRM_WEB_API_BASE_URL: config.apiBaseUrl,
        HERTA_MBTI_SYNC_SECRET: 'test-secret',
      }),
    ).toBeNull();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await fetchIvrmFortuneProfile('323456789012345678', user, '2026-10-16', config)).toEqual(
      { status: 'ineligible-guild' },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('matches the contract HMAC purpose, path and body keys', () => {
    const id = '44444444-4444-4444-8444-444444444444',
      stamp = '2026-10-16T00:00:00.000Z';
    const request = buildFortuneProfileRequest(config, guild, user, id, stamp);
    const key = createHmac('sha256', config.secret).update(contract.hmacPurpose).digest();
    expect(request.url).toBe(config.apiBaseUrl + contract.path);
    expect(Object.keys(JSON.parse(request.init.body)).sort()).toEqual(
      [...contract.request.required].sort(),
    );
    expect(request.init.headers['X-IVRM-Signature']).toBe(
      createHmac('sha256', key)
        .update(['POST', contract.path, stamp, id, request.init.body].join('\n'))
        .digest('hex'),
    );
  });
  it('uses only valid, request-bound source fields and does not follow redirects', async () => {
    const fetch = mockResponse({ birthday: '2000-10-16', mbtiType: 'INFP', bloodType: null });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchIvrmFortuneProfile(guild, user, '2026-10-16', config)).toMatchObject({
      status: 'linked',
      profile: { birthday: '2000-10-16', mbti: 'INFP', bloodType: null },
    });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
    vi.stubGlobal(
      'fetch',
      mockResponse(
        { birthday: null, mbtiType: null, bloodType: null },
        { discordUserId: '323456789012345678' },
      ),
    );
    expect(await fetchIvrmFortuneProfile(guild, user, '2026-10-16', config)).toEqual({
      status: 'unavailable',
    });
  });
  it('fails closed on malformed dates, oversized responses, errors and missing configuration', async () => {
    for (const profile of [
      { birthday: '2001-02-29', mbtiType: null, bloodType: null },
      { birthday: null, mbtiType: 'INFZ', bloodType: null },
    ]) {
      vi.stubGlobal('fetch', mockResponse(profile));
      expect(await fetchIvrmFortuneProfile(guild, user, '2026-10-16', config)).toEqual({
        status: 'unavailable',
      });
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x'.repeat(4097), { headers: { 'content-type': 'application/json' } }),
      ),
    );
    expect(await fetchIvrmFortuneProfile(guild, user, '2026-10-16', config)).toEqual({
      status: 'unavailable',
    });
    for (const status of [404, 403, 500, 503]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status })),
      );
      expect(await fetchIvrmFortuneProfile(guild, user, '2026-10-16', config)).toEqual({
        status: status === 404 ? 'not-linked' : status === 403 ? 'ineligible-guild' : 'unavailable',
      });
    }
    expect(await fetchIvrmFortuneProfile(guild, user, '2026-10-16', null)).toEqual({
      status: 'unconfigured',
    });
  });
});
