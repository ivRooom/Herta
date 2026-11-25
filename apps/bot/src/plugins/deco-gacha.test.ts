import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decoGachaManifest } from '@herta/plugin-catalog';
import {
  buildDecoOmikujiShareCustomId,
  buildDecoOmikujiShareText,
  buildDecoGachaApiRequest,
  decoFortuneColorHex,
  decoFortuneLabel,
  formatDecoGachaApiError,
  normalizeDecoGachaConfig,
  parseDecoOmikujiDraw,
  parseDecoOmikujiShareCustomId,
  parseDecoOmikujiStatus,
  parseDecoProfile,
  resolveDecoGachaApiConfig,
  type DecoGachaApiConfig,
} from './deco-gacha.js';

const apiConfig: DecoGachaApiConfig = {
  apiBaseUrl: 'https://api.ivrm.jp',
  secret: 'deco-test-secret',
};
const userId = '111111111111111111';

describe('deco gacha manifest', () => {
  it('declares the omikuji and deco-card commands', () => {
    expect(decoGachaManifest.id).toBe('deco-gacha');
    expect(decoGachaManifest.commands.map((command) => command.name)).toEqual([
      'omikuji',
      'deco-card',
    ]);
  });
});

describe('normalizeDecoGachaConfig', () => {
  it('defaults to enabled and only accepts exact true', () => {
    expect(normalizeDecoGachaConfig({})).toEqual({ enabled: true });
    expect(normalizeDecoGachaConfig({ enabled: true })).toEqual({ enabled: true });
    expect(normalizeDecoGachaConfig({ enabled: false })).toEqual({ enabled: false });
    expect(normalizeDecoGachaConfig({ enabled: 'true' })).toEqual({ enabled: false });
    expect(normalizeDecoGachaConfig(null)).toEqual({ enabled: true });
  });
});

describe('resolveDecoGachaApiConfig', () => {
  it('requires both the base URL and the deco secret', () => {
    expect(resolveDecoGachaApiConfig({})).toBeNull();
    expect(resolveDecoGachaApiConfig({ IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp' })).toBeNull();
    expect(resolveDecoGachaApiConfig({ HERTA_DECO_BOT_SECRET: 'x' })).toBeNull();
    expect(
      resolveDecoGachaApiConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp/',
        HERTA_DECO_BOT_SECRET: ' secret ',
      }),
    ).toEqual({ apiBaseUrl: 'https://api.ivrm.jp', secret: 'secret' });
  });

  it('rejects non-https remote URLs but allows localhost', () => {
    expect(
      resolveDecoGachaApiConfig({
        IVRM_WEB_API_BASE_URL: 'http://api.ivrm.jp',
        HERTA_DECO_BOT_SECRET: 'x',
      }),
    ).toBeNull();
    expect(
      resolveDecoGachaApiConfig({
        IVRM_WEB_API_BASE_URL: 'http://localhost:8787',
        HERTA_DECO_BOT_SECRET: 'x',
      }),
    ).toEqual({ apiBaseUrl: 'http://localhost:8787', secret: 'x' });
  });
});

describe('buildDecoGachaApiRequest', () => {
  it('signs exactly like ivrm-web herta-deco-service-auth', () => {
    const request = buildDecoGachaApiRequest(
      apiConfig,
      '/gacha/bot/omikuji/draw',
      { discordUserId: userId, guildId: '964326043420872704' },
      { timestamp: '1764000000000', eventId: 'dg-test-event-1' },
    );
    const body = JSON.stringify({ discordUserId: userId, guildId: '964326043420872704' });
    const expected = createHmac('sha256', apiConfig.secret)
      .update(`1764000000000.dg-test-event-1.POST./gacha/bot/omikuji/draw.${body}`)
      .digest('hex');
    expect(request.url).toBe('https://api.ivrm.jp/gacha/bot/omikuji/draw');
    expect(request.init.method).toBe('POST');
    expect(request.init.body).toBe(body);
    expect(request.init.headers['X-IVRM-Timestamp']).toBe('1764000000000');
    expect(request.init.headers['X-IVRM-Event-Id']).toBe('dg-test-event-1');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
  });
});

describe('fortune display', () => {
  it('maps the five fortune keys to Japanese labels', () => {
    expect(decoFortuneLabel('daikichi')).toBe('大吉');
    expect(decoFortuneLabel('kichi')).toBe('吉');
    expect(decoFortuneLabel('chukichi')).toBe('中吉');
    expect(decoFortuneLabel('shokichi')).toBe('小吉');
    expect(decoFortuneLabel('suekichi')).toBe('末吉');
    expect(decoFortuneLabel('unknown')).toBeNull();
    expect(decoFortuneLabel(null)).toBeNull();
    expect(decoFortuneColorHex('daikichi')).toBe('#f5c542');
  });
});

describe('parseDecoOmikujiDraw', () => {
  it('accepts a well-formed draw result', () => {
    expect(
      parseDecoOmikujiDraw({
        status: 'ok',
        alreadyDrawn: false,
        dateJst: '2026-11-25',
        fortune: 'daikichi',
        shardsAwarded: 20,
        ticketAwarded: true,
        limitedItemId: null,
        balances: { tickets: 1, shards: 20, points: 0, pointsMilli: 0 },
      }),
    ).toEqual({
      alreadyDrawn: false,
      dateJst: '2026-11-25',
      fortune: 'daikichi',
      shardsAwarded: 20,
      ticketAwarded: true,
      limitedItemId: null,
    });
  });

  it('rejects error payloads and unknown fortunes (fail-closed)', () => {
    expect(parseDecoOmikujiDraw(null)).toBeNull();
    expect(parseDecoOmikujiDraw({ status: 'error', code: 'x' })).toBeNull();
    expect(
      parseDecoOmikujiDraw({
        status: 'ok',
        dateJst: '2026-11-25',
        fortune: 'jackpot',
        shardsAwarded: 20,
      }),
    ).toBeNull();
    expect(
      parseDecoOmikujiDraw({ status: 'ok', dateJst: '2026-11-25', fortune: 'kichi' }),
    ).toBeNull();
  });
});

describe('parseDecoOmikujiStatus and share text', () => {
  const status = parseDecoOmikujiStatus({
    status: 'ok',
    dateJst: '2026-11-25',
    drawnToday: true,
    today: {
      fortune: 'chukichi',
      shardsAwarded: 5,
      ticketAwarded: false,
      limitedItemId: null,
      drawnAt: '2026-11-25T00:01:00.000Z',
    },
    outcomes: [],
  });

  it('parses the status payload', () => {
    expect(status?.drawnToday).toBe(true);
    expect(status?.today?.fortune).toBe('chukichi');
  });

  it('builds the public share text with rewards and the Web link', () => {
    const text = buildDecoOmikujiShareText('メンバー', status!);
    expect(text).toContain('中吉');
    expect(text).toContain('きらめき欠片 +5');
    expect(text).toContain('https://member.ivrm.jp/gacha');
  });

  it('reports drawnToday false when no draw exists yet', () => {
    const empty = parseDecoOmikujiStatus({
      status: 'ok',
      dateJst: '2026-11-25',
      drawnToday: false,
      today: null,
    });
    expect(empty?.drawnToday).toBe(false);
    expect(empty?.today).toBeNull();
    expect(buildDecoOmikujiShareText('メンバー', empty!)).toBeNull();
  });
});

describe('share custom id', () => {
  it('round-trips user id and JST date', () => {
    const customId = buildDecoOmikujiShareCustomId(userId, '2026-11-25');
    expect(customId).toBe(`dg:omikuji-share:${userId}:2026-11-25`);
    expect(parseDecoOmikujiShareCustomId(customId)).toEqual({
      userId,
      dateJst: '2026-11-25',
    });
  });

  it('rejects foreign or malformed ids', () => {
    expect(parseDecoOmikujiShareCustomId('dqr:abc')).toBeNull();
    expect(parseDecoOmikujiShareCustomId('dg:omikuji-share:abc:2026-11-25')).toBeNull();
    expect(parseDecoOmikujiShareCustomId(`dg:omikuji-share:${userId}:25-11-2026`)).toBeNull();
  });
});

describe('parseDecoProfile', () => {
  it('accepts the five slots with items and nulls', () => {
    const profile = parseDecoProfile({
      status: 'ok',
      discordUserId: userId,
      equipment: {
        frame: {
          id: 'item_frame',
          kind: 'frame',
          rarity: 'SR',
          name: '彗星トレイル',
          imageUrl: 'https://example.com/frame.png',
        },
        title: {
          id: 'item_title',
          kind: 'title',
          rarity: 'SR',
          name: '星詠み',
          imageUrl: null,
        },
        cover: null,
        theme: null,
        card_skin: null,
      },
      fortuneToday: 'kichi',
    });
    expect(profile?.equipment.frame?.name).toBe('彗星トレイル');
    expect(profile?.equipment.title?.name).toBe('星詠み');
    expect(profile?.equipment.cover).toBeNull();
    expect(profile?.equipment.card_skin).toBeNull();
    expect(profile?.fortuneToday).toBe('kichi');
  });

  it('drops an unknown fortune and rejects malformed payloads', () => {
    const profile = parseDecoProfile({
      status: 'ok',
      discordUserId: userId,
      equipment: {},
      fortuneToday: 'jackpot',
    });
    expect(profile?.fortuneToday).toBeNull();
    expect(profile?.equipment.frame).toBeNull();
    expect(parseDecoProfile({ status: 'error' })).toBeNull();
    expect(parseDecoProfile(null)).toBeNull();
  });
});

describe('formatDecoGachaApiError', () => {
  it('maps the known codes to member-facing messages', () => {
    expect(
      formatDecoGachaApiError({
        ok: false,
        status: 401,
        data: { code: 'bot_api_disabled' },
      }),
    ).toContain('有効化されていません');
    expect(
      formatDecoGachaApiError({
        ok: false,
        status: 404,
        data: { code: 'user_not_registered' },
      }),
    ).toContain('アカウントが見つかりませんでした');
    expect(
      formatDecoGachaApiError({
        ok: false,
        status: 404,
        data: { code: 'omikuji_disabled' },
      }),
    ).toContain('公開準備中');
    expect(formatDecoGachaApiError({ ok: false, status: 0, data: null })).toContain(
      '接続できませんでした',
    );
    expect(
      formatDecoGachaApiError({
        ok: false,
        status: 503,
        data: { code: 'deco_bot_unavailable' },
      }),
    ).toContain('サーバー側で処理できませんでした');
  });
});
