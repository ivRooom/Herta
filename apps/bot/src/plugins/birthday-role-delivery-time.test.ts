import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBirthdayRoleCycle } from './birthday-role.js';

// Cycle-level tests for the delivery-time gate (#1921 R3-B). The
// ivrm path must hold celebrations (celebration row, role grant,
// announcement) until the JST delivery time, while the stale-role
// cleanup keeps running every cycle and the legacy path stays
// immediate. Prisma is faked in memory by dispatching on the raw
// SQL text of birthday-role-repository.ts; Discord is faked with
// recording members/channels.

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '123456789012345678';
const ROLE_ID = '223456789012345678';
const TODAY_USER = '123456789012345678';
const YESTERDAY_USER = '223456789012345678';

// JST 2026-11-22 moments used across the scenarios.
const BEFORE_TIME = new Date('2026-11-21T23:30:00.000Z'); // 08:30 JST
const AT_TIME = new Date('2026-11-22T00:00:00.000Z'); // 09:00 JST
const AFTER_TIME = new Date('2026-11-22T01:00:00.000Z'); // 10:00 JST
const LEGACY_EARLY = new Date('2026-11-21T15:30:00.000Z'); // 00:30 JST

interface FakeDelivery {
  id: string;
  guildId: string;
  userId: string;
  localDate: string;
  kind: string;
  idempotencyKey: string;
  status: string;
  completedAt: Date | null;
  reconciledAt: Date | null;
}

interface FakeRegistration {
  userId: string;
  month: number;
  day: number;
  birthYear: number | null;
}

function createHarness(registrations: FakeRegistration[] = []) {
  const deliveries: FakeDelivery[] = [];
  const celebrations: unknown[][] = [];
  const roleAdds: Array<{ userId: string; roleId: string }> = [];
  const roleRemoves: Array<{ userId: string; roleId: string }> = [];
  const sends: Array<{ content: string }> = [];
  const membersWithRole = new Set<string>();
  // The simulated instant stamped onto deliveries when they
  // complete, so tests control which JST date a completion
  // falls on instead of depending on the wall clock.
  let completionTime = new Date();

  const sqlOf = (strings: TemplateStringsArray) => strings.join(' ');

  const prisma = {
    guild: {
      findUnique: async () => ({ timezone: 'Asia/Tokyo' }),
    },
    guildMember: {
      findMany: async () => [],
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlOf(strings);
      if (sql.includes('RETURNING')) {
        // claimBirthdayDelivery
        const delivery = deliveries.find((entry) => entry.id === values[0]);
        if (delivery && (delivery.status === 'pending' || delivery.status === 'failed')) {
          delivery.status = 'processing';
          return [{ id: delivery.id }];
        }
        return [];
      }
      if (sql.includes('FROM "birthday_registrations"')) return registrations;
      if (sql.includes('DISTINCT')) {
        // listDeliveredBirthdayUserIds
        const localDate = values[1] as string;
        const userIds = [
          ...new Set(
            deliveries
              .filter(
                (entry) =>
                  entry.guildId === values[0] &&
                  entry.localDate === localDate &&
                  entry.status === 'completed',
              )
              .map((entry) => entry.userId),
          ),
        ];
        return userIds.map((userId) => ({ userId }));
      }
      if (sql.includes('FROM "birthday_deliveries"') && sql.includes('LIKE')) {
        // listPendingBirthdayRoleAssignments
        const currentLocalDate = values[2] as string;
        return deliveries
          .filter(
            (entry) =>
              entry.guildId === values[0] &&
              entry.status === 'completed' &&
              entry.kind.startsWith('role-assigned:') &&
              entry.reconciledAt === null &&
              entry.localDate < currentLocalDate,
          )
          .map((entry) => ({
            id: entry.id,
            userId: entry.userId,
            localDate: entry.localDate,
            kind: entry.kind,
            completedAt: entry.completedAt,
          }));
      }
      if (sql.includes('FROM "birthday_deliveries"')) {
        // ensureBirthdayDelivery follow-up select by idempotency key
        const delivery = deliveries.find((entry) => entry.idempotencyKey === values[0]);
        return delivery ? [{ id: delivery.id, status: delivery.status }] : [];
      }
      return [];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlOf(strings);
      if (sql.includes('INSERT INTO "birthday_celebrations"')) {
        celebrations.push(values);
        return 1;
      }
      if (sql.includes('INSERT INTO "birthday_deliveries"')) {
        const [id, guildId, userId, localDate, kind, idempotencyKey] = values as string[];
        if (!deliveries.some((entry) => entry.idempotencyKey === idempotencyKey)) {
          deliveries.push({
            id: id!,
            guildId: guildId!,
            userId: userId!,
            localDate: localDate!,
            kind: kind!,
            idempotencyKey: idempotencyKey!,
            status: 'pending',
            completedAt: null,
            reconciledAt: null,
          });
        }
        return 1;
      }
      if (sql.includes('StaleDelivery')) return 0;
      if (sql.includes('"reconciled_at"')) {
        const delivery = deliveries.find((entry) => entry.id === values[0]);
        if (delivery) delivery.reconciledAt = new Date();
        return 1;
      }
      if (sql.includes(`"status" = 'completed'`)) {
        const delivery = deliveries.find((entry) => entry.id === values[1]);
        if (delivery) {
          delivery.status = 'completed';
          delivery.completedAt = completionTime;
        }
        return 1;
      }
      if (sql.includes(`"status" = 'failed'`)) {
        const delivery = deliveries.find((entry) => entry.id === values[1]);
        if (delivery) delivery.status = 'failed';
        return 1;
      }
      return 0;
    },
  };

  const memberFor = (userId: string) => ({
    displayName: `Member ${userId.slice(-4)}`,
    displayAvatarURL: () => null,
    roles: {
      cache: { has: (roleId: string) => membersWithRole.has(`${userId}:${roleId}`) },
      add: async (roleId: string) => {
        roleAdds.push({ userId, roleId });
        membersWithRole.add(`${userId}:${roleId}`);
      },
      remove: async (roleId: string) => {
        roleRemoves.push({ userId, roleId });
        membersWithRole.delete(`${userId}:${roleId}`);
      },
    },
  });

  const guild = {
    id: GUILD_ID,
    members: {
      me: { permissions: { has: () => true } },
      fetch: async (userId: string) => memberFor(userId),
    },
    roles: {
      fetch: async (roleId: string) => ({ id: roleId, managed: false, editable: true }),
    },
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (options: { content: string }) => {
          sends.push(options);
          return { id: 'message-1' };
        },
      }),
    },
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const contextFor = (config: Record<string, unknown>) =>
    ({
      guildId: GUILD_ID,
      config,
      prisma,
      client: { guilds: { fetch: async () => guild } },
      logger,
    }) as unknown as Parameters<typeof runBirthdayRoleCycle>[0];

  const seedYesterdayAssignment = () => {
    deliveries.push({
      id: 'assignment-yesterday',
      guildId: GUILD_ID,
      userId: YESTERDAY_USER,
      localDate: '2026-11-21',
      kind: `role-assigned:${ROLE_ID}`,
      idempotencyKey: `${GUILD_ID}:${YESTERDAY_USER}:2026-11-21:role-assigned:${ROLE_ID}`,
      status: 'completed',
      // Granted on its own date (10:00 JST on 2026-11-21), so
      // the next day's cleanup must not treat it as a late
      // grant worth protecting.
      completedAt: new Date('2026-11-21T01:00:00.000Z'),
      reconciledAt: null,
    });
    membersWithRole.add(`${YESTERDAY_USER}:${ROLE_ID}`);
  };

  return {
    celebrations,
    contextFor,
    deliveries,
    roleAdds,
    roleRemoves,
    seedYesterdayAssignment,
    sends,
    setCompletionTime: (date: Date) => {
      completionTime = date;
    },
  };
}

function apiSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    announcementChannelId: CHANNEL_ID,
    birthdayRoleId: ROLE_ID,
    announcementMessage: '🎂 {user} お誕生日おめでとう！',
    leapDayPolicy: 'february-28',
    pointsAmount: 300,
    deliveryTime: '09:00',
    card: {
      enabled: false,
      preset: 'herta-night-board',
      backgroundUrl: null,
      showName: true,
      showAvatar: true,
      showBirthday: true,
    },
    ...overrides,
  };
}

function stubIvrmApi(
  settings: Record<string, unknown>,
  recipientsByDate: Record<string, Array<Record<string, unknown>>> = {
    '2026-11-22': [
      {
        memberId: 'member-a',
        discordUserId: TODAY_USER,
        displayName: 'A',
        month: 11,
        day: 22,
      },
    ],
  },
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(init.body as string) as Record<string, unknown>;
      return Response.json({
        schemaVersion: 2,
        requestId: request.requestId,
        action: 'today',
        status: 'ok',
        enabled: true,
        settings,
        // The supply API answers for the requested JST date, so
        // the stub keys recipients by the request's localDate
        // (dates without an entry have no birthdays).
        recipients: recipientsByDate[request.localDate as string] ?? [],
      });
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('IVRM_WEB_API_BASE_URL', 'https://api.ivrm.jp');
  vi.stubEnv('HERTA_MBTI_SYNC_SECRET', '<fixture-secret>');
  vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', GUILD_ID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runBirthdayRoleCycle の配信時刻ゲート (#1921 R3-B)', () => {
  it('配信時刻前はお祝いを配信せず、ロール解除だけが毎サイクル走る', async () => {
    const harness = createHarness();
    harness.seedYesterdayAssignment();
    stubIvrmApi(apiSettings());

    await runBirthdayRoleCycle(harness.contextFor({ useIvrmApiSource: true }), BEFORE_TIME);

    expect(harness.roleAdds).toEqual([]);
    expect(harness.sends).toEqual([]);
    expect(harness.celebrations).toEqual([]);
    // 前日分の解除はゲート対象外なので時刻前でも実行される
    expect(harness.roleRemoves).toEqual([{ userId: YESTERDAY_USER, roleId: ROLE_ID }]);
    expect(
      harness.deliveries.find((entry) => entry.id === 'assignment-yesterday')?.reconciledAt,
    ).not.toBeNull();
  });

  it('配信時刻以降に配信し、同日の再サイクルでも二重配信にならない', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings());
    const context = harness.contextFor({ useIvrmApiSource: true });

    await runBirthdayRoleCycle(context, AT_TIME);
    expect(harness.roleAdds).toEqual([{ userId: TODAY_USER, roleId: ROLE_ID }]);
    expect(harness.sends).toHaveLength(1);
    expect(harness.celebrations).toHaveLength(1);

    await runBirthdayRoleCycle(context, AFTER_TIME);
    expect(harness.roleAdds).toEqual([{ userId: TODAY_USER, roleId: ROLE_ID }]);
    expect(harness.sends).toHaveLength(1);
    expect(harness.deliveries.filter((entry) => entry.status === 'completed')).toHaveLength(2);
  });

  it('deliveryTime が欠落した設定では既定09:00でゲートする', async () => {
    const harness = createHarness();
    const settings = apiSettings();
    delete settings.deliveryTime;
    stubIvrmApi(settings);

    await runBirthdayRoleCycle(harness.contextFor({ useIvrmApiSource: true }), BEFORE_TIME);

    expect(harness.roleAdds).toEqual([]);
    expect(harness.sends).toEqual([]);
  });

  it('配信時刻がその日の最終サイクルより遅いと日付をまたいでも翌日に回収される', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings({ deliveryTime: '23:59' }));
    const context = harness.contextFor({ useIvrmApiSource: true });

    // 2026-11-22 23:30 JST: 23:59 に届かないため、その日の
    // サイクルは最後まで先送りし続ける。
    harness.setCompletionTime(new Date('2026-11-22T14:30:00.000Z'));
    await runBirthdayRoleCycle(context, new Date('2026-11-22T14:30:00.000Z'));
    expect(harness.roleAdds).toEqual([]);
    expect(harness.sends).toEqual([]);

    // 2026-11-23 00:30 JST: 前日分は未配信のまま due として
    // 回収され、前日の localDate で配信される。
    harness.setCompletionTime(new Date('2026-11-22T15:30:00.000Z'));
    await runBirthdayRoleCycle(context, new Date('2026-11-22T15:30:00.000Z'));
    expect(harness.roleAdds).toEqual([{ userId: TODAY_USER, roleId: ROLE_ID }]);
    expect(harness.sends).toHaveLength(1);
    expect(
      harness.deliveries
        .filter((entry) => entry.status === 'completed')
        .map((entry) => entry.localDate),
    ).toEqual(['2026-11-22', '2026-11-22']);
    expect(harness.celebrations).toHaveLength(1);
    expect(harness.celebrations[0]?.[2]).toBe('2026-11-22');

    // 同日の後続サイクルでも二重配信にならず、遅れて付いた
    // ロールもその日のうちは剥がれない。
    await runBirthdayRoleCycle(context, new Date('2026-11-22T16:30:00.000Z'));
    expect(harness.roleAdds).toEqual([{ userId: TODAY_USER, roleId: ROLE_ID }]);
    expect(harness.sends).toHaveLength(1);
    expect(harness.roleRemoves).toEqual([]);

    // 翌日には通常どおりロールが解除される。
    await runBirthdayRoleCycle(context, new Date('2026-11-23T15:30:00.000Z'));
    expect(harness.roleRemoves).toEqual([{ userId: TODAY_USER, roleId: ROLE_ID }]);
  });

  it('legacy経路には時刻ゲートが無く、0時台でも従来どおり配信する', async () => {
    const harness = createHarness([{ userId: TODAY_USER, month: 11, day: 22, birthYear: null }]);

    await runBirthdayRoleCycle(
      harness.contextFor({
        birthdayRoleId: ROLE_ID,
        announcementChannelId: CHANNEL_ID,
      }),
      LEGACY_EARLY,
    );

    expect(harness.roleAdds).toEqual([{ userId: TODAY_USER, roleId: ROLE_ID }]);
    expect(harness.sends).toHaveLength(1);
  });
});
