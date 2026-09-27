import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@herta/logger';
import {
  buildMbtiIvrmSyncRequest,
  pushMbtiResultToIvrmWeb,
  resolveMbtiIvrmSyncConfig,
} from './mbti-ivrm-sync.js';

const config = { apiBaseUrl: 'https://api.ivrm.jp', secret: 'test-secret' };
const event = {
  eventId: '018f4b20-8a6f-7a2a-8f4b-1234567890ab',
  discordUserId: '123456789012345678',
  mbtiType: 'INFP',
  occurredAt: '2026-08-30T00:00:00.000Z',
};

function silentLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('resolveMbtiIvrmSyncConfig', () => {
  it('URLとsecretが両方設定されている場合だけconfigを返す', () => {
    expect(
      resolveMbtiIvrmSyncConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp',
        HERTA_MBTI_SYNC_SECRET: 'secret',
      }),
    ).toEqual({ apiBaseUrl: 'https://api.ivrm.jp', secret: 'secret' });
  });

  it('末尾スラッシュを取り除く', () => {
    expect(
      resolveMbtiIvrmSyncConfig({
        IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp/',
        HERTA_MBTI_SYNC_SECRET: 'secret',
      })?.apiBaseUrl,
    ).toBe('https://api.ivrm.jp');
  });

  it('どちらか未設定ならnullを返す', () => {
    expect(resolveMbtiIvrmSyncConfig({ IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp' })).toBeNull();
    expect(resolveMbtiIvrmSyncConfig({ HERTA_MBTI_SYNC_SECRET: 'secret' })).toBeNull();
    expect(resolveMbtiIvrmSyncConfig({})).toBeNull();
  });

  it('httpsでもlocalhostでもないURLはnullを返す', () => {
    expect(
      resolveMbtiIvrmSyncConfig({
        IVRM_WEB_API_BASE_URL: 'http://api.ivrm.jp',
        HERTA_MBTI_SYNC_SECRET: 'secret',
      }),
    ).toBeNull();
  });

  it('localhostはhttpでも許容する(開発環境向け)', () => {
    expect(
      resolveMbtiIvrmSyncConfig({
        IVRM_WEB_API_BASE_URL: 'http://localhost:8787',
        HERTA_MBTI_SYNC_SECRET: 'secret',
      }),
    ).toEqual({ apiBaseUrl: 'http://localhost:8787', secret: 'secret' });
  });

  it('不正なURL文字列はnullを返す', () => {
    expect(
      resolveMbtiIvrmSyncConfig({
        IVRM_WEB_API_BASE_URL: 'not a url',
        HERTA_MBTI_SYNC_SECRET: 'secret',
      }),
    ).toBeNull();
  });
});

describe('buildMbtiIvrmSyncRequest', () => {
  it('ivrm-webの/v1/herta/mbti-events契約と一致するURL・header・bodyを生成する', () => {
    const timestamp = '2026-08-30T00:00:01.000Z';
    const request = buildMbtiIvrmSyncRequest(config, event, timestamp);

    expect(request.url).toBe('https://api.ivrm.jp/v1/herta/mbti-events');
    expect(request.init.method).toBe('POST');
    expect(request.init.headers['Content-Type']).toBe('application/json');
    expect(request.init.headers['X-IVRM-Timestamp']).toBe(timestamp);
    expect(request.init.headers['X-IVRM-Event-Id']).toBe(event.eventId);
    expect(JSON.parse(request.init.body)).toEqual({
      schemaVersion: 1,
      eventId: event.eventId,
      discordUserId: event.discordUserId,
      mbtiType: event.mbtiType,
      occurredAt: event.occurredAt,
    });
  });

  it('署名はivrm-web側と同じcanonical文字列(METHOD\\nPATH\\nTIMESTAMP\\nEVENT_ID\\nBODY)から検証できる', () => {
    const timestamp = '2026-08-30T00:00:01.000Z';
    const request = buildMbtiIvrmSyncRequest(config, event, timestamp);

    const canonical = [
      'POST',
      '/v1/herta/mbti-events',
      timestamp,
      event.eventId,
      request.init.body,
    ].join('\n');
    const expected = createHmac('sha256', config.secret).update(canonical).digest('hex');

    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
  });

  it('secretが異なれば署名も変わる', () => {
    const timestamp = '2026-08-30T00:00:01.000Z';
    const a = buildMbtiIvrmSyncRequest(config, event, timestamp);
    const b = buildMbtiIvrmSyncRequest({ ...config, secret: 'other-secret' }, event, timestamp);

    expect(a.init.headers['X-IVRM-Signature']).not.toBe(b.init.headers['X-IVRM-Signature']);
  });
});

describe('pushMbtiResultToIvrmWeb', () => {
  it('成功時はwarnログを出さない', async () => {
    const logger = silentLogger();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await pushMbtiResultToIvrmWeb(config, event, logger);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('404(未連携/未承認)はivrm-web側の正常な無視対象としてwarnログを出さない', async () => {
    const logger = silentLogger();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await pushMbtiResultToIvrmWeb(config, event, logger);

    expect(logger.warn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('5xxはwarnログを出すが例外は投げない', async () => {
    const logger = silentLogger();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));

    await expect(pushMbtiResultToIvrmWeb(config, event, logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('network failureはwarnログを出すが例外は投げない', async () => {
    const logger = silentLogger();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    await expect(pushMbtiResultToIvrmWeb(config, event, logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
