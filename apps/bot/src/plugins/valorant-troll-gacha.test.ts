import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildValorantTrollApiRequest,
  buildValorantTrollDrawFields,
  drawValorantTrolls,
  formatValorantTrollCardText,
  formatValorantTrollEmbedText,
  mergeValorantTrollsIntoResult,
  normalizeValorantTrollConfig,
  parseValorantTrollDrawResponse,
  readValorantTrollFromEntry,
  resolveValorantTrollApiConfig,
  valorantTrollIdempotencyKey,
  type ValorantTroll,
  type ValorantTrollApiConfig,
  type ValorantTrollDrawInput,
} from './valorant-troll-gacha.js';

const API: ValorantTrollApiConfig = { apiBaseUrl: 'https://api.ivrm.jp', secret: 'test-secret' };

const TROLL: ValorantTroll = {
  itemId: 'troll-item-1',
  text: 'ショーティのみで戦う',
  rarity: 'rare',
  category: 'troll',
};

function drawInput(overrides: Partial<ValorantTrollDrawInput> = {}): ValorantTrollDrawInput {
  return {
    operatorDiscordUserId: '123456789012345678',
    guildId: '964326043420872704',
    sessionId: 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05',
    participants: [
      { discordUserId: '111111111111111111', name: 'Alice' },
      { discordUserId: '222222222222222222', name: 'Bob' },
      { discordUserId: '333333333333333333', name: 'Carol' },
    ],
    trollOffDiscordUserIds: ['333333333333333333'],
    config: { enabled: true, count: 2, rarityFilter: 'all', categories: ['troll', 'punishment'] },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('resolveValorantTrollApiConfig', () => {
  it('returns null unless both base URL and secret are set', () => {
    expect(resolveValorantTrollApiConfig({})).toBeNull();
    expect(
      resolveValorantTrollApiConfig({ IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp' }),
    ).toBeNull();
    expect(resolveValorantTrollApiConfig({ HERTA_TROLL_BOT_SECRET: 'x' })).toBeNull();
    expect(
      resolveValorantTrollApiConfig({
        IVRM_WEB_API_BASE_URL: 'http://example.com',
        HERTA_TROLL_BOT_SECRET: 'x',
      }),
    ).toBeNull();
    expect(
      resolveValorantTrollApiConfig({
        IVRM_WEB_API_BASE_URL: 'not a url',
        HERTA_TROLL_BOT_SECRET: 'x',
      }),
    ).toBeNull();
  });

  it('trims a trailing slash and allows localhost http', () => {
    expect(
      resolveValorantTrollApiConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp/',
        HERTA_TROLL_BOT_SECRET: 'secret',
      }),
    ).toEqual({ apiBaseUrl: 'https://api.ivrm.jp', secret: 'secret' });
    expect(
      resolveValorantTrollApiConfig({
        IVRM_WEB_API_BASE_URL: 'http://localhost:8787',
        HERTA_TROLL_BOT_SECRET: 'secret',
      })?.apiBaseUrl,
    ).toBe('http://localhost:8787');
  });
});

describe('buildValorantTrollApiRequest', () => {
  it('signs with the shared HMAC format used by the ivrm-web auth layer', () => {
    const fields = { discordUserId: '123456789012345678', guildId: '964326043420872704' };
    const request = buildValorantTrollApiRequest(API, fields, {
      timestamp: '1764216000000',
      eventId: 'vt-fixed-event',
    });
    const expected = createHmac('sha256', 'test-secret')
      .update(
        `1764216000000.vt-fixed-event.POST./valorant/bot/troll/draw.${JSON.stringify(fields)}`,
      )
      .digest('hex');
    expect(request.url).toBe('https://api.ivrm.jp/valorant/bot/troll/draw');
    expect(request.init.method).toBe('POST');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
    expect(request.init.headers['X-IVRM-Timestamp']).toBe('1764216000000');
    expect(request.init.headers['X-IVRM-Event-Id']).toBe('vt-fixed-event');
    expect(request.init.body).toBe(JSON.stringify(fields));
  });
});

describe('valorantTrollIdempotencyKey', () => {
  it('is stable per session row and matches the S1 key pattern', () => {
    const key = valorantTrollIdempotencyKey('cfc92874-f6ab-4a68-9acf-c5ecc5010a05');
    expect(key).toBe('herta-valorant-troll:cfc92874-f6ab-4a68-9acf-c5ecc5010a05');
    expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(valorantTrollIdempotencyKey('cfc92874-f6ab-4a68-9acf-c5ecc5010a05')).toBe(key);
    expect(valorantTrollIdempotencyKey('aaaaaaaa-1111-2222-3333-444444444444')).not.toBe(key);
  });
});

describe('buildValorantTrollDrawFields', () => {
  it('passes guild config and troll-off exclusions through to S1', () => {
    const fields = buildValorantTrollDrawFields(drawInput());
    expect(fields).toMatchObject({
      discordUserId: '123456789012345678',
      guildId: '964326043420872704',
      trollCount: 2,
      rarityFilter: 'all',
      categories: ['troll', 'punishment'],
      trollOffDiscordUserIds: ['333333333333333333'],
      idempotencyKey: 'herta-valorant-troll:cfc92874-f6ab-4a68-9acf-c5ecc5010a05',
    });
    expect(fields['participants']).toEqual([
      { discordUserId: '111111111111111111', name: 'Alice' },
      { discordUserId: '222222222222222222', name: 'Bob' },
      { discordUserId: '333333333333333333', name: 'Carol' },
    ]);
  });

  it('sanitizes names to the S1 contract (non-empty, max 64 chars) and dedupes troll-off ids', () => {
    const fields = buildValorantTrollDrawFields(
      drawInput({
        participants: [
          { discordUserId: '111111111111111111', name: '  ' },
          { discordUserId: '222222222222222222', name: 'あ'.repeat(80) },
        ],
        trollOffDiscordUserIds: ['333333333333333333', '333333333333333333'],
      }),
    );
    const participants = fields['participants'] as { name: string }[];
    expect(participants[0]?.name).toBe('参加者1');
    expect(participants[1]?.name).toHaveLength(64);
    expect(fields['trollOffDiscordUserIds']).toEqual(['333333333333333333']);
  });
});

describe('normalizeValorantTrollConfig', () => {
  it('defaults to disabled with two trolls and no filters', () => {
    expect(normalizeValorantTrollConfig({})).toEqual({
      enabled: false,
      count: 2,
      rarityFilter: 'all',
      categories: ['troll', 'punishment', 'settings', 'custom'],
    });
  });

  it('clamps count, validates the rarity filter and filters categories', () => {
    expect(
      normalizeValorantTrollConfig({
        trollGachaEnabled: true,
        trollCount: 9,
        trollRarityFilter: 'rare_plus',
        trollCategories: ['settings', 'settings', 'bogus', 'troll'],
      }),
    ).toEqual({
      enabled: true,
      count: 5,
      rarityFilter: 'rare_plus',
      categories: ['settings', 'troll'],
    });
    expect(normalizeValorantTrollConfig({ trollCount: 0 }).count).toBe(1);
    expect(normalizeValorantTrollConfig({ trollRarityFilter: 'nope' }).rarityFilter).toBe('all');
    expect(normalizeValorantTrollConfig({ trollCategories: [] }).categories).toEqual([
      'troll',
      'punishment',
      'settings',
      'custom',
    ]);
  });
});

describe('parseValorantTrollDrawResponse', () => {
  it('parses assignments including troll-off participants with null trolls', () => {
    const parsed = parseValorantTrollDrawResponse({
      status: 'ok',
      drawId: 'draw-1',
      alreadyDrawn: false,
      assignments: [
        { participantKey: '111111111111111111', participantName: 'Alice', troll: TROLL },
        { participantKey: '333333333333333333', participantName: 'Carol', troll: null },
      ],
    });
    expect(parsed?.drawId).toBe('draw-1');
    expect(parsed?.alreadyDrawn).toBe(false);
    expect(parsed?.trollByUserId.get('111111111111111111')).toEqual(TROLL);
    expect(parsed?.trollByUserId.get('333333333333333333')).toBeNull();
  });

  it('rejects malformed payloads', () => {
    expect(parseValorantTrollDrawResponse(null)).toBeNull();
    expect(parseValorantTrollDrawResponse({ status: 'error' })).toBeNull();
    expect(parseValorantTrollDrawResponse({ status: 'ok', assignments: [] })).toBeNull();
    expect(
      parseValorantTrollDrawResponse({
        status: 'ok',
        drawId: 'draw-1',
        assignments: [{ participantKey: '1', troll: { ...TROLL, rarity: 'mythic' } }],
      }),
    ).toBeNull();
  });
});

describe('drawValorantTrolls (fail-soft)', () => {
  it('returns assignments on success and sends the S1 contract body', async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetcher = vi.fn(async (_url: string, init?: { body?: string }) => {
      sentBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return jsonResponse({
        status: 'ok',
        drawId: 'draw-9',
        alreadyDrawn: true,
        assignments: [
          { participantKey: '111111111111111111', participantName: 'Alice', troll: TROLL },
          { participantKey: '222222222222222222', participantName: 'Bob', troll: null },
          { participantKey: '333333333333333333', participantName: 'Carol', troll: null },
        ],
      });
    });
    const result = await drawValorantTrolls(API, drawInput(), fetcher as unknown as typeof fetch);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.drawId).toBe('draw-9');
      expect(result.alreadyDrawn).toBe(true);
      expect(result.trollByUserId.get('111111111111111111')).toEqual(TROLL);
      expect(result.trollByUserId.get('333333333333333333')).toBeNull();
    }
    expect(sentBody).toMatchObject({
      trollOffDiscordUserIds: ['333333333333333333'],
      trollCount: 2,
      idempotencyKey: 'herta-valorant-troll:cfc92874-f6ab-4a68-9acf-c5ecc5010a05',
    });
  });

  it.each([
    [404, 'troll_gacha_disabled'],
    [401, 'invalid_service_auth'],
    [422, 'invalid_request'],
    [409, 'troll_pool_exhausted'],
    [503, 'troll_draw_unavailable'],
  ])('maps HTTP %i to unavailable with its code', async (status, code) => {
    const fetcher = vi.fn(async () => jsonResponse({ status: 'error', error: code, code }, status));
    const result = await drawValorantTrolls(API, drawInput(), fetcher as unknown as typeof fetch);
    expect(result).toEqual({ status: 'unavailable', httpStatus: status, code });
  });

  it('treats network failures and malformed success bodies as unavailable', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await drawValorantTrolls(API, drawInput(), throwing as unknown as typeof fetch)).toEqual(
      { status: 'unavailable', httpStatus: 0, code: null },
    );
    const malformed = vi.fn(async () => new Response('not json', { status: 200 }));
    expect(
      await drawValorantTrolls(API, drawInput(), malformed as unknown as typeof fetch),
    ).toEqual({ status: 'unavailable', httpStatus: 200, code: 'invalid_response' });
  });
});

describe('mergeValorantTrollsIntoResult / readValorantTrollFromEntry', () => {
  it('merges trolls into a copy of the result without mutating the original', () => {
    const result = [
      { userId: '111111111111111111', agentId: 'jett', agentName: 'Jett', displayName: 'ジェット' },
      { userId: '222222222222222222', agentId: 'sage', agentName: 'Sage', displayName: 'セージ' },
    ];
    const merged = mergeValorantTrollsIntoResult(
      result,
      new Map<string, ValorantTroll | null>([
        ['111111111111111111', TROLL],
        ['222222222222222222', null],
      ]),
    );
    expect(merged).toHaveLength(2);
    expect(readValorantTrollFromEntry(merged?.[0])).toEqual(TROLL);
    expect(readValorantTrollFromEntry(merged?.[1])).toBeNull();
    expect(result[0]).not.toHaveProperty('troll');
    expect(mergeValorantTrollsIntoResult('nope', new Map())).toBeNull();
  });

  it('rejects malformed troll fields when reading entries back', () => {
    expect(readValorantTrollFromEntry({ troll: { ...TROLL, category: 'unknown' } })).toBeNull();
    expect(readValorantTrollFromEntry({})).toBeNull();
    expect(readValorantTrollFromEntry(null)).toBeNull();
  });
});

describe('display formats', () => {
  it('formats embed and card texts with rarity and category labels', () => {
    expect(formatValorantTrollEmbedText(TROLL)).toBe(
      '🎭 縛り[レア / トロール] ショーティのみで戦う',
    );
    expect(formatValorantTrollCardText(TROLL)).toBe('縛り[レア] ショーティのみで戦う');
    expect(
      formatValorantTrollEmbedText({ ...TROLL, rarity: 'ultra_rare', category: 'settings' }),
    ).toContain('ウルトラレア / 設定変更');
  });
});
