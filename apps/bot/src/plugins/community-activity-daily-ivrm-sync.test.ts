import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@herta/db';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@herta/logger';
import {
  activityDailyDateKeys,
  buildActivityDailySyncRequest,
  collectActivityDailyRows,
  foldChannelPairsToGaugeRows,
  foldCommandExecutionsToDailyRows,
  jstActivityDateKey,
  pushActivityDailyToIvrmWeb,
  resolveActivityDailySyncConfig,
  type ActivityDailyRow,
  type ActivityDailySyncConfig,
} from './community-activity-daily-ivrm-sync.js';

const GUILD_ID = '964326043420872704';
const config: ActivityDailySyncConfig = {
  apiBaseUrl: 'https://api.ivrm.jp',
  secret: 'test-secret',
  guildId: GUILD_ID,
};
const fullEnv = {
  HERTA_ACTIVITY_DAILY_SYNC_ENABLED: 'true',
  IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp',
  HERTA_ACTIVITY_SYNC_SECRET: 'secret',
  IVRM_INTEGRATION_GUILD_ID: GUILD_ID,
};

const rows: ActivityDailyRow[] = [
  { discordUserId: '123456789012345678', activityDate: '2026-11-23', metric: 'commands', value: 2 },
  {
    discordUserId: '123456789012345678',
    activityDate: '2026-11-23',
    metric: 'reactions_given',
    value: 3,
  },
];

function silentLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('resolveActivityDailySyncConfig', () => {
  it('フラグがtrueで必須envが揃っている場合だけconfigを返す', () => {
    expect(resolveActivityDailySyncConfig(fullEnv)).toEqual({
      apiBaseUrl: 'https://api.ivrm.jp',
      secret: 'secret',
      guildId: GUILD_ID,
    });
  });

  it('フラグ未設定・falseではnullを返す (既定OFF)', () => {
    const { HERTA_ACTIVITY_DAILY_SYNC_ENABLED: _flag, ...withoutFlag } = fullEnv;
    expect(resolveActivityDailySyncConfig(withoutFlag)).toBeNull();
    expect(
      resolveActivityDailySyncConfig({ ...fullEnv, HERTA_ACTIVITY_DAILY_SYNC_ENABLED: 'false' }),
    ).toBeNull();
  });

  it('必須envが欠けたらnullを返す', () => {
    expect(
      resolveActivityDailySyncConfig({ ...fullEnv, HERTA_ACTIVITY_SYNC_SECRET: ' ' }),
    ).toBeNull();
    expect(
      resolveActivityDailySyncConfig({ ...fullEnv, IVRM_INTEGRATION_GUILD_ID: '' }),
    ).toBeNull();
    expect(resolveActivityDailySyncConfig({ ...fullEnv, IVRM_WEB_API_BASE_URL: '' })).toBeNull();
  });

  it('末尾スラッシュを取り除く', () => {
    expect(
      resolveActivityDailySyncConfig({ ...fullEnv, IVRM_WEB_API_BASE_URL: 'https://api.ivrm.jp/' })
        ?.apiBaseUrl,
    ).toBe('https://api.ivrm.jp');
  });

  it('httpsでもlocalhostでもないURLと不正なURLはnullを返す', () => {
    expect(
      resolveActivityDailySyncConfig({ ...fullEnv, IVRM_WEB_API_BASE_URL: 'http://api.ivrm.jp' }),
    ).toBeNull();
    expect(
      resolveActivityDailySyncConfig({ ...fullEnv, IVRM_WEB_API_BASE_URL: 'not a url' }),
    ).toBeNull();
  });
});

describe('jstActivityDateKey / activityDailyDateKeys', () => {
  it('JST 0:00 (UTC 15:00) を境に日付キーが切り替わる', () => {
    expect(jstActivityDateKey(new Date('2026-11-23T14:59:59.000Z'))).toBe('2026-11-23');
    expect(jstActivityDateKey(new Date('2026-11-23T15:00:00.000Z'))).toBe('2026-11-24');
  });

  it('窓はJST当日を末尾に含む8日分を古い順に返す', () => {
    // 2026-11-23T16:00Z は JST では 2026-11-24 01:00
    expect(activityDailyDateKeys(new Date('2026-11-23T16:00:00.000Z'))).toEqual([
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
    ]);
  });
});

describe('foldCommandExecutionsToDailyRows', () => {
  it('同一ユーザー・同一JST日の成功実行を合算する', () => {
    const folded = foldCommandExecutionsToDailyRows([
      { userId: 'u1', executedAt: new Date('2026-11-23T01:00:00.000Z') },
      { userId: 'u1', executedAt: new Date('2026-11-23T02:00:00.000Z') },
      { userId: 'u2', executedAt: new Date('2026-11-23T02:30:00.000Z') },
    ]);
    expect(folded).toEqual([
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'commands', value: 2 },
      { discordUserId: 'u2', activityDate: '2026-11-23', metric: 'commands', value: 1 },
    ]);
  });

  it('JST日付境界 (UTC 15:00) をまたぐ実行は別日に畳む', () => {
    const folded = foldCommandExecutionsToDailyRows([
      { userId: 'u1', executedAt: new Date('2026-11-23T14:59:59.000Z') },
      { userId: 'u1', executedAt: new Date('2026-11-23T15:00:00.000Z') },
    ]);
    expect(folded).toEqual([
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'commands', value: 1 },
      { discordUserId: 'u1', activityDate: '2026-11-24', metric: 'commands', value: 1 },
    ]);
  });

  it('userIdが無い行は数えない', () => {
    expect(
      foldCommandExecutionsToDailyRows([
        { userId: null, executedAt: new Date('2026-11-23T01:00:00.000Z') },
      ]),
    ).toEqual([]);
  });
});

describe('foldChannelPairsToGaugeRows', () => {
  it('ユーザーごとのdistinctチャンネル数をJST当日のgauge行にする', () => {
    const folded = foldChannelPairsToGaugeRows(
      [
        { userId: 'u1', channelId: 'c1' },
        { userId: 'u1', channelId: 'c2' },
        { userId: 'u1', channelId: 'c1' },
        { userId: 'u2', channelId: 'c1' },
      ],
      '2026-11-23',
    );
    expect(folded).toEqual([
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'channels_total', value: 2 },
      { discordUserId: 'u2', activityDate: '2026-11-23', metric: 'channels_total', value: 1 },
    ]);
  });

  it('組が無ければ行を出さない', () => {
    expect(foldChannelPairsToGaugeRows([], '2026-11-23')).toEqual([]);
  });
});

describe('collectActivityDailyRows', () => {
  it('reactions given/receivedの日次とcommandsの畳み込みとchannels gaugeを統合し、窓と正本の条件で引く', async () => {
    const communityActivityDaily = {
      findMany: vi.fn().mockResolvedValue([
        {
          userId: 'u1',
          activityDate: new Date('2026-11-23T00:00:00.000Z'),
          metric: 'reactions_given',
          value: 3n,
        },
        {
          userId: 'u1',
          activityDate: new Date('2026-11-23T00:00:00.000Z'),
          metric: 'reactions_received',
          value: 5n,
        },
        {
          userId: 'u2',
          activityDate: new Date('2026-11-22T00:00:00.000Z'),
          metric: 'reactions_given',
          value: 1n,
        },
      ]),
    };
    const commandExecutionEvent = {
      findMany: vi.fn().mockResolvedValue([
        { userId: 'u1', executedAt: new Date('2026-11-23T01:00:00.000Z') },
        { userId: 'u1', executedAt: new Date('2026-11-23T05:00:00.000Z') },
      ]),
    };
    const communityActivityChannelDaily = {
      findMany: vi.fn().mockResolvedValue([
        { userId: 'u1', channelId: 'c1' },
        { userId: 'u1', channelId: 'c2' },
        { userId: 'u2', channelId: 'c1' },
      ]),
    };
    const prisma = {
      communityActivityDaily,
      commandExecutionEvent,
      communityActivityChannelDaily,
    } as unknown as PrismaClient;

    // JST では 2026-11-23 19:00
    const collected = await collectActivityDailyRows(
      prisma,
      GUILD_ID,
      new Date('2026-11-23T10:00:00.000Z'),
    );

    expect(collected).toEqual([
      { discordUserId: 'u2', activityDate: '2026-11-22', metric: 'reactions_given', value: 1 },
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'channels_total', value: 2 },
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'commands', value: 2 },
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'reactions_given', value: 3 },
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'reactions_received', value: 5 },
      { discordUserId: 'u2', activityDate: '2026-11-23', metric: 'channels_total', value: 1 },
    ]);

    const reactionArgs = communityActivityDaily.findMany.mock.calls[0]![0];
    expect(reactionArgs.where.guildId).toBe(GUILD_ID);
    expect(reactionArgs.where.metric).toEqual({
      in: ['reactions_given', 'reactions_received'],
    });
    expect(reactionArgs.where.activityDate.gte).toEqual(new Date('2026-11-16T00:00:00.000Z'));
    expect(reactionArgs.where.activityDate.lte).toEqual(new Date('2026-11-23T00:00:00.000Z'));

    const channelArgs = communityActivityChannelDaily.findMany.mock.calls[0]![0];
    expect(channelArgs.where.guildId).toBe(GUILD_ID);
    expect(channelArgs.where.metric).toBe('messages');

    const commandArgs = commandExecutionEvent.findMany.mock.calls[0]![0];
    expect(commandArgs.where.guildId).toBe(GUILD_ID);
    expect(commandArgs.where.status).toBe('success');
    // JST 2026-11-16 0:00 = UTC 2026-11-15 15:00、窓の終わりは JST 2026-11-24 0:00
    expect(commandArgs.where.executedAt.gte).toEqual(new Date('2026-11-15T15:00:00.000Z'));
    expect(commandArgs.where.executedAt.lt).toEqual(new Date('2026-11-23T15:00:00.000Z'));
  });

  it('チャンネル内訳を読めなくてもcount系は送れる (gaugeだけfail-soft)', async () => {
    const communityActivityDaily = {
      findMany: vi.fn().mockResolvedValue([
        {
          userId: 'u1',
          activityDate: new Date('2026-11-23T00:00:00.000Z'),
          metric: 'reactions_given',
          value: 3n,
        },
      ]),
    };
    const commandExecutionEvent = { findMany: vi.fn().mockResolvedValue([]) };
    const communityActivityChannelDaily = {
      findMany: vi.fn().mockRejectedValue(new Error('relation does not exist')),
    };
    const prisma = {
      communityActivityDaily,
      commandExecutionEvent,
      communityActivityChannelDaily,
    } as unknown as PrismaClient;

    const collected = await collectActivityDailyRows(
      prisma,
      GUILD_ID,
      new Date('2026-11-23T10:00:00.000Z'),
    );

    expect(collected).toEqual([
      { discordUserId: 'u1', activityDate: '2026-11-23', metric: 'reactions_given', value: 3 },
    ]);
  });
});

describe('buildActivityDailySyncRequest', () => {
  it('/v1/herta/activity-daily契約と一致するURL・header・bodyを生成する', () => {
    const timestamp = '2026-11-23T10:00:01.000Z';
    const eventId = '018f4b20-8a6f-7a2a-8f4b-1234567890ab';
    const request = buildActivityDailySyncRequest(config, eventId, rows, timestamp);

    expect(request.url).toBe('https://api.ivrm.jp/v1/herta/activity-daily');
    expect(request.init.method).toBe('POST');
    expect(request.init.headers['Content-Type']).toBe('application/json');
    expect(request.init.headers['X-IVRM-Timestamp']).toBe(timestamp);
    expect(request.init.headers['X-IVRM-Event-Id']).toBe(eventId);
    expect(JSON.parse(request.init.body)).toEqual({
      schemaVersion: 1,
      eventId,
      guildId: GUILD_ID,
      rows,
    });
  });

  it('署名は活動同期と同じcanonical文字列(METHOD\\nPATH\\nTIMESTAMP\\nEVENT_ID\\nBODY)から検証できる', () => {
    const timestamp = '2026-11-23T10:00:01.000Z';
    const eventId = '018f4b20-8a6f-7a2a-8f4b-1234567890ab';
    const request = buildActivityDailySyncRequest(config, eventId, rows, timestamp);

    const canonical = [
      'POST',
      '/v1/herta/activity-daily',
      timestamp,
      eventId,
      request.init.body,
    ].join('\n');
    const expected = createHmac('sha256', config.secret).update(canonical).digest('hex');

    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
  });

  it('secretが異なれば署名も変わる', () => {
    const timestamp = '2026-11-23T10:00:01.000Z';
    const eventId = '018f4b20-8a6f-7a2a-8f4b-1234567890ab';
    const a = buildActivityDailySyncRequest(config, eventId, rows, timestamp);
    const b = buildActivityDailySyncRequest(
      { ...config, secret: 'other-secret' },
      eventId,
      rows,
      timestamp,
    );

    expect(a.init.headers['X-IVRM-Signature']).not.toBe(b.init.headers['X-IVRM-Signature']);
  });
});

describe('pushActivityDailyToIvrmWeb', () => {
  it('行が無い場合は送信しない', async () => {
    const logger = silentLogger();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await pushActivityDailyToIvrmWeb(config, [], logger);

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('成功時はwarnログを出さない', async () => {
    const logger = silentLogger();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await pushActivityDailyToIvrmWeb(config, rows, logger);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('404(受付未着地)は正常な無視対象としてwarnログを出さない', async () => {
    const logger = silentLogger();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await pushActivityDailyToIvrmWeb(config, rows, logger);

    expect(logger.warn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('5xxはwarnログを出すが例外は投げない', async () => {
    const logger = silentLogger();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));

    await expect(pushActivityDailyToIvrmWeb(config, rows, logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('network failureはwarnログを出すが例外は投げない', async () => {
    const logger = silentLogger();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    await expect(pushActivityDailyToIvrmWeb(config, rows, logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
