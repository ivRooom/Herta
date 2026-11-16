import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  buildGameAccountsRequest,
  callIvrmGameAccounts,
  resolveGameAccountsConfig,
  type GameAccountsRequestInput,
} from './game-accounts-ivrm.js';
const contract = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/ivrm/herta-game-accounts.v2.bundle.json', import.meta.url),
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
function mockJson(respond: (request: Record<string, unknown>) => unknown, status = 200) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as Record<string, unknown>;
    const payload = respond(request);
    return Response.json(
      status === 200
        ? {
            schemaVersion: 2,
            requestId: request.requestId,
            discordUserId: user,
            action: request.action,
            ...(payload as Record<string, unknown>),
          }
        : payload,
      { status },
    );
  });
}
const account = {
  gameCode: 'genshin',
  uid: '812468719',
  region: null,
  createdAt: '2026-11-15T14:43:29.060Z',
  updatedAt: '2026-11-15T14:43:29.060Z',
};
describe('private ivrm-web game accounts client', () => {
  it('restricts base URLs and configuration', () => {
    for (const value of [
      'http://api.ivrm.jp',
      'https://user:pass@api.ivrm.jp',
      'https://api.ivrm.jp/?secret=x',
      'https://api.ivrm.jp/foo',
    ])
      expect(
        resolveGameAccountsConfig({
          IVRM_WEB_API_BASE_URL: value,
          HERTA_MBTI_SYNC_SECRET: 'x',
          IVRM_INTEGRATION_GUILD_ID: guild,
        }),
      ).toBeNull();
    expect(
      resolveGameAccountsConfig({
        IVRM_WEB_API_BASE_URL: config.apiBaseUrl,
        HERTA_MBTI_SYNC_SECRET: 'test-secret',
        IVRM_INTEGRATION_GUILD_ID: guild,
      }),
    ).toEqual(config);
    expect(
      resolveGameAccountsConfig({
        IVRM_WEB_API_BASE_URL: config.apiBaseUrl,
        HERTA_MBTI_SYNC_SECRET: 'test-secret',
      }),
    ).toBeNull();
  });
  it('never sends other guild member IDs', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      await callIvrmGameAccounts('323456789012345678', user, { action: 'list' }, config),
    ).toEqual({ status: 'ineligible-guild' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await callIvrmGameAccounts(guild, user, { action: 'list' }, null)).toEqual({
      status: 'unconfigured',
    });
  });
  it('matches the contract HMAC purpose, path and per-action body keys', () => {
    const id = '44444444-4444-4444-8444-444444444444',
      stamp = '2026-11-16T00:00:00.000Z';
    const key = createHmac('sha256', config.secret).update(contract.hmacPurpose).digest();
    const inputs: GameAccountsRequestInput[] = [
      { action: 'link', gameCode: 'genshin', uid: '812468719' },
      { action: 'link', gameCode: 'genshin', uid: '812468719', region: 'os_asia' },
      { action: 'unlink', gameCode: 'genshin' },
      { action: 'list' },
      { action: 'score', gameCode: 'genshin' },
    ];
    for (const input of inputs) {
      const request = buildGameAccountsRequest(config, guild, user, input, id, stamp);
      expect(request.url).toBe(config.apiBaseUrl + contract.path);
      const actionContract = contract.request.actions[input.action];
      const expectedKeys = [
        ...contract.request.required,
        ...actionContract.required,
        ...(input.region ? ['region'] : []),
      ].sort();
      expect(Object.keys(JSON.parse(request.init.body)).sort()).toEqual(expectedKeys);
      expect(request.init.headers['X-IVRM-Signature']).toBe(
        createHmac('sha256', key)
          .update(['POST', contract.path, stamp, id, request.init.body].join('\n'))
          .digest('hex'),
      );
      expect(request.init.headers['X-IVRM-Event-Id']).toBe(id);
    }
  });
  it('parses a link result with its showcase state and does not follow redirects', async () => {
    const fetch = mockJson(() => ({
      account,
      showcase: { status: 'ok', stale: false, fetchedAt: '2026-11-15T14:43:29.060Z' },
    }));
    vi.stubGlobal('fetch', fetch);
    expect(
      await callIvrmGameAccounts(
        guild,
        user,
        { action: 'link', gameCode: 'genshin', uid: '812468719' },
        config,
      ),
    ).toEqual({
      status: 'ok',
      action: 'link',
      account,
      showcase: { status: 'ok', stale: false, fetchedAt: '2026-11-15T14:43:29.060Z' },
    });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error', cache: 'no-store' });
  });
  it('parses unlink and list results', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({ gameCode: 'genshin', deleted: true })),
    );
    expect(
      await callIvrmGameAccounts(guild, user, { action: 'unlink', gameCode: 'genshin' }, config),
    ).toEqual({ status: 'ok', action: 'unlink', gameCode: 'genshin' });
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({
        accounts: [
          { ...account, showcaseStatus: 'ok', showcaseFetchedAt: '2026-11-15T14:43:29.060Z' },
          {
            gameCode: 'wuthering',
            uid: '123456789',
            region: null,
            createdAt: '2026-11-15T14:43:29.060Z',
            updatedAt: '2026-11-15T14:43:29.060Z',
            showcaseStatus: null,
            showcaseFetchedAt: null,
          },
        ],
      })),
    );
    const list = await callIvrmGameAccounts(guild, user, { action: 'list' }, config);
    expect(list).toMatchObject({ status: 'ok', action: 'list' });
    if (list.status === 'ok' && list.action === 'list') {
      expect(list.accounts).toHaveLength(2);
      expect(list.accounts[0]).toMatchObject({ gameCode: 'genshin', showcaseStatus: 'ok' });
      expect(list.accounts[1]).toMatchObject({ gameCode: 'wuthering', showcaseFetchedAt: null });
    }
  });
  it('parses a score result, including characters without a score', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({
        gameCode: 'genshin',
        uid: '812468719',
        showcaseStatus: 'ok',
        fetchedAt: '2026-11-15T14:43:29.060Z',
        hasSnapshot: true,
        characters: [
          {
            id: 10000098,
            name: 'クロリンデ',
            level: 80,
            artifactScore: {
              total: 160.8,
              version: 1,
              perPiece: [{ cv: 34.9, rolls: { critRate: 3, critDmg: 3, energyRecharge: 1 } }],
            },
          },
          { id: '10000061', name: '綺良々', level: 70, artifactScore: null },
        ],
      })),
    );
    const result = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'score', gameCode: 'genshin' },
      config,
    );
    expect(result).toMatchObject({ status: 'ok', action: 'score', hasSnapshot: true });
    if (result.status === 'ok' && result.action === 'score') {
      expect(result.characters[0]).toEqual({
        id: '10000098',
        name: 'クロリンデ',
        level: 80,
        artifactScore: {
          total: 160.8,
          version: 1,
          perPiece: [{ cv: 34.9, rolls: { critRate: 3, critDmg: 3, energyRecharge: 1 } }],
        },
      });
      expect(result.characters[1]?.artifactScore).toBeNull();
    }
  });
  it('maps API errors to result statuses', async () => {
    const cases: Array<[number, unknown, unknown]> = [
      [404, { status: 'error', error: 'member_not_linked' }, { status: 'not-linked' }],
      [
        404,
        { status: 'error', error: 'game_account_not_found' },
        { status: 'not-found', error: 'game_account_not_found' },
      ],
      [
        404,
        { status: 'error', error: 'game_not_found' },
        { status: 'not-found', error: 'game_not_found' },
      ],
      [403, { status: 'error', error: 'guild_not_allowed' }, { status: 'ineligible-guild' }],
      [
        422,
        { status: 'error', error: 'invalid_input', field: 'uid', message: 'UIDの形式が違います' },
        { status: 'invalid-input', field: 'uid', message: 'UIDの形式が違います' },
      ],
      [401, { status: 'error', error: 'invalid_signature' }, { status: 'unavailable' }],
      [502, { status: 'error', error: 'game_accounts_upstream_error' }, { status: 'unavailable' }],
      [503, { status: 'error', error: 'game_accounts_unavailable' }, { status: 'unavailable' }],
    ];
    for (const [status, body, expected] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body, { status })),
      );
      expect(await callIvrmGameAccounts(guild, user, { action: 'list' }, config)).toEqual(expected);
    }
  });
  it('fails closed on request-bound mismatches, malformed payloads and oversized responses', async () => {
    // A response bound to another member must never be used.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const request = JSON.parse(init.body as string);
        return Response.json({
          schemaVersion: 2,
          requestId: request.requestId,
          discordUserId: '323456789012345678',
          action: 'list',
          accounts: [],
        });
      }),
    );
    expect(await callIvrmGameAccounts(guild, user, { action: 'list' }, config)).toEqual({
      status: 'unavailable',
    });
    // Malformed score payload (rolls is not a record of counts).
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({
        gameCode: 'genshin',
        uid: '812468719',
        showcaseStatus: 'ok',
        fetchedAt: null,
        hasSnapshot: true,
        characters: [
          {
            id: 1,
            name: null,
            level: 80,
            artifactScore: { total: 1, version: 1, perPiece: [{ cv: 1, rolls: ['critRate'] }] },
          },
        ],
      })),
    );
    expect(
      await callIvrmGameAccounts(guild, user, { action: 'score', gameCode: 'genshin' }, config),
    ).toEqual({ status: 'unavailable' });
    // Oversized body.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x'.repeat(65_537), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    expect(await callIvrmGameAccounts(guild, user, { action: 'list' }, config)).toEqual({
      status: 'unavailable',
    });
    // Network failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await callIvrmGameAccounts(guild, user, { action: 'list' }, config)).toEqual({
      status: 'unavailable',
    });
  });
});

describe('card action (build-card PNG)', () => {
  // A real 1x1 PNG, so the magic-byte check sees an actual PNG payload.
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('sends characterId in the signed body', () => {
    const id = '44444444-4444-4444-8444-444444444444',
      stamp = '2026-11-16T00:00:00.000Z';
    const key = createHmac('sha256', config.secret).update(contract.hmacPurpose).digest();
    const request = buildGameAccountsRequest(
      config,
      guild,
      user,
      { action: 'card', gameCode: 'genshin', characterId: '10000098' },
      id,
      stamp,
    );
    const body = JSON.parse(request.init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [...contract.request.required, 'gameCode', 'characterId'].sort(),
    );
    expect(body.characterId).toBe('10000098');
    expect(request.init.headers['X-IVRM-Signature']).toBe(
      createHmac('sha256', key)
        .update(['POST', contract.path, stamp, id, request.init.body].join('\n'))
        .digest('hex'),
    );
  });

  it('parses a card result and decodes the PNG', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({
        gameCode: 'genshin',
        uid: '812468719',
        fetchedAt: '2026-11-15T14:43:29.060Z',
        cards: [{ characterId: 10000098, name: 'クロリンデ', score: 160.8, pngBase64 }],
      })),
    );
    const result = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'card', gameCode: 'genshin', characterId: '10000098' },
      config,
    );
    expect(result).toMatchObject({ status: 'ok', action: 'card', uid: '812468719' });
    if (result.status === 'ok' && result.action === 'card') {
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]?.characterId).toBe('10000098');
      expect(result.cards[0]?.name).toBe('クロリンデ');
      expect(result.cards[0]?.score).toBe(160.8);
      expect(Buffer.isBuffer(result.cards[0]?.png)).toBe(true);
      expect(result.cards[0]?.png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });

  it('fails closed on a non-PNG or malformed card payload', async () => {
    for (const pngBase64 of ['aGVsbG8gd29ybGQ=', 'not*base64*png', '']) {
      vi.stubGlobal(
        'fetch',
        mockJson(() => ({
          gameCode: 'genshin',
          uid: '812468719',
          fetchedAt: null,
          cards: [{ characterId: '10000098', name: null, score: null, pngBase64 }],
        })),
      );
      expect(
        await callIvrmGameAccounts(
          guild,
          user,
          { action: 'card', gameCode: 'genshin', characterId: '10000098' },
          config,
        ),
      ).toEqual({ status: 'unavailable' });
    }
  });

  it('maps card-specific errors to card-unavailable, keeping member errors distinct', async () => {
    const cases: Array<[number, unknown, unknown]> = [
      [404, { status: 'error', error: 'card_unavailable' }, { status: 'card-unavailable' }],
      [404, { status: 'error', error: 'character_not_found' }, { status: 'card-unavailable' }],
      [422, { status: 'error', error: 'card_not_supported' }, { status: 'card-unavailable' }],
      [404, { status: 'error', error: 'member_not_linked' }, { status: 'not-linked' }],
      [
        404,
        { status: 'error', error: 'game_account_not_found' },
        { status: 'not-found', error: 'game_account_not_found' },
      ],
      [502, { status: 'error', error: 'card_render_failed' }, { status: 'unavailable' }],
      [503, { status: 'error', error: 'card_renderer_unavailable' }, { status: 'unavailable' }],
    ];
    for (const [status, body, expected] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body, { status })),
      );
      expect(
        await callIvrmGameAccounts(
          guild,
          user,
          { action: 'card', gameCode: 'genshin', characterId: '10000098' },
          config,
        ),
      ).toEqual(expected);
    }
  });

  it('accepts a card body above the score cap but rejects one above the card cap', async () => {
    // ~100 KiB of valid PNG-prefixed base64: over the 64 KiB score cap,
    // well under the card cap.
    const medium = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(100_000, 1),
    ]).toString('base64');
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({
        gameCode: 'genshin',
        uid: '812468719',
        fetchedAt: null,
        cards: [{ characterId: '10000098', name: null, score: null, pngBase64: medium }],
      })),
    );
    const ok = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'card', gameCode: 'genshin', characterId: '10000098' },
      config,
    );
    expect(ok).toMatchObject({ status: 'ok', action: 'card' });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x'.repeat(4 * 1024 * 1024 + 1), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    expect(
      await callIvrmGameAccounts(
        guild,
        user,
        { action: 'card', gameCode: 'genshin', characterId: '10000098' },
        config,
      ),
    ).toEqual({ status: 'unavailable' });
  });
});
