import {
  isJmaWeatherQuery,
  resolveJmaAreaFromText,
  resolveJmaDayOffset,
  type JmaAreaEntry,
} from '@herta/plugin-catalog/jma-weather-policy';
import type { AiRuntimeGenerationService } from './runtime-service.js';

const JMA_FORECAST_TIMEOUT_MS = 5_000;
const JMA_OBSERVATION_TIMEOUT_MS = 5_000;
/** Forecast payloads are per-office and small. */
const JMA_FORECAST_MAX_BYTES = 512 * 1024;
/** The AMeDAS "map" snapshot bundles every station in Japan in one file. */
const JMA_OBSERVATION_MAX_BYTES = 4 * 1024 * 1024;
const JMA_LATEST_TIME_MAX_BYTES = 4 * 1024;

const JMA_GROUNDING_INSTRUCTION =
  'A weatherGroundingContext field, when present in user input, contains real Japan ' +
  'Meteorological Agency (JMA) data fetched by the application for the named area and the exact ' +
  'forecastDate shown. Answer using only those values, for that date only. Do not add temperature, ' +
  'precipitation, or forecast details beyond what it contains, and do not claim data for a ' +
  'different area or date than what it states.';

export type JmaWeatherErrorCode = 'timeout' | 'fetch_failed' | 'invalid_response' | 'not_found';

export class JmaWeatherError extends Error {
  readonly code: JmaWeatherErrorCode;

  constructor(code: JmaWeatherErrorCode) {
    super(`JMA weather lookup failed: ${code}`);
    this.name = 'JmaWeatherError';
    this.code = code;
  }
}

export interface JmaObservationSummary {
  tempCelsius: number | null;
  humidityPercent: number | null;
  windSpeedMs: number | null;
}

export interface JmaForecastSummary {
  forDateJst: string;
  weatherText: string | null;
  precipitationProbabilityPercent: number | null;
}

async function fetchBounded(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxBytes: number,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new JmaWeatherError('timeout');
    }
    throw new JmaWeatherError('fetch_failed');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new JmaWeatherError('fetch_failed');

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new JmaWeatherError('invalid_response');
  }
  if (!response.body) throw new JmaWeatherError('invalid_response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JmaWeatherError('invalid_response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new JmaWeatherError('invalid_response');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fetch the forecast for exactly `targetDateJst` (a `YYYY-MM-DD` JST calendar date). JMA's
 * `timeDefines` entries are JST wall-clock ISO timestamps, so the leading 10 characters are the
 * calendar date to match against — no timezone conversion is needed. If no `timeDefines` entry
 * falls on that date (the short-term forecast only covers ~2 days ahead), this fails closed rather
 * than silently substituting a different day's data.
 */
export async function fetchJmaForecastSummary(
  area: JmaAreaEntry,
  fetchImpl: typeof fetch,
  targetDateJst: string,
): Promise<JmaForecastSummary> {
  const url = `https://www.jma.go.jp/bosai/forecast/data/forecast/${area.officeCode}.json`;
  const bytes = await fetchBounded(url, fetchImpl, JMA_FORECAST_TIMEOUT_MS, JMA_FORECAST_MAX_BYTES);
  const parsed = decodeJson(bytes);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new JmaWeatherError('invalid_response');

  const [shortTerm] = parsed;
  if (!isRecord(shortTerm) || !Array.isArray(shortTerm['timeSeries'])) {
    throw new JmaWeatherError('invalid_response');
  }

  let weatherText: string | null = null;
  let precipitationProbabilityPercent: number | null = null;
  for (const series of shortTerm['timeSeries']) {
    if (
      !isRecord(series) ||
      !Array.isArray(series['timeDefines']) ||
      !Array.isArray(series['areas'])
    ) {
      continue;
    }
    const [firstArea] = series['areas'];
    if (!isRecord(firstArea)) continue;
    const dateIndexes = series['timeDefines']
      .map((value, index) =>
        typeof value === 'string' && value.startsWith(targetDateJst) ? index : -1,
      )
      .filter((index) => index >= 0);
    if (dateIndexes.length === 0) continue;

    if (weatherText === null && Array.isArray(firstArea['weathers'])) {
      const value = firstArea['weathers'][dateIndexes[0] as number];
      if (typeof value === 'string') weatherText = value;
    }
    if (precipitationProbabilityPercent === null && Array.isArray(firstArea['pops'])) {
      let maxPop: number | null = null;
      for (const index of dateIndexes) {
        const value = firstArea['pops'][index];
        if (typeof value !== 'string' || value === '') continue;
        const parsedPop = Number(value);
        if (Number.isFinite(parsedPop) && (maxPop === null || parsedPop > maxPop))
          maxPop = parsedPop;
      }
      precipitationProbabilityPercent = maxPop;
    }
  }

  if (weatherText === null) throw new JmaWeatherError('not_found');
  return { forDateJst: targetDateJst, weatherText, precipitationProbabilityPercent };
}

/** JST calendar date (`YYYY-MM-DD`) for a given instant. */
function jstDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Add whole days to a JST calendar date string, returning a new JST calendar date string. */
function addJstDays(jstDateStr: string, days: number): string {
  const anchor = new Date(`${jstDateStr}T00:00:00+09:00`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return jstDateString(anchor);
}

export async function fetchJmaObservationSummary(
  area: JmaAreaEntry,
  fetchImpl: typeof fetch,
): Promise<JmaObservationSummary> {
  const latestTimeBytes = await fetchBounded(
    'https://www.jma.go.jp/bosai/amedas/data/latest_time.txt',
    fetchImpl,
    JMA_OBSERVATION_TIMEOUT_MS,
    JMA_LATEST_TIME_MAX_BYTES,
  );
  const latestTimeText = new TextDecoder().decode(latestTimeBytes).trim();
  const stamp = formatAmedasTimestamp(latestTimeText);
  const mapBytes = await fetchBounded(
    `https://www.jma.go.jp/bosai/amedas/data/map/${stamp}.json`,
    fetchImpl,
    JMA_OBSERVATION_TIMEOUT_MS,
    JMA_OBSERVATION_MAX_BYTES,
  );
  const parsed = decodeJson(mapBytes);
  if (!isRecord(parsed)) throw new JmaWeatherError('invalid_response');

  const station = parsed[area.amedasStationCode];
  if (!isRecord(station)) throw new JmaWeatherError('not_found');

  return {
    tempCelsius: readMeasurement(station['temp']),
    humidityPercent: readMeasurement(station['humidity']),
    windSpeedMs: readMeasurement(station['wind']),
  };
}

function readMeasurement(value: unknown): number | null {
  if (!Array.isArray(value) || typeof value[0] !== 'number') return null;
  return value[0];
}

/**
 * `latest_time.txt` publishes a JST wall-clock ISO timestamp (e.g. `2026-09-19T21:20:00+09:00`),
 * and the AMeDAS map filenames use those same digits verbatim. Extract them directly instead of
 * round-tripping through `Date`, which would convert to another timezone and produce a filename
 * for the wrong moment.
 */
function formatAmedasTimestamp(latestTimeText: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(latestTimeText);
  if (!match) throw new JmaWeatherError('invalid_response');
  const [, year, month, day, hour, minute, second] = match;
  return `${year}${month}${day}${hour}${minute}${second}`;
}

export interface JmaWeatherGroundingOptions {
  fetchImpl?: typeof fetch;
  /** Overridable for deterministic tests; defaults to the real current time. */
  now?: () => Date;
  /** Only safe metadata (area name, error name) is ever passed to this sink. */
  onLookupFailed?: (context: { areaDisplayName: string; errorName: string }) => void;
}

/**
 * Best-effort weather grounding: when the request is still ungrounded and looks like a weather
 * question for an allowlisted area, fetch real JMA data and promote groundingState to 'grounded'
 * with a small, fixed-shape trusted instruction plus the values in the user-input plane (never in
 * trustedInstructions, since the fetched values are formatted alongside untrusted user text).
 * Any lookup failure is swallowed and the request proceeds unchanged (fail closed to 'insufficient',
 * never fake success) — this must never turn a working chat reply into an error.
 */
export function withAiJmaWeatherGroundingContext(
  service: AiRuntimeGenerationService,
  options: JmaWeatherGroundingOptions = {},
): AiRuntimeGenerationService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const wrapped: AiRuntimeGenerationService = {
    generate: async (request) => {
      if (request.groundingState !== 'insufficient' || !isJmaWeatherQuery(request.input)) {
        return service.generate(request);
      }
      const area = resolveJmaAreaFromText(request.input);
      if (!area) return service.generate(request);

      const dayOffset = resolveJmaDayOffset(request.input);
      const targetDateJst = addJstDays(jstDateString(now()), dayOffset);

      try {
        // Real-time observation only describes "right now" — it never applies to a future day.
        const [observation, forecast] = await Promise.all([
          dayOffset === 0 ? fetchJmaObservationSummary(area, fetchImpl) : Promise.resolve(null),
          fetchJmaForecastSummary(area, fetchImpl, targetDateJst),
        ]);
        const groundingContext = buildGroundingContextText(area, observation, forecast);
        return service.generate({
          ...request,
          groundingState: 'grounded',
          input: buildGroundedInput(request.input, groundingContext),
          trustedInstructions: [...(request.trustedInstructions ?? []), JMA_GROUNDING_INSTRUCTION],
        });
      } catch (error) {
        options.onLookupFailed?.({
          areaDisplayName: area.displayName,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return service.generate(request);
      }
    },
  };

  if (service.consumeRateLimit) {
    wrapped.consumeRateLimit = (request) => service.consumeRateLimit!(request);
  }

  return wrapped;
}

function buildGroundingContextText(
  area: JmaAreaEntry,
  observation: JmaObservationSummary | null,
  forecast: JmaForecastSummary,
): string {
  const parts: string[] = [`area: ${area.displayName}`, `forecastDate: ${forecast.forDateJst}`];
  if (observation) {
    if (observation.tempCelsius !== null) {
      parts.push(`observedTempCelsius: ${observation.tempCelsius}`);
    }
    if (observation.humidityPercent !== null) {
      parts.push(`observedHumidityPercent: ${observation.humidityPercent}`);
    }
    if (observation.windSpeedMs !== null) {
      parts.push(`observedWindSpeedMs: ${observation.windSpeedMs}`);
    }
  }
  if (forecast.weatherText !== null) parts.push(`forecastWeather: ${forecast.weatherText}`);
  if (forecast.precipitationProbabilityPercent !== null) {
    parts.push(
      `forecastPrecipitationProbabilityPercent: ${forecast.precipitationProbabilityPercent}`,
    );
  }
  return parts.join(', ');
}

function buildGroundedInput(currentUserMessage: string, weatherGroundingContext: string): string {
  return JSON.stringify({ weatherGroundingContext, currentUserMessage });
}
