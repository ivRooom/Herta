import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  birthdayRolePlugin,
  isManualBirthdayDeliveryDateInRange,
  runManualBirthdayDelivery,
  runManualBirthdayDeliveryForGuild,
} from './birthday-role.js';

// Manual-delivery tests (#1062). The single-shot run must share
// the cycle's supply fetch and per-kind idempotency keys (a
// re-run is a no-op, a partial failure is repaired kind by
// kind), refuse out-of-window dates at the bot layer too, and
// report refusals and per-kind failures as reason codes.
// Prisma is faked in memory by dispatching on the raw SQL text
// of birthday-role-repository.ts; Discord is faked with
// recording members/channels, following the delivery-time
// harness.

const GUILD_ID = '111111111111111111';
const USER_ID = '222222222222222222';
const CHANNEL_ID = '333333333333333333';
const ROLE_ID = '444444444444444444';

// JST 2026-11-22 10:00.
const NOW = new Date('2026-11-22T01:00:00.000Z');
const TODAY = '2026-11-22';

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

interface HarnessOptions {
  roleEditable?: boolean;
  channelAvailable?: boolean;
  missingMembers?: Set<string>;
}

function deliveryKey(userId: string, localDate: string, kind: string): string {
  return ['birthday', GUILD_ID, userId, localDate, kind].join(':');
}

function createHarness(options: HarnessOptions = {}) {
  const deliveries: FakeDelivery[] = [];
  const celebrations: unknown[][] = [];
  const roleAdds: Array<{ userId: string; roleId: string }> = [];
  const sends: Array<{ content: string }> = [];
  const membersWithRole = new Set<string>();
  let nextId = 0;

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
      if (sql.includes('FROM "birthday_registrations"')) return [];
      if (sql.includes('DISTINCT')) {
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
          delivery.completedAt = new Date();
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
        membersWithRole.delete(`${userId}:${roleId}`);
      },
    },
  });

  const guild = {
    id: GUILD_ID,
    members: {
      me: { permissions: { has: () => true } },
      fetch: async (userId: string) => {
        if (options.missingMembers?.has(userId)) throw new Error('Unknown Member');
        return memberFor(userId);
      },
    },
    roles: {
      fetch: async (roleId: string) => ({
        id: roleId,
        managed: false,
        editable: options.roleEditable ?? true,
      }),
    },
    channels: {
      fetch: async () => {
        if (options.channelAvailable === false) return null;
        return {
          isTextBased: () => true,
          send: async (sendOptions: { content: string }) => {
            sends.push(sendOptions);
            return { id: `message-${(nextId += 1)}` };
          },
        };
      },
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
    }) as unknown as Parameters<typeof runManualBirthdayDelivery>[0];

  const seedDelivery = (kind: string, status: string, localDate = TODAY) => {
    deliveries.push({
      id: `seed-${kind}-${status}`,
      guildId: GUILD_ID,
      userId: USER_ID,
      localDate,
      kind,
      idempotencyKey: deliveryKey(USER_ID, localDate, kind),
      status,
      completedAt: status === 'completed' ? new Date() : null,
      reconciledAt: null,
    });
  };

  return { celebrations, contextFor, deliveries, roleAdds, seedDelivery, sends };
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

function recipientFor(localDate: string): Record<string, unknown> {
  const [, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return {
    memberId: 'member-a',
    discordUserId: USER_ID,
    displayName: 'A',
    month,
    day,
  };
}

function stubIvrmApi(
  settings: Record<string, unknown>,
  recipientsByDate: Record<string, Array<Record<string, unknown>>> = {
    [TODAY]: [recipientFor(TODAY)],
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
        recipients: recipientsByDate[request.localDate as string] ?? [],
      });
    }),
  );
}

function stubIvrmApiDisabled() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(init.body as string) as Record<string, unknown>;
      return Response.json({
        schemaVersion: 2,
        requestId: request.requestId,
        action: 'today',
        status: 'ok',
        enabled: false,
        settings: null,
        recipients: [],
      });
    }),
  );
}

function stubIvrmApiFailure() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
    ),
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

describe('runManualBirthdayDelivery (#1062)', () => {
  it('対象者へロールとカードを配信し、celebrationも記録する', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings());

    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );

    expect(result).toEqual({
      status: 'ok',
      reason: null,
      deliveries: [
        { category: 'role_assign', outcome: 'delivered', reason: null },
        { category: 'card', outcome: 'delivered', reason: null },
      ],
    });
    expect(harness.roleAdds).toEqual([{ userId: USER_ID, roleId: ROLE_ID }]);
    expect(harness.sends).toHaveLength(1);
    expect(harness.celebrations).toHaveLength(1);
    expect(harness.deliveries.filter((entry) => entry.status === 'completed')).toHaveLength(2);
  });

  it('再実行は冪等キーにより already_delivered になり二重配信しない', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings());
    const context = harness.contextFor({ useIvrmApiSource: true });
    const input = { discordUserId: USER_ID, localDate: TODAY };

    await runManualBirthdayDelivery(context, input, NOW);
    const second = await runManualBirthdayDelivery(context, input, NOW);

    expect(second.deliveries).toEqual([
      { category: 'role_assign', outcome: 'already_delivered', reason: null },
      { category: 'card', outcome: 'already_delivered', reason: null },
    ]);
    expect(harness.roleAdds).toHaveLength(1);
    expect(harness.sends).toHaveLength(1);
  });

  it('失敗したkindだけが再実行で修復される（部分失敗の回復）', async () => {
    const harness = createHarness();
    harness.seedDelivery(`role-assigned:${ROLE_ID}`, 'completed');
    harness.seedDelivery('announcement', 'failed');
    stubIvrmApi(apiSettings());

    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );

    expect(result.deliveries).toEqual([
      { category: 'role_assign', outcome: 'already_delivered', reason: null },
      { category: 'card', outcome: 'delivered', reason: null },
    ]);
    expect(harness.roleAdds).toEqual([]);
    expect(harness.sends).toHaveLength(1);
  });

  it('他の実行がclaim中のkindは in_progress を返す', async () => {
    const harness = createHarness();
    harness.seedDelivery(`role-assigned:${ROLE_ID}`, 'processing');
    harness.seedDelivery('announcement', 'processing');
    stubIvrmApi(apiSettings());

    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );

    expect(result.deliveries).toEqual([
      { category: 'role_assign', outcome: 'in_progress', reason: null },
      { category: 'card', outcome: 'in_progress', reason: null },
    ]);
    expect(harness.roleAdds).toEqual([]);
    expect(harness.sends).toEqual([]);
  });

  it('配信時刻ゲートは手動実行には適用されない', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings({ deliveryTime: '23:59' }));

    // 2026-11-22 08:30 JST（配信時刻 23:59 より前）
    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      new Date('2026-11-21T23:30:00.000Z'),
    );

    expect(result.status).toBe('ok');
    expect(harness.roleAdds).toHaveLength(1);
    expect(harness.sends).toHaveLength(1);
  });

  it('過去7日ちょうどの日付は配信でき、8日前と未来日は date_out_of_range で拒否する', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings(), {
      [TODAY]: [recipientFor(TODAY)],
      '2026-11-15': [recipientFor('2026-11-15')],
    });
    const context = harness.contextFor({ useIvrmApiSource: true });

    const sevenDaysAgo = await runManualBirthdayDelivery(
      context,
      { discordUserId: USER_ID, localDate: '2026-11-15' },
      NOW,
    );
    expect(sevenDaysAgo.status).toBe('ok');

    const eightDaysAgo = await runManualBirthdayDelivery(
      context,
      { discordUserId: USER_ID, localDate: '2026-11-14' },
      NOW,
    );
    expect(eightDaysAgo).toEqual({
      status: 'rejected',
      reason: 'date_out_of_range',
      deliveries: [],
    });

    const future = await runManualBirthdayDelivery(
      context,
      { discordUserId: USER_ID, localDate: '2026-11-23' },
      NOW,
    );
    expect(future).toEqual({ status: 'rejected', reason: 'date_out_of_range', deliveries: [] });

    const malformed = await runManualBirthdayDelivery(
      context,
      { discordUserId: USER_ID, localDate: '2026-02-30' },
      NOW,
    );
    expect(malformed).toEqual({ status: 'rejected', reason: 'date_out_of_range', deliveries: [] });
  });

  it('プラグイン無効・連携OFFは理由コードで拒否する', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings());

    const disabled = await runManualBirthdayDelivery(
      harness.contextFor({ enabled: false, useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );
    expect(disabled).toEqual({ status: 'rejected', reason: 'plugin_not_enabled', deliveries: [] });

    const legacyOnly = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: false }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );
    expect(legacyOnly).toEqual({
      status: 'rejected',
      reason: 'ivrm_source_disabled',
      deliveries: [],
    });
  });

  it('供給APIの状態を理由コードへ写像する', async () => {
    const harness = createHarness();
    const context = harness.contextFor({ useIvrmApiSource: true });
    const input = { discordUserId: USER_ID, localDate: TODAY };

    stubIvrmApiFailure();
    expect(await runManualBirthdayDelivery(context, input, NOW)).toEqual({
      status: 'rejected',
      reason: 'supply_unavailable',
      deliveries: [],
    });

    stubIvrmApiDisabled();
    expect(await runManualBirthdayDelivery(context, input, NOW)).toEqual({
      status: 'rejected',
      reason: 'delivery_disabled',
      deliveries: [],
    });

    stubIvrmApi(apiSettings(), { [TODAY]: [] });
    expect(await runManualBirthdayDelivery(context, input, NOW)).toEqual({
      status: 'rejected',
      reason: 'not_a_recipient',
      deliveries: [],
    });
  });

  it('ロールを編集できない場合は role_not_editable を返し、カードは配信する', async () => {
    const harness = createHarness({ roleEditable: false });
    stubIvrmApi(apiSettings());

    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );

    expect(result.deliveries).toEqual([
      { category: 'role_assign', outcome: 'failed', reason: 'role_not_editable' },
      { category: 'card', outcome: 'delivered', reason: null },
    ]);
    expect(harness.sends).toHaveLength(1);
  });

  it('チャンネルへ到達できない場合は channel_unavailable を返し、ロールは付与する', async () => {
    const harness = createHarness({ channelAvailable: false });
    stubIvrmApi(apiSettings());

    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );

    expect(result.deliveries).toEqual([
      { category: 'role_assign', outcome: 'delivered', reason: null },
      { category: 'card', outcome: 'failed', reason: 'channel_unavailable' },
    ]);
    expect(harness.roleAdds).toHaveLength(1);
  });

  it('メンバーがGuildにいない場合は member_not_in_guild を返し、カードは配信する', async () => {
    const harness = createHarness({ missingMembers: new Set([USER_ID]) });
    stubIvrmApi(apiSettings());

    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );

    expect(result.deliveries).toEqual([
      { category: 'role_assign', outcome: 'failed', reason: 'member_not_in_guild' },
      { category: 'card', outcome: 'delivered', reason: null },
    ]);
    expect(harness.sends).toHaveLength(1);
  });

  it('プラグイン側トグルがOFFのkindは not_configured になる', async () => {
    const harness = createHarness();
    stubIvrmApi(apiSettings());

    const result = await runManualBirthdayDelivery(
      harness.contextFor({ useIvrmApiSource: true, assignRole: false, sendAnnouncement: false }),
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );

    expect(result).toEqual({
      status: 'ok',
      reason: null,
      deliveries: [
        { category: 'role_assign', outcome: 'not_configured', reason: null },
        { category: 'card', outcome: 'not_configured', reason: null },
      ],
    });
    expect(harness.roleAdds).toEqual([]);
    expect(harness.sends).toEqual([]);
  });
});

describe('isManualBirthdayDeliveryDateInRange', () => {
  it('JST当日を基準に過去7日までを許可する', () => {
    // 2026-11-22 00:30 JST
    const now = new Date('2026-11-21T15:30:00.000Z');
    expect(isManualBirthdayDeliveryDateInRange('2026-11-22', now)).toBe(true);
    expect(isManualBirthdayDeliveryDateInRange('2026-11-15', now)).toBe(true);
    expect(isManualBirthdayDeliveryDateInRange('2026-11-14', now)).toBe(false);
    expect(isManualBirthdayDeliveryDateInRange('2026-11-23', now)).toBe(false);
    expect(isManualBirthdayDeliveryDateInRange('not-a-date', now)).toBe(false);
  });
});

describe('runManualBirthdayDeliveryForGuild', () => {
  it('有効化されていないGuildは plugin_not_enabled を返す', async () => {
    const result = await runManualBirthdayDeliveryForGuild(
      '999999999999999999',
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );
    expect(result).toEqual({ status: 'rejected', reason: 'plugin_not_enabled', deliveries: [] });
  });

  it('onEnableで登録したcontextへ委譲し、onDisableで解除する', async () => {
    const harness = createHarness();
    const context = harness.contextFor({ enabled: false, useIvrmApiSource: true });
    await birthdayRolePlugin.onEnable?.(context as never);
    try {
      const result = await runManualBirthdayDeliveryForGuild(
        GUILD_ID,
        { discordUserId: USER_ID, localDate: TODAY },
        NOW,
      );
      // 登録済みcontextの config.enabled=false が理由になる
      expect(result).toEqual({
        status: 'rejected',
        reason: 'plugin_not_enabled',
        deliveries: [],
      });
    } finally {
      await birthdayRolePlugin.onDisable?.(context as never);
    }
    const afterDisable = await runManualBirthdayDeliveryForGuild(
      GUILD_ID,
      { discordUserId: USER_ID, localDate: TODAY },
      NOW,
    );
    expect(afterDisable).toEqual({
      status: 'rejected',
      reason: 'plugin_not_enabled',
      deliveries: [],
    });
  });
});
