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
  it('parses the role-optimized score stored next to the CV score (#1366)', async () => {
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
              roleScore: {
                total: 20.7,
                perPiece: [7.0],
                role: 'attacker',
                profile: 'atk',
                version: 1,
              },
            },
          },
        ],
      })),
    );
    const result = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'score', gameCode: 'genshin' },
      config,
    );
    expect(result).toMatchObject({ status: 'ok', action: 'score' });
    if (result.status === 'ok' && result.action === 'score') {
      expect(result.characters[0]?.artifactScore?.roleScore).toEqual({
        total: 20.7,
        perPiece: [7.0],
        role: 'attacker',
        profile: 'atk',
        version: 1,
      });
    }
  });
  it('fails closed when a present roleScore block is malformed', async () => {
    for (const roleScore of [
      { total: 'high', perPiece: [7.0], role: 'attacker', version: 1 },
      { total: 20.7, perPiece: [7.0], role: 'dps', version: 1 },
      { total: 20.7, perPiece: ['7'], role: 'attacker', version: 1 },
      { total: 20.7, perPiece: [7.0], role: 'attacker', profile: 'speed', version: 1 },
    ]) {
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
              id: 10000098,
              name: 'クロリンデ',
              level: 80,
              artifactScore: {
                total: 160.8,
                version: 1,
                perPiece: [{ cv: 34.9, rolls: { critRate: 3 } }],
                roleScore,
              },
            },
          ],
        })),
      );
      expect(
        await callIvrmGameAccounts(guild, user, { action: 'score', gameCode: 'genshin' }, config),
      ).toEqual({ status: 'unavailable' });
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

  it('sends formula in the signed body, within the contract keys (#1366 S3)', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const stamp = '2026-11-19T00:00:00.000Z';
    const request = buildGameAccountsRequest(
      config,
      guild,
      user,
      { action: 'card', gameCode: 'genshin', characterId: '10000098', formula: 'role' },
      id,
      stamp,
    );
    const actionContract = contract.request.actions.card;
    // Same membership assertion style as the ranking test: dropping
    // formula from the bundle must fail here too.
    expect(actionContract.optional).toEqual(expect.arrayContaining(['characterId', 'formula']));
    const expectedKeys = [
      ...contract.request.required,
      ...actionContract.required,
      'characterId',
      'formula',
    ].sort();
    const body = JSON.parse(request.init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(expectedKeys);
    expect(body.formula).toBe('role');
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
      [422, { status: 'error', error: 'invalid_formula' }, { status: 'card-unavailable' }],
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

describe('progress action (HoYoLAB exploration)', () => {
  // The stored snapshot as the API serves it, including the fields the
  // bot never renders (provider / server / roster / image URLs).
  const snapshot = {
    provider: 'hoyolab',
    gameCode: 'genshin',
    uid: '812468719',
    server: 'os_asia',
    player: { nickname: 'いゔる。', level: 56 },
    stats: { activeDays: 320, totalChests: 2270, commonChests: 800 },
    explorations: [
      {
        id: 1,
        name: 'モンド',
        percent: 96.4,
        level: 10,
        offerings: [{ name: '風神像', level: 10 }],
        mapUrl: 'https://example.invalid/map',
        backgroundImage: 'https://example.invalid/bg',
      },
    ],
    endgame: [
      {
        kind: 'spiral_abyss',
        scheduleId: 42,
        maxFloor: '12-3',
        totalStars: 36,
        totalScore: null,
        hasData: true,
      },
    ],
    roster: [{ characterId: 10000098, level: 80, constellation: 5, rarity: 5 }],
  };
  const fetchedAt = '2026-11-16T01:15:00.000Z';

  it('sends gameCode in the signed body, matching the contract keys', () => {
    const id = '44444444-4444-4444-8444-444444444444',
      stamp = '2026-11-16T00:00:00.000Z';
    const key = createHmac('sha256', config.secret).update(contract.hmacPurpose).digest();
    const request = buildGameAccountsRequest(
      config,
      guild,
      user,
      { action: 'progress', gameCode: 'genshin' },
      id,
      stamp,
    );
    const body = JSON.parse(request.init.body) as Record<string, unknown>;
    const actionContract = contract.request.actions.progress;
    expect(Object.keys(body).sort()).toEqual(
      [...contract.request.required, ...actionContract.required, ...actionContract.optional].sort(),
    );
    expect(body.gameCode).toBe('genshin');
    expect(request.init.headers['X-IVRM-Signature']).toBe(
      createHmac('sha256', key)
        .update(['POST', contract.path, stamp, id, request.init.body].join('\n'))
        .digest('hex'),
    );
  });

  it('parses a progress result, keeping the display slice of the snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({
        gameCode: 'genshin',
        uid: '812468719',
        status: 'ok',
        fetchedAt,
        succeededAt: fetchedAt,
        hasProgress: true,
        progress: snapshot,
      })),
    );
    const result = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'progress', gameCode: 'genshin' },
      config,
    );
    expect(result).toMatchObject({
      status: 'ok',
      action: 'progress',
      gameCode: 'genshin',
      uid: '812468719',
      progressStatus: 'ok',
      hasProgress: true,
    });
    if (result.status === 'ok' && result.action === 'progress') {
      expect(result.progress?.player).toEqual({ nickname: 'いゔる。', level: 56 });
      expect(result.progress?.stats.totalChests).toBe(2270);
      expect(result.progress?.explorations).toEqual([
        {
          id: 1,
          name: 'モンド',
          percent: 96.4,
          level: 10,
          offerings: [{ name: '風神像', level: 10 }],
        },
      ]);
      expect(result.progress?.endgame[0]?.kind).toBe('spiral_abyss');
      // Roster and image URLs are stored data the bot never renders.
      expect(result.progress).not.toHaveProperty('roster');
    }
  });

  it('parses the not-yet-fetched result as nulls, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({
        gameCode: 'starrail',
        uid: '804899751',
        status: null,
        fetchedAt: null,
        succeededAt: null,
        hasProgress: false,
        progress: null,
      })),
    );
    expect(
      await callIvrmGameAccounts(guild, user, { action: 'progress', gameCode: 'starrail' }, config),
    ).toEqual({
      status: 'ok',
      action: 'progress',
      gameCode: 'starrail',
      uid: '804899751',
      progressStatus: null,
      fetchedAt: null,
      succeededAt: null,
      hasProgress: false,
      progress: null,
    });
  });

  it('fails closed on malformed snapshots and self-contradicting bodies', async () => {
    const bodies: Array<Record<string, unknown>> = [
      // hasProgress claims a snapshot that is not there.
      { status: 'ok', fetchedAt, succeededAt: fetchedAt, hasProgress: true, progress: null },
      // A snapshot is there but hasProgress denies it.
      { status: 'ok', fetchedAt, succeededAt: fetchedAt, hasProgress: false, progress: snapshot },
      // Explorations must be a list of typed entries.
      {
        status: 'ok',
        fetchedAt,
        succeededAt: fetchedAt,
        hasProgress: true,
        progress: { ...snapshot, explorations: [{ name: 'モンド', percent: '96.4' }] },
      },
      // Unknown endgame kinds are not displayable data.
      {
        status: 'ok',
        fetchedAt,
        succeededAt: fetchedAt,
        hasProgress: true,
        progress: {
          ...snapshot,
          endgame: [
            {
              kind: 'theater_mechanicus',
              scheduleId: null,
              maxFloor: null,
              totalStars: null,
              totalScore: null,
              hasData: true,
            },
          ],
        },
      },
    ];
    for (const body of bodies) {
      vi.stubGlobal(
        'fetch',
        mockJson(() => ({ gameCode: 'genshin', uid: '812468719', ...body })),
      );
      expect(
        await callIvrmGameAccounts(
          guild,
          user,
          { action: 'progress', gameCode: 'genshin' },
          config,
        ),
      ).toEqual({ status: 'unavailable' });
    }
  });

  it('maps progress_not_supported to its own status, keeping member errors distinct', async () => {
    const cases: Array<[number, unknown, unknown]> = [
      [
        422,
        { status: 'error', error: 'progress_not_supported' },
        { status: 'progress-unsupported' },
      ],
      [404, { status: 'error', error: 'member_not_linked' }, { status: 'not-linked' }],
      [
        404,
        { status: 'error', error: 'game_account_not_found' },
        { status: 'not-found', error: 'game_account_not_found' },
      ],
      [
        422,
        { status: 'error', error: 'invalid_input', field: 'gameCode', message: 'bad' },
        { status: 'invalid-input', field: 'gameCode', message: 'bad' },
      ],
    ];
    for (const [status, body, expected] of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body, { status })),
      );
      expect(
        await callIvrmGameAccounts(guild, user, { action: 'progress', gameCode: 'zzz' }, config),
      ).toEqual(expected);
    }
  });
});

describe('ranking action (#1196 R3)', () => {
  const rankingPayload = {
    gameCode: 'genshin',
    axis: 'character',
    formula: 'cv',
    characterId: null,
    slot: null,
    limit: 10,
    populationSize: 1,
    viewerInPopulation: true,
    entries: [
      {
        rank: 1,
        memberName: '自分',
        isSelf: true,
        characterId: '10000098',
        characterNameJa: 'クロリンデ',
        score: 160.8,
        slot: null,
        rollsTotal: 9,
        fetchedAt: '2026-11-18T00:00:00.000Z',
      },
    ],
    selfEntries: [],
    availableCharacters: [
      { characterId: '10000098', characterNameJa: 'クロリンデ', memberCount: 1 },
    ],
    availableSlots: ['flower'],
  };

  it('sends only the contract keys for a ranking request', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const stamp = '2026-11-19T00:00:00.000Z';
    const request = buildGameAccountsRequest(
      config,
      guild,
      user,
      { action: 'ranking', gameCode: 'genshin', axis: 'character', limit: 10 },
      id,
      stamp,
    );
    const actionContract = contract.request.actions.ranking;
    // The keys this client sends must be allowed by the bundle: assert
    // membership instead of only comparing against a hardcoded list, so
    // dropping a key from the contract fails here too.
    expect(actionContract.optional).toEqual(expect.arrayContaining(['axis', 'limit']));
    const expectedKeys = [
      ...contract.request.required,
      ...actionContract.required,
      'axis',
      'limit',
    ].sort();
    expect(Object.keys(JSON.parse(request.init.body)).sort()).toEqual(expectedKeys);
  });

  it('parses a ranking result', async () => {
    const fetch = mockJson(() => rankingPayload);
    vi.stubGlobal('fetch', fetch);
    expect(
      await callIvrmGameAccounts(
        guild,
        user,
        { action: 'ranking', gameCode: 'genshin', axis: 'character', limit: 10 },
        config,
      ),
    ).toEqual({ status: 'ok', action: 'ranking', ...rankingPayload });
  });

  it('fails closed when an entry is malformed', async () => {
    const fetch = mockJson(() => ({
      ...rankingPayload,
      entries: [{ ...rankingPayload.entries[0], score: 'high' }],
    }));
    vi.stubGlobal('fetch', fetch);
    expect(
      await callIvrmGameAccounts(guild, user, { action: 'ranking', gameCode: 'genshin' }, config),
    ).toEqual({ status: 'unavailable' });
  });

  it('fails closed when a rank is not a positive integer', async () => {
    for (const rank of [-1, 0, 1.5]) {
      const fetch = mockJson(() => ({
        ...rankingPayload,
        entries: [{ ...rankingPayload.entries[0], rank }],
      }));
      vi.stubGlobal('fetch', fetch);
      expect(
        await callIvrmGameAccounts(guild, user, { action: 'ranking', gameCode: 'genshin' }, config),
      ).toEqual({ status: 'unavailable' });
    }
  });

  it('maps an invalid ranking query to invalid-input', async () => {
    const fetch = mockJson(() => ({ error: 'invalid_ranking_query' }), 422);
    vi.stubGlobal('fetch', fetch);
    const result = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'ranking', gameCode: 'genshin', axis: 'bogus' },
      config,
    );
    expect(result.status).toBe('invalid-input');
  });
});

describe('ranking_card action (#1402 S3)', () => {
  // A real 1x1 PNG, so the magic-byte check sees an actual PNG payload.
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const rankingCardPayload = {
    gameCode: 'genshin',
    axis: 'character',
    formula: 'cv',
    characterId: null,
    slot: null,
    populationSize: 2,
    entryCount: 10,
    selfRank: 2,
    pngBase64,
  };

  it('sends only the contract keys for a ranking_card request (no limit)', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const stamp = '2026-11-19T00:00:00.000Z';
    const request = buildGameAccountsRequest(
      config,
      guild,
      user,
      { action: 'ranking_card', gameCode: 'genshin', axis: 'character', formula: 'cv' },
      id,
      stamp,
    );
    const actionContract = contract.request.actions.ranking_card;
    expect(actionContract.optional).toEqual(
      expect.arrayContaining(['axis', 'characterId', 'slot', 'formula']),
    );
    expect(actionContract.optional).not.toContain('limit');
    const expectedKeys = [
      ...contract.request.required,
      ...actionContract.required,
      'axis',
      'formula',
    ].sort();
    expect(Object.keys(JSON.parse(request.init.body)).sort()).toEqual(expectedKeys);
  });

  it('parses a ranking_card result and decodes the PNG', async () => {
    vi.stubGlobal(
      'fetch',
      mockJson(() => rankingCardPayload),
    );
    const result = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'ranking_card', gameCode: 'genshin', axis: 'character', formula: 'cv' },
      config,
    );
    expect(result).toMatchObject({
      status: 'ok',
      action: 'ranking_card',
      gameCode: 'genshin',
      populationSize: 2,
      entryCount: 10,
      selfRank: 2,
    });
    if (result.status === 'ok' && result.action === 'ranking_card') {
      expect(Buffer.isBuffer(result.png)).toBe(true);
      expect(result.png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });

  it('fails closed on a non-PNG or malformed ranking_card payload', async () => {
    for (const pngBase64 of ['aGVsbG8gd29ybGQ=', 'not*base64*png', '']) {
      vi.stubGlobal(
        'fetch',
        mockJson(() => ({ ...rankingCardPayload, pngBase64 })),
      );
      expect(
        await callIvrmGameAccounts(
          guild,
          user,
          { action: 'ranking_card', gameCode: 'genshin' },
          config,
        ),
      ).toEqual({ status: 'unavailable' });
    }
  });

  it('fails closed when the self rank is not a positive integer or null', async () => {
    for (const selfRank of [0, -1, 1.5, '2']) {
      vi.stubGlobal(
        'fetch',
        mockJson(() => ({ ...rankingCardPayload, selfRank })),
      );
      expect(
        await callIvrmGameAccounts(
          guild,
          user,
          { action: 'ranking_card', gameCode: 'genshin' },
          config,
        ),
      ).toEqual({ status: 'unavailable' });
    }
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({ ...rankingCardPayload, selfRank: null })),
    );
    const result = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'ranking_card', gameCode: 'genshin' },
      config,
    );
    expect(result.status).toBe('ok');
  });

  it('maps ranking-card errors to ranking-card-unavailable, keeping member errors distinct', async () => {
    const cases: Array<[number, unknown, unknown]> = [
      [404, { status: 'error', error: 'ranking_empty' }, { status: 'ranking-card-unavailable' }],
      [
        502,
        { status: 'error', error: 'card_render_failed' },
        { status: 'ranking-card-unavailable' },
      ],
      [
        503,
        { status: 'error', error: 'card_renderer_unavailable' },
        { status: 'ranking-card-unavailable' },
      ],
      [404, { status: 'error', error: 'member_not_linked' }, { status: 'not-linked' }],
      [
        404,
        { status: 'error', error: 'game_account_not_found' },
        { status: 'not-found', error: 'game_account_not_found' },
      ],
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
          { action: 'ranking_card', gameCode: 'genshin' },
          config,
        ),
      ).toEqual(expected);
    }
  });

  it('accepts a ranking card body above the score cap but rejects one above the card cap', async () => {
    // ~100 KiB of valid PNG-prefixed base64: over the 64 KiB score cap,
    // well under the card cap.
    const medium = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(100_000, 1),
    ]).toString('base64');
    vi.stubGlobal(
      'fetch',
      mockJson(() => ({ ...rankingCardPayload, pngBase64: medium })),
    );
    const ok = await callIvrmGameAccounts(
      guild,
      user,
      { action: 'ranking_card', gameCode: 'genshin' },
      config,
    );
    expect(ok).toMatchObject({ status: 'ok', action: 'ranking_card' });

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
        { action: 'ranking_card', gameCode: 'genshin' },
        config,
      ),
    ).toEqual({ status: 'unavailable' });
  });
});
