import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  buildTodayHistoryRequest,
  parseDailyBundle,
  parseTodayHistoryPayload,
  parseTodayHistoryResponse,
  resolveTodayHistoryConfig,
  TODAY_HISTORY_PATH,
  type TodayHistoryConfig,
} from './daily-today-history.js';

const config: TodayHistoryConfig = {
  apiBaseUrl: 'https://api.example.test',
  secret: 'test-secret',
  guildId: '964326043420872704',
};

describe('today-history config', () => {
  it('requires an https base URL, the points secret and a numeric guild id', () => {
    expect(
      resolveTodayHistoryConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.example.test/',
        HERTA_POINTS_SECRET: 's',
        IVRM_INTEGRATION_GUILD_ID: '964326043420872704',
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.example.test',
      secret: 's',
      guildId: '964326043420872704',
    });
    expect(
      resolveTodayHistoryConfig({
        IVRM_WEB_API_BASE_URL: 'http://api.example.test',
        HERTA_POINTS_SECRET: 's',
        IVRM_INTEGRATION_GUILD_ID: '964326043420872704',
      }),
    ).toBeNull();
    expect(
      resolveTodayHistoryConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.example.test',
        IVRM_INTEGRATION_GUILD_ID: '964326043420872704',
      }),
    ).toBeNull();
  });
});

describe('today-history request', () => {
  it('signs the confirm request with the points HMAC contract', () => {
    const request = buildTodayHistoryRequest(
      config,
      config.guildId,
      '2026-10-30',
      'request-1',
      '2026-10-30T00:00:00.000Z',
    );
    expect(request.url).toBe(`https://api.example.test${TODAY_HISTORY_PATH}`);
    const body = JSON.stringify({ guildId: config.guildId, date: '2026-10-30', mode: 'confirm' });
    expect(request.init.body).toBe(body);
    const expected = createHmac('sha256', 'test-secret')
      .update(`2026-10-30T00:00:00.000Z.request-1.POST.${TODAY_HISTORY_PATH}.${body}`)
      .digest('hex');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
  });
});

const item = {
  id: 'nintendo_pikmin3_deluxe_jp',
  title: '『ピクミン３ デラックス』発売記念日',
  summary: '発売された日です。',
  category: 'game',
  seriesKey: null,
  originYear: 2020,
  anniversaryYears: 6,
  sourceUrl: 'https://example.test/official',
  sourceLabel: null,
  tagIds: [],
};

describe('today-history response parsing', () => {
  it('maps a confirmed selection to renderable events', () => {
    const events = parseTodayHistoryResponse(
      { date: '2026-10-30', confirmed: true, items: [item] },
      '2026-10-30',
      3,
    );
    expect(events).toEqual([
      {
        title: item.title,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        anniversary: 6,
      },
    ]);
  });
  it('rejects unconfirmed payloads, other dates and non-https sources', () => {
    expect(
      parseTodayHistoryResponse(
        { date: '2026-10-30', confirmed: false, items: [item] },
        '2026-10-30',
        3,
      ),
    ).toBeNull();
    expect(
      parseTodayHistoryResponse(
        { date: '2026-10-31', confirmed: true, items: [item] },
        '2026-10-30',
        3,
      ),
    ).toBeNull();
    expect(
      parseTodayHistoryResponse(
        {
          date: '2026-10-30',
          confirmed: true,
          items: [{ ...item, sourceUrl: 'http://example.test/x' }],
        },
        '2026-10-30',
        3,
      ),
    ).toBeNull();
  });
  it('parses the daily bundle alongside the events', () => {
    const payload = parseTodayHistoryPayload(
      {
        date: '2026-10-31',
        confirmed: true,
        items: [item],
        bundle: {
          contractVersion: 1,
          themeKey: 'halloween',
          themeSource: 'annual',
          image: {
            url: 'https://example.test/banner.png',
            width: 1920,
            height: 1080,
            alt: 'ハロウィン',
            source: 'annual',
          },
        },
      },
      '2026-10-31',
      3,
    );
    expect(payload?.events).toHaveLength(1);
    expect(payload?.bundle).toEqual({
      themeKey: 'halloween',
      image: {
        url: 'https://example.test/banner.png',
        width: 1920,
        height: 1080,
        alt: 'ハロウィン',
      },
      video: null,
    });
  });
  it('parses a contract v2 video and degrades a malformed one on its own', () => {
    expect(
      parseDailyBundle({
        contractVersion: 2,
        themeKey: null,
        themeSource: null,
        image: null,
        video: { url: 'https://example.test/movie.mp4', source: 'date' },
      }),
    ).toEqual({
      themeKey: null,
      image: null,
      video: { url: 'https://example.test/movie.mp4' },
    });
    // A malformed video never discards a valid image or theme.
    expect(
      parseDailyBundle({
        contractVersion: 2,
        themeKey: 'sakura',
        themeSource: 'date',
        image: null,
        video: { url: 'http://example.test/movie.mp4', source: 'date' },
      }),
    ).toEqual({ themeKey: 'sakura', image: null, video: null });
    // A v1 bundle never carries a video, even if a field is present.
    expect(
      parseDailyBundle({
        contractVersion: 1,
        themeKey: null,
        themeSource: null,
        image: null,
        video: { url: 'https://example.test/movie.mp4', source: 'date' },
      }),
    ).toEqual({ themeKey: null, image: null, video: null });
  });
  it('keeps events when the bundle is absent or malformed', () => {
    const base = { date: '2026-10-30', confirmed: true, items: [item] };
    expect(parseTodayHistoryPayload(base, '2026-10-30', 3)?.bundle).toBeNull();
    expect(
      parseTodayHistoryPayload(
        { ...base, bundle: { contractVersion: 3, themeKey: null, themeSource: null, image: null } },
        '2026-10-30',
        3,
      )?.bundle,
    ).toBeNull();
    expect(
      parseDailyBundle({
        contractVersion: 1,
        themeKey: 'unknown-theme',
        themeSource: null,
        image: null,
      }),
    ).toBeNull();
    expect(
      parseDailyBundle({
        contractVersion: 1,
        themeKey: null,
        themeSource: null,
        image: {
          url: 'http://example.test/banner.png',
          width: 1920,
          height: 1080,
          alt: null,
          source: 'default',
        },
      }),
    ).toBeNull();
  });
  it('rejects a hostless image URL that EmbedBuilder would throw on', () => {
    expect(
      parseDailyBundle({
        contractVersion: 1,
        themeKey: null,
        themeSource: null,
        image: { url: 'https://', width: 1920, height: 1080, alt: null, source: 'default' },
      }),
    ).toBeNull();
  });
  it('keeps a valid bundle when the item selection is invalid', () => {
    const payload = parseTodayHistoryPayload(
      {
        date: '2026-10-30',
        confirmed: true,
        items: [{ ...item, summary: 42 }],
        bundle: { contractVersion: 1, themeKey: 'sakura', themeSource: 'date', image: null },
      },
      '2026-10-30',
      3,
    );
    expect(payload).toEqual({
      events: [],
      bundle: { themeKey: 'sakura', image: null, video: null },
    });
    expect(
      parseTodayHistoryPayload(
        {
          date: '2026-10-31',
          confirmed: true,
          items: [item],
          bundle: { contractVersion: 1, themeKey: 'sakura', themeSource: 'date', image: null },
        },
        '2026-10-30',
        3,
      ),
    ).toBeNull();
  });
  it('accepts a theme-only bundle and an empty bundle', () => {
    expect(
      parseDailyBundle({
        contractVersion: 1,
        themeKey: 'sakura',
        themeSource: 'date',
        image: null,
      }),
    ).toEqual({ themeKey: 'sakura', image: null, video: null });
    expect(
      parseDailyBundle({ contractVersion: 1, themeKey: null, themeSource: null, image: null }),
    ).toEqual({ themeKey: null, image: null, video: null });
  });
  it('caps at three and keeps an empty day empty', () => {
    const many = [item, item, item, item].map((e, i) => ({ ...e, id: `e${i}` }));
    expect(
      parseTodayHistoryResponse(
        { date: '2026-10-30', confirmed: true, items: many },
        '2026-10-30',
        3,
      ),
    ).toHaveLength(3);
    expect(
      parseTodayHistoryResponse(
        { date: '2026-10-30', confirmed: true, items: [] },
        '2026-10-30',
        3,
      ),
    ).toEqual([]);
  });
});
