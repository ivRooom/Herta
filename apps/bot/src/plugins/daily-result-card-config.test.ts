import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceFetch = vi.hoisted(() => vi.fn());
vi.mock('./daily-bonus-wallet.js', () => ({ dailyServiceFetch: serviceFetch }));

import type {
  DailyResultCardAssetMeta,
  DailyResultCardConfig,
} from './daily-result-card-config.js';

const CONFIG_PATH = '/v2/participation/herta/result-card-config';
const MEDIA_PATH = '/v2/participation/herta/result-card-media';
const T0 = 1_700_000_000_000;

const assetA: DailyResultCardAssetMeta = {
  assetId: 'asset-a',
  alt: '正解イラストA',
  mimeType: 'image/webp',
  byteSize: 4,
};
const assetB: DailyResultCardAssetMeta = {
  assetId: 'asset-b',
  alt: '正解イラストB',
  mimeType: 'image/webp',
  byteSize: 4,
};
const assetC: DailyResultCardAssetMeta = {
  assetId: 'asset-c',
  alt: '不正解イラスト',
  mimeType: 'image/webp',
  byteSize: 4,
};

function configPayload(revision: number) {
  return {
    contractVersion: 1,
    revision,
    activatedAt: '2026-11-11T00:00:00.000Z',
    correct: { assets: [assetA, assetB] },
    incorrect: { assets: [assetC] },
    fallback: 'embed',
  };
}

function jsonResponse(value: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => value,
    headers: new Headers(),
  } as unknown as Response;
}

function mediaResponse(
  meta: DailyResultCardAssetMeta,
  bytes: Buffer,
  headerOverrides: Record<string, string> = {},
): Response {
  const headers = new Headers({
    'X-IVRM-Media-Id': meta.assetId,
    'Content-Type': meta.mimeType,
    'Content-Length': String(meta.byteSize),
    'Cache-Control': 'private, no-store',
    ...headerOverrides,
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return { ok: true, status: 200, headers, body } as unknown as Response;
}

async function loadModule() {
  vi.resetModules();
  return import('./daily-result-card-config.js');
}

function routeFetch(handlers: {
  config?: (extra: Record<string, unknown>) => Response | null;
  media?: (extra: Record<string, unknown>) => Response | null;
}) {
  serviceFetch.mockImplementation(
    async (_guildId: string, _userId: string, path: string, extra: Record<string, unknown>) => {
      if (path === CONFIG_PATH) return handlers.config?.(extra) ?? null;
      if (path === MEDIA_PATH) return handlers.media?.(extra) ?? null;
      return null;
    },
  );
}

beforeEach(() => {
  serviceFetch.mockReset();
});

describe('fetchDailyResultCardConfig', () => {
  it('parses the full config and adapts it for the selector', async () => {
    routeFetch({ config: () => jsonResponse(configPayload(3)) });
    const { fetchDailyResultCardConfig } = await loadModule();
    const config = (await fetchDailyResultCardConfig('guild', 'user', T0)) as DailyResultCardConfig;
    expect(config.revision).toBe(3);
    expect(config.activatedAt).toBe('2026-11-11T00:00:00.000Z');
    expect(config.correctAssets).toEqual([assetA, assetB]);
    // Selector view: revision stringified, server-filtered assets marked enabled.
    expect(config.pool.revision).toBe('3');
    expect(config.pool.correctAssets).toEqual([
      { assetId: 'asset-a', alt: '正解イラストA', enabled: true },
      { assetId: 'asset-b', alt: '正解イラストB', enabled: true },
    ]);
    expect(config.pool.incorrectAssets).toEqual([
      { assetId: 'asset-c', alt: '不正解イラスト', enabled: true },
    ]);
    // First call sends no knownRevision; the only extra key ever sent.
    expect(serviceFetch.mock.calls[0]![3]).toEqual({});
  });

  it('serves the cache within the TTL without a network call', async () => {
    routeFetch({ config: () => jsonResponse(configPayload(3)) });
    const { fetchDailyResultCardConfig } = await loadModule();
    await fetchDailyResultCardConfig('guild', 'user', T0);
    const again = await fetchDailyResultCardConfig('guild', 'user', T0 + 30_000);
    expect(again?.revision).toBe(3);
    expect(serviceFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached pools when the API reports the revision unchanged', async () => {
    let calls = 0;
    routeFetch({
      config: (extra) => {
        calls++;
        if (calls === 1) return jsonResponse(configPayload(3));
        expect(extra).toEqual({ knownRevision: 3 });
        return jsonResponse({
          contractVersion: 1,
          revision: 3,
          unchanged: true,
          fallback: 'embed',
        });
      },
    });
    const { fetchDailyResultCardConfig } = await loadModule();
    await fetchDailyResultCardConfig('guild', 'user', T0);
    const config = await fetchDailyResultCardConfig('guild', 'user', T0 + 61_000);
    expect(config?.correctAssets).toEqual([assetA, assetB]);
    expect(serviceFetch).toHaveBeenCalledTimes(2);
  });

  it('returns an empty-pool config for revision 0 instead of failing', async () => {
    routeFetch({
      config: () =>
        jsonResponse({
          contractVersion: 1,
          revision: 0,
          activatedAt: null,
          correct: { assets: [] },
          incorrect: { assets: [] },
          fallback: 'embed',
        }),
    });
    const { fetchDailyResultCardConfig } = await loadModule();
    const config = await fetchDailyResultCardConfig('guild', 'user', T0);
    expect(config?.revision).toBe(0);
    expect(config?.pool.correctAssets).toEqual([]);
    expect(config?.pool.incorrectAssets).toEqual([]);
  });

  it.each([
    ['network unavailable', null],
    ['http error', jsonResponse({ error: 'result_card_unavailable' }, false)],
    [
      'missing fallback marker',
      jsonResponse({
        contractVersion: 1,
        revision: 3,
        correct: { assets: [] },
        incorrect: { assets: [] },
      }),
    ],
    [
      'non-image asset in pool',
      jsonResponse({
        ...configPayload(3),
        correct: { assets: [{ ...assetA, mimeType: 'audio/wav' }] },
      }),
    ],
  ])('returns null when the config cannot be trusted (%s)', async (_label, response) => {
    routeFetch({ config: () => response as Response | null });
    const { fetchDailyResultCardConfig } = await loadModule();
    expect(await fetchDailyResultCardConfig('guild', 'user', T0)).toBeNull();
  });
});

describe('fetchDailyResultCardMedia', () => {
  const bytes = Buffer.from('webp');

  it('fetches bytes once and serves repeats from the cache', async () => {
    routeFetch({ media: () => mediaResponse(assetA, bytes) });
    const { fetchDailyResultCardMedia } = await loadModule();
    const first = await fetchDailyResultCardMedia('guild', 'user', assetA);
    const second = await fetchDailyResultCardMedia('guild', 'user', assetA);
    expect(first?.equals(bytes)).toBe(true);
    expect(second?.equals(bytes)).toBe(true);
    expect(serviceFetch).toHaveBeenCalledTimes(1);
    expect(serviceFetch.mock.calls[0]![3]).toEqual({ assetId: 'asset-a' });
  });

  it.each([
    ['media id mismatch', { 'X-IVRM-Media-Id': 'asset-x' }],
    ['content type mismatch', { 'Content-Type': 'image/png' }],
    ['content length mismatch', { 'Content-Length': '99' }],
    ['cache control weakened', { 'Cache-Control': 'public' }],
  ])('rejects a media response with %s', async (_label, overrides) => {
    routeFetch({ media: () => mediaResponse(assetA, bytes, overrides) });
    const { fetchDailyResultCardMedia } = await loadModule();
    expect(await fetchDailyResultCardMedia('guild', 'user', assetA)).toBeNull();
  });

  it('rejects a truncated body', async () => {
    routeFetch({ media: () => mediaResponse(assetA, Buffer.from('we')) });
    const { fetchDailyResultCardMedia } = await loadModule();
    expect(await fetchDailyResultCardMedia('guild', 'user', assetA)).toBeNull();
  });

  it('refetches artwork after the configuration revision changes', async () => {
    let revision = 3;
    routeFetch({
      config: () => jsonResponse(configPayload(revision)),
      media: () => mediaResponse(assetA, bytes),
    });
    const mod = await loadModule();
    await mod.fetchDailyResultCardConfig('guild', 'user', T0);
    await mod.fetchDailyResultCardMedia('guild', 'user', assetA);
    revision = 4;
    await mod.fetchDailyResultCardConfig('guild', 'user', T0 + 61_000);
    await mod.fetchDailyResultCardMedia('guild', 'user', assetA);
    const mediaCalls = serviceFetch.mock.calls.filter((call) => call[2] === MEDIA_PATH);
    expect(mediaCalls).toHaveLength(2);
  });
});
