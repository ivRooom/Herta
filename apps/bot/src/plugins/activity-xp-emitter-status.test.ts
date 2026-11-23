import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import {
  buildXpEmitterStatusSnapshot,
  buildXpEmitterStatusUpsert,
  collectActivityXpOutboxStatusSource,
  reportActivityXpEmitterStatus,
  type ActivityXpOutboxStatusSource,
  type XpEmitterStatusSnapshot,
  type XpEmitterStatusWriter,
} from './activity-xp-emitter-status.js';

const GUILD_ID = '964326043420872704';
const REPORTED_AT = new Date('2026-11-23T08:00:00.000Z');

function silentLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

interface FakeOutboxRow {
  guildId: string;
  status: string;
  lastStatus: number | null;
  sentAt: Date | null;
  createdAt: Date;
}

function maxDate(values: Array<Date | null>): Date | null {
  let result: Date | null = null;
  for (const value of values) {
    if (value && (result === null || value.getTime() > result.getTime())) result = value;
  }
  return result;
}

function minDate(values: Array<Date | null>): Date | null {
  let result: Date | null = null;
  for (const value of values) {
    if (value && (result === null || value.getTime() < result.getTime())) result = value;
  }
  return result;
}

/**
 * outbox の fake データセットから groupBy / aggregate を計算する Prisma スタブ。
 * collectActivityXpOutboxStatusSource が実 Prisma に対して発行するクエリ形状
 * (by / where / _count / _max / _min) だけを再現する。
 */
function fakePrisma(rows: readonly FakeOutboxRow[]): PrismaClient {
  const scoped = (where?: { guildId?: string; status?: string }): FakeOutboxRow[] =>
    rows.filter(
      (row) =>
        (where?.guildId === undefined || row.guildId === where.guildId) &&
        (where?.status === undefined || row.status === where.status),
    );
  const fake = {
    activityXpEventOutbox: {
      async groupBy(args: { by: string[]; where?: { guildId?: string; status?: string } }) {
        const key = args.by[0]!;
        const groups = new Map<string | number | null, number>();
        for (const row of scoped(args.where)) {
          const value = key === 'status' ? row.status : row.lastStatus;
          groups.set(value, (groups.get(value) ?? 0) + 1);
        }
        return [...groups.entries()].map(([value, count]) => ({
          [key]: value,
          _count: { _all: count },
        }));
      },
      async aggregate(args: {
        where?: { guildId?: string; status?: string };
        _max?: { sentAt?: boolean; createdAt?: boolean };
        _min?: { createdAt?: boolean };
      }) {
        const target = scoped(args.where);
        if (args._max) {
          return {
            _max: {
              sentAt: maxDate(target.map((row) => row.sentAt)),
              createdAt: maxDate(target.map((row) => row.createdAt)),
            },
          };
        }
        return { _min: { createdAt: minDate(target.map((row) => row.createdAt)) } };
      },
    },
  };
  return fake as unknown as PrismaClient;
}

const DATASET: FakeOutboxRow[] = [
  {
    guildId: GUILD_ID,
    status: 'pending',
    lastStatus: null,
    sentAt: null,
    createdAt: new Date('2026-11-23T06:30:00.000Z'),
  },
  {
    guildId: GUILD_ID,
    status: 'pending',
    lastStatus: 503,
    sentAt: null,
    createdAt: new Date('2026-11-23T07:15:00.000Z'),
  },
  {
    guildId: GUILD_ID,
    status: 'sent',
    lastStatus: 201,
    sentAt: new Date('2026-11-23T07:03:34.000Z'),
    createdAt: new Date('2026-11-23T07:03:33.000Z'),
  },
  {
    guildId: GUILD_ID,
    status: 'sent',
    lastStatus: 200,
    sentAt: new Date('2026-11-23T05:03:34.000Z'),
    createdAt: new Date('2026-11-23T05:03:33.000Z'),
  },
  {
    guildId: GUILD_ID,
    status: 'dropped',
    lastStatus: 409,
    sentAt: null,
    createdAt: new Date('2026-11-23T07:03:33.000Z'),
  },
  {
    guildId: GUILD_ID,
    status: 'dropped',
    lastStatus: 422,
    sentAt: null,
    createdAt: new Date('2026-11-23T06:03:33.000Z'),
  },
  {
    guildId: GUILD_ID,
    status: 'dropped',
    lastStatus: null,
    sentAt: null,
    createdAt: new Date('2026-11-23T04:03:33.000Z'),
  },
  {
    guildId: GUILD_ID,
    status: 'failed',
    lastStatus: 503,
    sentAt: null,
    createdAt: new Date('2026-11-22T03:03:33.000Z'),
  },
  // 別 guild の行は集計に混ざらないこと。
  {
    guildId: '1111111111111111111',
    status: 'sent',
    lastStatus: 201,
    sentAt: new Date('2026-11-23T07:59:00.000Z'),
    createdAt: new Date('2026-11-23T07:59:00.000Z'),
  },
];

describe('collectActivityXpOutboxStatusSource', () => {
  it('guild 単位で status 件数・dropped 内訳・日時を集計する', async () => {
    const source = await collectActivityXpOutboxStatusSource(fakePrisma(DATASET), GUILD_ID);
    expect(source.statusCounts).toContainEqual({ status: 'pending', count: 2 });
    expect(source.statusCounts).toContainEqual({ status: 'sent', count: 2 });
    expect(source.statusCounts).toContainEqual({ status: 'dropped', count: 3 });
    expect(source.statusCounts).toContainEqual({ status: 'failed', count: 1 });
    expect(source.droppedStatusCounts).toContainEqual({ lastStatus: 409, count: 1 });
    expect(source.droppedStatusCounts).toContainEqual({ lastStatus: 422, count: 1 });
    expect(source.droppedStatusCounts).toContainEqual({ lastStatus: null, count: 1 });
    expect(source.lastSentAt?.toISOString()).toBe('2026-11-23T07:03:34.000Z');
    expect(source.lastCreatedAt?.toISOString()).toBe('2026-11-23T07:15:00.000Z');
    expect(source.oldestPendingAt?.toISOString()).toBe('2026-11-23T06:30:00.000Z');
  });

  it('outbox が空なら件数ゼロ・日時 null を返す', async () => {
    const source = await collectActivityXpOutboxStatusSource(fakePrisma([]), GUILD_ID);
    expect(source.statusCounts).toEqual([]);
    expect(source.droppedStatusCounts).toEqual([]);
    expect(source.lastSentAt).toBeNull();
    expect(source.lastCreatedAt).toBeNull();
    expect(source.oldestPendingAt).toBeNull();
  });
});

describe('buildXpEmitterStatusSnapshot', () => {
  it('409 / 422 / その他 (NULL 含む) に dropped を振り分ける', () => {
    const source: ActivityXpOutboxStatusSource = {
      statusCounts: [
        { status: 'pending', count: 3 },
        { status: 'sent', count: 35 },
        { status: 'dropped', count: 10 },
        { status: 'failed', count: 1 },
        { status: 'unknown-status', count: 7 },
      ],
      droppedStatusCounts: [
        { lastStatus: 409, count: 6 },
        { lastStatus: 422, count: 3 },
        { lastStatus: null, count: 1 },
      ],
      lastSentAt: new Date('2026-11-23T07:03:34.000Z'),
      lastCreatedAt: new Date('2026-11-23T07:15:00.000Z'),
      oldestPendingAt: null,
    };
    const snapshot = buildXpEmitterStatusSnapshot(GUILD_ID, source, REPORTED_AT);
    expect(snapshot).toEqual({
      guildId: GUILD_ID,
      pendingCount: 3,
      sentCount: 35,
      droppedCount: 10,
      failedCount: 1,
      dropped409Count: 6,
      dropped422Count: 3,
      droppedOtherCount: 1,
      lastSentAt: '2026-11-23T07:03:34.000Z',
      lastCreatedAt: '2026-11-23T07:15:00.000Z',
      oldestPendingAt: null,
      reportedAt: '2026-11-23T08:00:00.000Z',
    });
  });
});

describe('buildXpEmitterStatusUpsert', () => {
  it('ivrm_api.xp_emitter_status へ guild_id 衝突で更新する SQL と14パラメータを作る', () => {
    const snapshot: XpEmitterStatusSnapshot = {
      guildId: GUILD_ID,
      pendingCount: 2,
      sentCount: 2,
      droppedCount: 3,
      failedCount: 1,
      dropped409Count: 1,
      dropped422Count: 1,
      droppedOtherCount: 1,
      lastSentAt: '2026-11-23T07:03:34.000Z',
      lastCreatedAt: '2026-11-23T07:15:00.000Z',
      oldestPendingAt: '2026-11-23T06:30:00.000Z',
      reportedAt: '2026-11-23T08:00:00.000Z',
    };
    const { sql, params } = buildXpEmitterStatusUpsert(snapshot);
    expect(sql).toContain('INSERT INTO ivrm_api.xp_emitter_status');
    expect(sql).toContain('ON CONFLICT (guild_id) DO UPDATE SET');
    // created_at は初回 insert の値を保持し、更新では上書きしない。
    expect(sql).not.toContain('created_at = EXCLUDED.created_at');
    expect(params).toEqual([
      GUILD_ID,
      2,
      2,
      3,
      1,
      1,
      1,
      1,
      '2026-11-23T07:03:34.000Z',
      '2026-11-23T07:15:00.000Z',
      '2026-11-23T06:30:00.000Z',
      '2026-11-23T08:00:00.000Z',
      '2026-11-23T08:00:00.000Z',
      '2026-11-23T08:00:00.000Z',
    ]);
  });
});

describe('reportActivityXpEmitterStatus', () => {
  const env = { IVRM_API_DATABASE_URL: 'postgres://example.invalid/ivrm' };

  it('URL 未設定なら writer を作らず false を返す', async () => {
    const createWriter = vi.fn();
    const result = await reportActivityXpEmitterStatus({
      prisma: fakePrisma(DATASET),
      guildId: GUILD_ID,
      env: {},
      logger: silentLogger(),
      now: REPORTED_AT,
      createWriter,
    });
    expect(result).toBe(false);
    expect(createWriter).not.toHaveBeenCalled();
  });

  it('集計したスナップショットを upsert し、writer を閉じて true を返す', async () => {
    const upserted: XpEmitterStatusSnapshot[] = [];
    const writer: XpEmitterStatusWriter = {
      async upsert(snapshot) {
        upserted.push(snapshot);
      },
      close: vi.fn(async () => undefined),
    };
    const result = await reportActivityXpEmitterStatus({
      prisma: fakePrisma(DATASET),
      guildId: GUILD_ID,
      env,
      logger: silentLogger(),
      now: REPORTED_AT,
      createWriter: () => writer,
    });
    expect(result).toBe(true);
    expect(writer.close).toHaveBeenCalledTimes(1);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({
      guildId: GUILD_ID,
      pendingCount: 2,
      sentCount: 2,
      droppedCount: 3,
      failedCount: 1,
      dropped409Count: 1,
      dropped422Count: 1,
      droppedOtherCount: 1,
      reportedAt: '2026-11-23T08:00:00.000Z',
    });
  });

  it('upsert が失敗しても例外を投げず warn を残して false を返す (fail-soft)', async () => {
    const logger = silentLogger();
    const writer: XpEmitterStatusWriter = {
      async upsert() {
        throw new Error('relation "ivrm_api.xp_emitter_status" does not exist');
      },
      close: vi.fn(async () => undefined),
    };
    const result = await reportActivityXpEmitterStatus({
      prisma: fakePrisma(DATASET),
      guildId: GUILD_ID,
      env,
      logger,
      now: REPORTED_AT,
      createWriter: () => writer,
    });
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(writer.close).toHaveBeenCalledTimes(1);
  });

  it('集計が失敗しても例外を投げず false を返す (fail-soft)', async () => {
    const logger = silentLogger();
    const brokenPrisma = {
      activityXpEventOutbox: {
        async groupBy(): Promise<never> {
          throw new Error('database unreachable');
        },
        async aggregate(): Promise<never> {
          throw new Error('database unreachable');
        },
      },
    } as unknown as PrismaClient;
    const result = await reportActivityXpEmitterStatus({
      prisma: brokenPrisma,
      guildId: GUILD_ID,
      env,
      logger,
      now: REPORTED_AT,
      createWriter: () => {
        throw new Error('createWriter must not be reached');
      },
    });
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
