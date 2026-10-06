import { describe, expect, it, vi } from 'vitest';
import { fetchValorantMmr, parseRiotId } from './valorant-client.js';

describe('parseRiotId', () => {
  it('Name#Tagを分解する', () => {
    expect(parseRiotId('Player#JP1')).toEqual({ name: 'Player', tag: 'JP1' });
  });

  it('前後の空白を無視する', () => {
    expect(parseRiotId('  Player #JP1  ')).toEqual({ name: 'Player', tag: 'JP1' });
  });

  it('#がない・tagが短すぎる・nameが空の場合はnullを返す', () => {
    expect(parseRiotId('PlayerJP1')).toBeNull();
    expect(parseRiotId('Player#J')).toBeNull();
    expect(parseRiotId('#JP1')).toBeNull();
  });
});

describe('fetchValorantMmr', () => {
  const riotId = { name: 'Player', tag: 'JP1' };

  it('v3エンドポイントへ正しいURL・Authorizationヘッダでリクエストする', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { current: { tier: { name: 'Diamond 2' }, rr: 45, elo: 1234 } } }),
          { status: 200 },
        ),
      );

    const result = await fetchValorantMmr('test-api-key', 'ap', riotId, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.henrikdev.xyz/valorant/v3/mmr/ap/pc/Player/JP1');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'test-api-key' });
    expect(result).toEqual({
      status: 'ok',
      snapshot: {
        name: 'Player',
        tag: 'JP1',
        currentTierName: 'Diamond 2',
        currentRr: 45,
        currentElo: 1234,
        peakTierName: null,
      },
    });
  });

  it('peakが含まれる場合はpeakTierNameへ反映する', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            current: { tier: { name: 'Gold 1' }, rr: 10 },
            peak: { tier: { name: 'Platinum 3' } },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchValorantMmr('key', 'na', riotId, fetcher);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.snapshot.peakTierName).toBe('Platinum 3');
      expect(result.snapshot.currentElo).toBeNull();
    }
  });

  it('404はnot_foundを返す', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    expect(await fetchValorantMmr('key', 'eu', riotId, fetcher)).toEqual({ status: 'not_found' });
  });

  it('429はrate_limitedを返す', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    expect(await fetchValorantMmr('key', 'eu', riotId, fetcher)).toEqual({
      status: 'rate_limited',
    });
  });

  it('その他の非200・JSON解析失敗・必須フィールド欠落はupstream_errorを返す', async () => {
    const serverError = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    expect(await fetchValorantMmr('key', 'eu', riotId, serverError)).toEqual({
      status: 'upstream_error',
    });

    const malformedJson = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    expect(await fetchValorantMmr('key', 'eu', riotId, malformedJson)).toEqual({
      status: 'upstream_error',
    });

    const missingFields = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    expect(await fetchValorantMmr('key', 'eu', riotId, missingFields)).toEqual({
      status: 'upstream_error',
    });
  });

  it('network failureはupstream_errorを返す', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network unreachable'));
    expect(await fetchValorantMmr('key', 'eu', riotId, fetcher)).toEqual({
      status: 'upstream_error',
    });
  });
});
