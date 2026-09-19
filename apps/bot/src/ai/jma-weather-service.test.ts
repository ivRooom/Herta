import { describe, expect, it, vi } from 'vitest';
import type { AiRuntimeGenerationService } from './runtime-service.js';
import {
  fetchJmaForecastSummary,
  fetchJmaObservationSummary,
  JmaWeatherError,
  withAiJmaWeatherGroundingContext,
} from './jma-weather-service.js';

const TOKYO_AREA = { officeCode: '130000', amedasStationCode: '44132', displayName: '東京' };

function jsonResponse(body: unknown, contentLength?: number): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status: 200,
    headers: { 'content-length': String(contentLength ?? text.length) },
  });
}

function textResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { 'content-length': String(text.length) } });
}

/** Mirrors the real JMA short-term forecast shape: 3 days of weathers, finer-grained pops. */
function forecastFixture() {
  return [
    {
      timeSeries: [
        {
          timeDefines: [
            '2026-09-19T17:00:00+09:00',
            '2026-09-20T00:00:00+09:00',
            '2026-09-21T00:00:00+09:00',
          ],
          areas: [{ weathers: ['くもり', '晴れ時々くもり', '雨'] }],
        },
        {
          timeDefines: [
            '2026-09-19T18:00:00+09:00',
            '2026-09-20T00:00:00+09:00',
            '2026-09-20T06:00:00+09:00',
            '2026-09-20T12:00:00+09:00',
            '2026-09-20T18:00:00+09:00',
          ],
          areas: [{ pops: ['', '10', '20', '30', '40'] }],
        },
      ],
    },
  ];
}

describe('fetchJmaForecastSummary', () => {
  it('指定した日付(targetDateJst)のweathers/popsだけを抽出する', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(forecastFixture()));

    await expect(fetchJmaForecastSummary(TOKYO_AREA, fetchImpl, '2026-09-19')).resolves.toEqual({
      forDateJst: '2026-09-19',
      weatherText: 'くもり',
      precipitationProbabilityPercent: null,
    });
  });

  it('翌日を指定すると前日ではなく翌日のweathers/popsを返す(日付を無視する回帰を防ぐ)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(forecastFixture()));

    await expect(fetchJmaForecastSummary(TOKYO_AREA, fetchImpl, '2026-09-20')).resolves.toEqual({
      forDateJst: '2026-09-20',
      weatherText: '晴れ時々くもり',
      precipitationProbabilityPercent: 40,
    });
  });

  it('JMAの予報範囲(約2日先まで)を超える日付はfake dataを作らずnot_foundにする', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(forecastFixture()));

    await expect(
      fetchJmaForecastSummary(TOKYO_AREA, fetchImpl, '2026-09-25'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('不正なJSONはinvalid_responseとしてfail closedする', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('not json', { status: 200, headers: { 'content-length': '8' } }),
    );

    await expect(
      fetchJmaForecastSummary(TOKYO_AREA, fetchImpl, '2026-09-19'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('timeSeriesが空の応答はnot_foundにする(fake dataを作らない)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([{ timeSeries: [] }]));

    await expect(
      fetchJmaForecastSummary(TOKYO_AREA, fetchImpl, '2026-09-19'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('宣言されたcontent-lengthが上限を超える場合は本文を読まずrejectする', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse([{ timeSeries: [] }], 10_000_000),
    );

    await expect(
      fetchJmaForecastSummary(TOKYO_AREA, fetchImpl, '2026-09-19'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('AbortErrorはJmaWeatherErrorのtimeoutコードへ変換する', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(
      fetchJmaForecastSummary(TOKYO_AREA, fetchImpl, '2026-09-19'),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('fetchJmaObservationSummary', () => {
  it('latest_timeとmapデータから観測値を抽出する', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('2026-09-19T21:20:00+09:00'))
      .mockResolvedValueOnce(
        jsonResponse({ '44132': { temp: [17.7, 0], humidity: [89, 0], wind: [0.6, 0] } }),
      );

    await expect(fetchJmaObservationSummary(TOKYO_AREA, fetchImpl)).resolves.toEqual({
      tempCelsius: 17.7,
      humidityPercent: 89,
      windSpeedMs: 0.6,
    });

    const secondCallUrl = fetchImpl.mock.calls[1]?.[0];
    expect(String(secondCallUrl)).toContain('20260919212000');
  });

  it('対象観測所コードが応答に存在しない場合はnot_foundにする', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('2026-09-19T21:20:00+09:00'))
      .mockResolvedValueOnce(jsonResponse({ '99999': { temp: [10, 0] } }));

    await expect(fetchJmaObservationSummary(TOKYO_AREA, fetchImpl)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('latest_timeの形式が不正な場合はinvalid_responseにする', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(textResponse('not-a-timestamp'));

    await expect(fetchJmaObservationSummary(TOKYO_AREA, fetchImpl)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('withAiJmaWeatherGroundingContext', () => {
  function successResponse() {
    return {
      requestId: 'req-1',
      provider: 'openai' as const,
      model: 'gpt-5.6-terra' as const,
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      estimatedCost: 0,
    };
  }

  function baseRequest(
    overrides: Partial<Parameters<AiRuntimeGenerationService['generate']>[0]> = {},
  ) {
    return {
      feature: 'chat',
      input: '東京の天気は？',
      guildId: 'guild-1',
      scopeGuildId: 'guild-1',
      userId: 'user-1',
      authorized: true,
      pluginEnabled: true,
      guildOptIn: true,
      groundingState: 'insufficient' as const,
      ...overrides,
    };
  }

  it('groundingStateがinsufficientでない場合は素通りする', async () => {
    const generate = vi.fn(async () => successResponse());
    const service = withAiJmaWeatherGroundingContext(
      { generate },
      { fetchImpl: vi.fn<typeof fetch>() },
    );

    await service.generate(baseRequest({ groundingState: 'not_required' }));

    expect(generate).toHaveBeenCalledWith(baseRequest({ groundingState: 'not_required' }));
  });

  it('天気の質問でなければ素通りする', async () => {
    const generate = vi.fn(async () => successResponse());
    const service = withAiJmaWeatherGroundingContext(
      { generate },
      { fetchImpl: vi.fn<typeof fetch>() },
    );

    await service.generate(baseRequest({ input: 'ReactとVueを比較して' }));

    expect(generate).toHaveBeenCalledWith(baseRequest({ input: 'ReactとVueを比較して' }));
  });

  it('allowlistにない地名は素通りする(fake groundingにしない)', async () => {
    const generate = vi.fn(async () => successResponse());
    const fetchImpl = vi.fn<typeof fetch>();
    const service = withAiJmaWeatherGroundingContext({ generate }, { fetchImpl });

    await service.generate(baseRequest({ input: 'ニューヨークの天気は？' }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(baseRequest({ input: 'ニューヨークの天気は？' }));
  });

  it('取得成功時はgroundingStateをgroundedへ昇格し実データをinputへ含める', async () => {
    const generate = vi.fn<AiRuntimeGenerationService['generate']>(async () => successResponse());
    // Observation (latest_time -> map) and forecast fetch concurrently via Promise.all, so
    // dispatch by URL instead of assuming a fixed call order.
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const href = String(url);
      if (href.includes('latest_time.txt')) return textResponse('2026-09-19T21:20:00+09:00');
      if (href.includes('/amedas/data/map/')) return jsonResponse({ '44132': { temp: [20, 0] } });
      if (href.includes('/forecast/data/forecast/')) return jsonResponse(forecastFixture());
      throw new Error(`unexpected URL in test: ${href}`);
    });
    const service = withAiJmaWeatherGroundingContext(
      { generate },
      { fetchImpl, now: () => new Date('2026-09-19T13:00:00+09:00') },
    );

    await service.generate(baseRequest());

    expect(generate).toHaveBeenCalledTimes(1);
    const sentRequest = generate.mock.calls[0]?.[0];
    expect(sentRequest?.groundingState).toBe('grounded');
    expect(sentRequest?.input).toContain('weatherGroundingContext');
    expect(sentRequest?.input).toContain('東京');
    expect(sentRequest?.input).toContain('くもり');
    expect(sentRequest?.trustedInstructions).toEqual(
      expect.arrayContaining([expect.stringContaining('weatherGroundingContext')]),
    );
  });

  it('「明日」の質問には翌日のforecastを返し、実況(observation)は取得しない', async () => {
    const generate = vi.fn<AiRuntimeGenerationService['generate']>(async () => successResponse());
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const href = String(url);
      if (href.includes('/forecast/data/forecast/')) return jsonResponse(forecastFixture());
      throw new Error(`observation should not be fetched for a future day: ${href}`);
    });
    const service = withAiJmaWeatherGroundingContext(
      { generate },
      { fetchImpl, now: () => new Date('2026-09-19T13:00:00+09:00') },
    );

    await service.generate(baseRequest({ input: '東京の明日の天気は？' }));

    const sentRequest = generate.mock.calls[0]?.[0];
    expect(sentRequest?.groundingState).toBe('grounded');
    expect(sentRequest?.input).toContain('forecastDate: 2026-09-20');
    expect(sentRequest?.input).toContain('晴れ時々くもり');
    expect(sentRequest?.input).not.toContain('observedTempCelsius');
  });

  it('JMAの予報範囲を超える日付を聞かれた場合はfail closedし、fake successにしない', async () => {
    const generate = vi.fn<AiRuntimeGenerationService['generate']>(async () => successResponse());
    // Only today/tomorrow are covered — 明後日 (day+2) falls outside this forecast's range.
    const shortRangeForecast = [
      {
        timeSeries: [
          {
            timeDefines: ['2026-09-19T17:00:00+09:00', '2026-09-20T00:00:00+09:00'],
            areas: [{ weathers: ['くもり', '晴れ'] }],
          },
        ],
      },
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const href = String(url);
      if (href.includes('/forecast/data/forecast/')) return jsonResponse(shortRangeForecast);
      throw new Error(`unexpected URL in test: ${href}`);
    });
    const onLookupFailed = vi.fn();
    const service = withAiJmaWeatherGroundingContext(
      { generate },
      { fetchImpl, onLookupFailed, now: () => new Date('2026-09-19T13:00:00+09:00') },
    );
    const request = baseRequest({ input: '東京の明後日の天気は？' });

    await service.generate(request);

    expect(generate).toHaveBeenCalledWith(request);
    expect(onLookupFailed).toHaveBeenCalledWith({
      areaDisplayName: '東京',
      errorName: 'JmaWeatherError',
    });
  });

  it('取得失敗時はrequestを変更せずfail closedし、raw errorをsinkへ渡さない', async () => {
    const generate = vi.fn(async () => successResponse());
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('network unreachable: 10.0.0.5 refused connection with secret token XYZ');
    });
    const onLookupFailed = vi.fn();
    const service = withAiJmaWeatherGroundingContext({ generate }, { fetchImpl, onLookupFailed });

    await service.generate(baseRequest());

    expect(generate).toHaveBeenCalledWith(baseRequest());
    expect(onLookupFailed).toHaveBeenCalledWith({
      areaDisplayName: '東京',
      errorName: 'JmaWeatherError',
    });
  });

  it('consumeRateLimitをラップ元へ委譲する', async () => {
    const consumeRateLimit = vi.fn(async () => undefined);
    const service = withAiJmaWeatherGroundingContext(
      { generate: vi.fn(async () => successResponse()), consumeRateLimit },
      { fetchImpl: vi.fn<typeof fetch>() },
    );

    await service.consumeRateLimit?.({
      input: 'hi',
      guildId: 'guild-1',
      scopeGuildId: 'guild-1',
      userId: 'user-1',
      authorized: true,
      pluginEnabled: true,
      guildOptIn: true,
    });

    expect(consumeRateLimit).toHaveBeenCalledTimes(1);
  });
});

describe('JmaWeatherError', () => {
  it('codeを保持する', () => {
    const error = new JmaWeatherError('not_found');
    expect(error.code).toBe('not_found');
    expect(error.name).toBe('JmaWeatherError');
  });
});
