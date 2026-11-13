import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@herta/logger';
import {
  ACTIVITY_XP_REQUEST_PATH,
  activityXpHourWindowStart,
  activityXpRetryDelayMs,
  activityXpSourceEventId,
  buildActivityXpOutboxPayload,
  buildActivityXpRequest,
  classifyActivityXpResponse,
  computeVoiceMinutesInWindow,
  deriveActivityXpEventId,
  latestClosedActivityXpWindow,
  resolveActivityXpEmitterConfig,
  sendActivityXpOutboxPayload,
  type VoiceActivityEvent,
} from './activity-xp-ivrm-emitter.js';

const config = {
  apiBaseUrl: 'https://api.ivrm.jp',
  secret: 'test-secret',
  guildId: '964326043420872704',
};
const GUILD_ID = '964326043420872704';
const USER_ID = '123456789012345678';
// ivrm-web 取込が要求する UUID 形式 (version 1-5 / variant 8-b)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function silentLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('resolveActivityXpEmitterConfig', () => {
  const fullEnv = {
    HERTA_XP_EMITTER_ENABLED: 'true',
    IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp',
    HERTA_POINTS_SECRET: 'secret',
    IVRM_INTEGRATION_GUILD_ID: GUILD_ID,
  };

  it('フラグがtrueで必須envが揃っている場合だけconfigを返す', () => {
    expect(resolveActivityXpEmitterConfig(fullEnv)).toEqual({
      apiBaseUrl: 'https://api.ivrm.jp',
      secret: 'secret',
      guildId: GUILD_ID,
    });
  });

  it('フラグが未設定・false・true以外なら既定OFFとしてnullを返す', () => {
    const { HERTA_XP_EMITTER_ENABLED: _flag, ...withoutFlag } = fullEnv;
    expect(resolveActivityXpEmitterConfig(withoutFlag)).toBeNull();
    expect(
      resolveActivityXpEmitterConfig({ ...fullEnv, HERTA_XP_EMITTER_ENABLED: 'false' }),
    ).toBeNull();
    expect(
      resolveActivityXpEmitterConfig({ ...fullEnv, HERTA_XP_EMITTER_ENABLED: '1' }),
    ).toBeNull();
  });

  it('必須envが1つでも欠けたらnullを返す', () => {
    expect(
      resolveActivityXpEmitterConfig({ ...fullEnv, HERTA_POINTS_SECRET: undefined }),
    ).toBeNull();
    expect(
      resolveActivityXpEmitterConfig({ ...fullEnv, IVRM_WEB_API_BASE_URL: undefined }),
    ).toBeNull();
    expect(
      resolveActivityXpEmitterConfig({ ...fullEnv, IVRM_INTEGRATION_GUILD_ID: ' ' }),
    ).toBeNull();
  });

  it('httpsでもlocalhostでもないURLや認証情報付きURLはnullを返す', () => {
    expect(
      resolveActivityXpEmitterConfig({ ...fullEnv, IVRM_WEB_API_BASE_URL: 'http://api.ivrm.jp' }),
    ).toBeNull();
    expect(
      resolveActivityXpEmitterConfig({
        ...fullEnv,
        IVRM_WEB_API_BASE_URL: 'https://user:pass@api.ivrm.jp',
      }),
    ).toBeNull();
  });

  it('末尾スラッシュを取り除く', () => {
    expect(
      resolveActivityXpEmitterConfig({ ...fullEnv, IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp/' })
        ?.apiBaseUrl,
    ).toBe('https://api.ivrm.jp');
  });
});

describe('窓の計算', () => {
  it('hourWindowStartは分以下を切り捨てる', () => {
    expect(activityXpHourWindowStart(new Date('2026-11-13T10:23:45.678Z')).toISOString()).toBe(
      '2026-11-13T10:00:00.000Z',
    );
  });

  it('latestClosedWindowはgraceを過ぎた直近の閉じた窓を返す', () => {
    const { start, end } = latestClosedActivityXpWindow(new Date('2026-11-13T11:00:35.000Z'));
    expect(start.toISOString()).toBe('2026-11-13T10:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-13T11:00:00.000Z');
  });

  it('境界直後 (grace未経過) は1つ前の窓を返す', () => {
    const { start, end } = latestClosedActivityXpWindow(new Date('2026-11-13T11:00:10.000Z'));
    expect(start.toISOString()).toBe('2026-11-13T09:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-13T10:00:00.000Z');
  });
});

describe('activityXpSourceEventId', () => {
  const windowStart = new Date('2026-11-13T10:00:00.000Z');

  it('kindごとに決まったprefixで窓開始時刻を含む', () => {
    expect(activityXpSourceEventId('message', GUILD_ID, USER_ID, windowStart)).toBe(
      `herta:msg:${GUILD_ID}:${USER_ID}:2026-11-13T10:00:00.000Z`,
    );
    expect(activityXpSourceEventId('voice', GUILD_ID, USER_ID, windowStart)).toBe(
      `herta:voice:${GUILD_ID}:${USER_ID}:2026-11-13T10:00:00.000Z`,
    );
  });

  it('同じ入力では常に同じ値 (再送で安定)', () => {
    expect(activityXpSourceEventId('message', GUILD_ID, USER_ID, windowStart)).toBe(
      activityXpSourceEventId('message', GUILD_ID, USER_ID, new Date(windowStart.getTime())),
    );
  });

  it('ivrm-webのsource_event_id形式 (英数と :_.- のみ、160文字以内) を満たす', () => {
    const id = activityXpSourceEventId('voice', GUILD_ID, USER_ID, windowStart);
    expect(id).toMatch(/^[a-zA-Z0-9:_.-]{1,160}$/);
  });
});

describe('deriveActivityXpEventId', () => {
  it('sourceEventIdから決定的に導出でき、再計算しても同じUUIDになる', () => {
    const sourceEventId = `herta:msg:${GUILD_ID}:${USER_ID}:2026-11-13T10:00:00.000Z`;
    expect(deriveActivityXpEventId(sourceEventId)).toBe(deriveActivityXpEventId(sourceEventId));
  });

  it('ivrm-webが要求するUUID形式 (version 5) を満たす', () => {
    const id = deriveActivityXpEventId(
      `herta:voice:${GUILD_ID}:${USER_ID}:2026-11-13T10:00:00.000Z`,
    );
    expect(id).toMatch(UUID_PATTERN);
    expect(id.charAt(14)).toBe('5');
  });

  it('異なるsourceEventIdでは異なるUUIDになる', () => {
    const a = deriveActivityXpEventId(`herta:msg:${GUILD_ID}:${USER_ID}:2026-11-13T10:00:00.000Z`);
    const b = deriveActivityXpEventId(`herta:msg:${GUILD_ID}:${USER_ID}:2026-11-13T11:00:00.000Z`);
    const c = deriveActivityXpEventId(
      `herta:voice:${GUILD_ID}:${USER_ID}:2026-11-13T10:00:00.000Z`,
    );
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('buildActivityXpOutboxPayload', () => {
  const windowStart = new Date('2026-11-13T10:00:00.000Z');

  it('bodyはivrm-web契約の6キーちょうどで、occurredAtは窓開始時刻', () => {
    const payload = buildActivityXpOutboxPayload({
      guildId: GUILD_ID,
      discordUserId: USER_ID,
      eventType: 'message',
      count: 12,
      windowStart,
    });
    expect(payload).not.toBeNull();
    const body = JSON.parse(payload!.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['count', 'discordUserId', 'eventType', 'guildId', 'occurredAt', 'sourceEventId'].sort(),
    );
    expect(body).toEqual({
      discordUserId: USER_ID,
      guildId: GUILD_ID,
      eventType: 'message',
      count: 12,
      sourceEventId: `herta:msg:${GUILD_ID}:${USER_ID}:2026-11-13T10:00:00.000Z`,
      occurredAt: '2026-11-13T10:00:00.000Z',
    });
    expect(payload!.eventId).toBe(deriveActivityXpEventId(payload!.sourceEventId));
  });

  it('countが0・負数・非整数ならnull (enqueueしない)', () => {
    const base = {
      guildId: GUILD_ID,
      discordUserId: USER_ID,
      eventType: 'voice' as const,
      windowStart,
    };
    expect(buildActivityXpOutboxPayload({ ...base, count: 0 })).toBeNull();
    expect(buildActivityXpOutboxPayload({ ...base, count: -3 })).toBeNull();
    expect(buildActivityXpOutboxPayload({ ...base, count: 1.5 })).toBeNull();
  });
});

describe('buildActivityXpRequest', () => {
  it('署名はivrm-web取込のcanonical文字列 `${timestamp}.${eventId}.POST.${path}.${body}` で検証できる', () => {
    const payload = buildActivityXpOutboxPayload({
      guildId: GUILD_ID,
      discordUserId: USER_ID,
      eventType: 'voice',
      count: 30,
      windowStart: new Date('2026-11-13T10:00:00.000Z'),
    })!;
    const timestamp = '2026-11-13T11:05:00.000Z';
    const request = buildActivityXpRequest(config, payload.eventId, payload.body, timestamp);

    expect(request.url).toBe(`https://api.ivrm.jp${ACTIVITY_XP_REQUEST_PATH}`);
    expect(request.init.headers['X-IVRM-Timestamp']).toBe(timestamp);
    expect(request.init.headers['X-IVRM-Event-Id']).toBe(payload.eventId);
    const expected = createHmac('sha256', config.secret)
      .update(`${timestamp}.${payload.eventId}.POST.${ACTIVITY_XP_REQUEST_PATH}.${payload.body}`)
      .digest('hex');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
    // 署名はhex 64文字 (ivrm-web側の形式チェックを満たす)
    expect(request.init.headers['X-IVRM-Signature']).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('classifyActivityXpResponse', () => {
  it('201 (created) と200 (idempotent replay) は送信完了', () => {
    expect(classifyActivityXpResponse(201)).toBe('sent');
    expect(classifyActivityXpResponse(200)).toBe('sent');
  });

  it('409 (未連携/競合) と422 (ポリシー外/上限超過) は恒久破棄', () => {
    expect(classifyActivityXpResponse(409)).toBe('dropped');
    expect(classifyActivityXpResponse(422)).toBe('dropped');
  });

  it('401/403は設定異常として送信停止対象', () => {
    expect(classifyActivityXpResponse(401)).toBe('auth_failure');
    expect(classifyActivityXpResponse(403)).toBe('auth_failure');
  });

  it('5xxやその他のステータスは再送可能', () => {
    expect(classifyActivityXpResponse(500)).toBe('retryable');
    expect(classifyActivityXpResponse(503)).toBe('retryable');
    expect(classifyActivityXpResponse(404)).toBe('retryable');
    expect(classifyActivityXpResponse(400)).toBe('retryable');
  });
});

describe('activityXpRetryDelayMs', () => {
  it('試行回数に応じて倍増し、上限1時間で頭打ちになる', () => {
    expect(activityXpRetryDelayMs(1)).toBe(30_000);
    expect(activityXpRetryDelayMs(2)).toBe(60_000);
    expect(activityXpRetryDelayMs(3)).toBe(120_000);
    expect(activityXpRetryDelayMs(8)).toBe(60 * 60 * 1000);
    expect(activityXpRetryDelayMs(50)).toBe(60 * 60 * 1000);
  });
});

describe('computeVoiceMinutesInWindow', () => {
  const windowStart = new Date('2026-11-13T10:00:00.000Z');
  const windowEnd = new Date('2026-11-13T11:00:00.000Z');
  const ev = (event: VoiceActivityEvent['event'], iso: string): VoiceActivityEvent => ({
    event,
    occurredAt: new Date(iso),
  });

  it('窓内のjoin→leaveを通話分数にする', () => {
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T10:10:00.000Z'),
          ev('voice_leave', '2026-11-13T10:40:00.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(30);
  });

  it('窓開始時点で接続中 (窓前のjoin) なら窓開始から数える', () => {
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T09:30:00.000Z'),
          ev('voice_leave', '2026-11-13T10:30:00.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(30);
  });

  it('窓終了時点で接続中なら窓終了までを数え、残りは次の窓に回る', () => {
    expect(
      computeVoiceMinutesInWindow(
        [ev('voice_join', '2026-11-13T10:45:00.000Z')],
        windowStart,
        windowEnd,
      ),
    ).toBe(15);
    // 次の窓では窓開始から接続中として数える (二重計上しない)
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T10:45:00.000Z'),
          ev('voice_leave', '2026-11-13T11:20:00.000Z'),
        ],
        windowEnd,
        new Date('2026-11-13T12:00:00.000Z'),
      ),
    ).toBe(20);
  });

  it('窓を完全にまたぐ接続は60分になる', () => {
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T09:00:00.000Z'),
          ev('voice_leave', '2026-11-13T12:00:00.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(60);
  });

  it('joinのないleaveは無視する', () => {
    expect(
      computeVoiceMinutesInWindow(
        [ev('voice_leave', '2026-11-13T10:30:00.000Z')],
        windowStart,
        windowEnd,
      ),
    ).toBe(0);
  });

  it('joinが重なった場合は最初のjoinを採用する', () => {
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T10:05:00.000Z'),
          ev('voice_join', '2026-11-13T10:20:00.000Z'),
          ev('voice_leave', '2026-11-13T10:50:00.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(45);
  });

  it('窓の外で完結した接続は数えない', () => {
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T08:00:00.000Z'),
          ev('voice_leave', '2026-11-13T09:00:00.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(0);
  });

  it('分未満は切り捨てる', () => {
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T10:00:30.000Z'),
          ev('voice_leave', '2026-11-13T10:01:29.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(0);
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T10:00:00.000Z'),
          ev('voice_leave', '2026-11-13T10:01:30.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(1);
  });

  it('複数の接続区間を合計する', () => {
    expect(
      computeVoiceMinutesInWindow(
        [
          ev('voice_join', '2026-11-13T10:00:00.000Z'),
          ev('voice_leave', '2026-11-13T10:10:00.000Z'),
          ev('voice_join', '2026-11-13T10:30:00.000Z'),
          ev('voice_leave', '2026-11-13T10:55:00.000Z'),
        ],
        windowStart,
        windowEnd,
      ),
    ).toBe(35);
  });
});

describe('sendActivityXpOutboxPayload', () => {
  const payload = buildActivityXpOutboxPayload({
    guildId: GUILD_ID,
    discordUserId: USER_ID,
    eventType: 'message',
    count: 5,
    windowStart: new Date('2026-11-13T10:00:00.000Z'),
  })!;

  it('201応答を送信完了として返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
    await expect(sendActivityXpOutboxPayload(config, payload, silentLogger())).resolves.toEqual({
      outcome: 'sent',
      status: 201,
    });
    vi.unstubAllGlobals();
  });

  it('409応答を恒久破棄として返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(sendActivityXpOutboxPayload(config, payload, silentLogger())).resolves.toEqual({
      outcome: 'dropped',
      status: 409,
    });
    vi.unstubAllGlobals();
  });

  it('401応答を設定異常として返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(sendActivityXpOutboxPayload(config, payload, silentLogger())).resolves.toEqual({
      outcome: 'auth_failure',
      status: 401,
    });
    vi.unstubAllGlobals();
  });

  it('ネットワーク失敗は例外を投げず再送可能として返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const result = await sendActivityXpOutboxPayload(config, payload, silentLogger());
    expect(result.outcome).toBe('retryable');
    expect(result.error).toContain('network unreachable');
    vi.unstubAllGlobals();
  });
});
