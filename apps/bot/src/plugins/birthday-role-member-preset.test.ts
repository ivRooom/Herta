import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBirthdayRoleCycle } from './birthday-role.js';

// Cycle-level tests for per-recipient card presets (#1921
// R3-H). The ivrm path must render each member's card with
// their own preset pick — a database definition (background +
// text colors) or a bundled preset — ahead of the global
// backgroundUrl and the global preset, while members without a
// resolvable pick keep the global rendering exactly. Prisma is
// faked in memory by dispatching on the raw SQL text of
// birthday-role-repository.ts; Discord is faked with recording
// members/channels, and the rendered PNGs are checked by
// sampling the background corner pixel of each sent card.

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '123456789012345678';
const ROLE_ID = '223456789012345678';
const DB_USER = '100000000000000001';
const GLOBAL_USER = '100000000000000002';
const BUILTIN_USER = '100000000000000003';
const STALE_USER = '100000000000000004';

const RED_BG_URL = 'https://cdn.example.invalid/member-red.png';
const BLUE_BG_URL = 'https://cdn.example.invalid/global-blue.png';
const RED = { r: 200, g: 30, b: 30 };
const BLUE = { r: 30, g: 30, b: 200 };

// 64x64 solid-color PNG fixtures (generated with sharp).
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAnklEQVRoge2SUQkAQBSDlsT+URbrQtyHPBgYwMlSOE10g24AesXuQtwlukE3AL1idyHuEt2gG4BesbsQd4lu0A1Ar9hdiLtEN+gGoFfsLsRdoht0A9ArdhfiLtENugHoFbsLcZfoBt0A9IrdhbhLdINuAHrF7kLcJbpBNwC9Ynch7hLdoBuAXrG7EHeJbtANQK/YXYi7RDfoBqBX/OEByqdA8W9OK+0AAAAASUVORK5CYII=',
  'base64',
);
const BLUE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAnklEQVRoge2SUQkAQBSDlsT+URbrQtyHPBgYwMkCPU10AzagekV2od4lugEbUL0iu1DvEt2ADahekV2od4luwAZUr8gu1LtEN2ADqldkF+pdohuwAdUrsgv1LtEN2IDqFdmFepfoBmxA9YrsQr1LdAM2oHpFdqHeJboBG1C9IrtQ7xLdgA2oXpFdqHeJbsAGVK/ILtS7RDdgA6pX/OEBiWxA8dy8e+MAAAAASUVORK5CYII=',
  'base64',
);

const CYCLE_NOW = new Date('2026-11-22T01:00:00.000Z'); // 10:00 JST

interface FakeDelivery {
  id: string;
  guildId: string;
  userId: string;
  localDate: string;
  kind: string;
  idempotencyKey: string;
  status: string;
  reconciledAt: Date | null;
}

interface SentMessage {
  content: string;
  files?: Array<{ attachment: Buffer; name: string }>;
}

function createHarness() {
  const deliveries: FakeDelivery[] = [];
  const roleAdds: Array<{ userId: string; roleId: string }> = [];
  const sends: SentMessage[] = [];
  const membersWithRole = new Set<string>();

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
        const delivery = deliveries.find((entry) => entry.id === values[0]);
        if (delivery && (delivery.status === 'pending' || delivery.status === 'failed')) {
          delivery.status = 'processing';
          return [{ id: delivery.id }];
        }
        return [];
      }
      if (sql.includes('FROM "birthday_registrations"')) return [];
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
      if (sql.includes('INSERT INTO "birthday_celebrations"')) return 1;
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
        if (delivery) delivery.status = 'completed';
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
      fetch: async (userId: string) => memberFor(userId),
    },
    roles: {
      fetch: async (roleId: string) => ({ id: roleId, managed: false, editable: true }),
    },
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (options: SentMessage) => {
          sends.push(options);
          return { id: 'message-1' };
        },
      }),
    },
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const contextFor = (config: Record<string, unknown>) =>
    ({
      guildId: GUILD_ID,
      config,
      prisma,
      client: { guilds: { fetch: async () => guild } },
      logger,
    }) as unknown as Parameters<typeof runBirthdayRoleCycle>[0];

  return { contextFor, roleAdds, sends };
}

function apiSettings(cardOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    announcementChannelId: CHANNEL_ID,
    birthdayRoleId: ROLE_ID,
    announcementMessage: '🎂 {user} お誕生日おめでとう！',
    leapDayPolicy: 'february-28',
    pointsAmount: 300,
    card: {
      enabled: true,
      preset: 'herta-night-board',
      backgroundUrl: BLUE_BG_URL,
      showName: true,
      showAvatar: true,
      showBirthday: true,
      showAge: false,
      ...cardOverrides,
    },
  };
}

function stubNetwork(supply: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      let isApiRequest = false;
      try {
        isApiRequest = new URL(href).origin === 'https://api.ivrm.jp';
      } catch {
        isApiRequest = false;
      }
      if (isApiRequest) {
        const request = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
        return Response.json({
          schemaVersion: 2,
          requestId: request.requestId,
          action: 'today',
          status: 'ok',
          ...supply,
        });
      }
      if (href === RED_BG_URL) return pngResponse(RED_PNG);
      if (href === BLUE_BG_URL) return pngResponse(BLUE_PNG);
      throw new Error(`unexpected fetch: ${href}`);
    }),
  );
}

function pngResponse(bytes: Buffer): Response {
  return new Response(bytes, {
    headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
  });
}

async function cornerPixel(png: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(png)
    .extract({ left: 4, top: 4, width: 16, height: 16 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = info.width * info.height;
  for (let index = 0; index < data.length; index += info.channels) {
    r += data[index]!;
    g += data[index + 1]!;
    b += data[index + 2]!;
  }
  return { r: Math.round(r / pixels), g: Math.round(g / pixels), b: Math.round(b / pixels) };
}

function expectColorClose(
  actual: { r: number; g: number; b: number },
  expected: { r: number; g: number; b: number },
) {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(24);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(24);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(24);
}

async function presetCorner(assetFile: string): Promise<{ r: number; g: number; b: number }> {
  const asset = await readFile(
    new URL(`../../assets/birthday-card-presets/${assetFile}`, import.meta.url),
  );
  const composed = await sharp(asset)
    .resize(1672, 941, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  return cornerPixel(composed);
}

function cardOf(sends: SentMessage[], userId: string): Buffer {
  const send = sends.find((entry) => entry.files?.[0]?.name === `birthday-${userId}.png`);
  expect(send?.files?.[0]?.attachment).toBeInstanceOf(Buffer);
  return send!.files![0]!.attachment;
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

describe('runBirthdayRoleCycle のメンバー個別プリセット描画 (#1921 R3-H)', () => {
  it('個別プリセット（DB定義・組み込み）が全体 backgroundUrl より優先され、未設定・解決不能は全体解決のまま', async () => {
    const harness = createHarness();
    stubNetwork({
      enabled: true,
      settings: apiSettings(),
      recipients: [
        {
          memberId: 'm-db',
          discordUserId: DB_USER,
          displayName: 'DB',
          month: 11,
          day: 22,
          cardPresetId: 'member-red',
        },
        {
          memberId: 'm-global',
          discordUserId: GLOBAL_USER,
          displayName: 'Global',
          month: 11,
          day: 22,
        },
        {
          memberId: 'm-builtin',
          discordUserId: BUILTIN_USER,
          displayName: 'Builtin',
          month: 11,
          day: 22,
          cardPresetId: 'herta-lavender-tea',
        },
        {
          memberId: 'm-stale',
          discordUserId: STALE_USER,
          displayName: 'Stale',
          month: 11,
          day: 22,
          cardPresetId: 'deleted-preset',
        },
      ],
      presetDefinitions: {
        'member-red': {
          id: 'member-red',
          label: 'メンバーの赤',
          backgroundUrl: RED_BG_URL,
          textColor: '#ffffff',
          textStroke: '#000000',
        },
      },
    });

    await runBirthdayRoleCycle(harness.contextFor({ useIvrmApiSource: true }), CYCLE_NOW);

    // 全員へ配信され、ロールも付与される（プリセット解決で配信は止まらない）
    expect(harness.sends).toHaveLength(4);
    expect(harness.roleAdds).toHaveLength(4);

    // DB 定義を選んだメンバーは定義の背景で描かれる
    expectColorClose(await cornerPixel(cardOf(harness.sends, DB_USER)), RED);
    // 未設定のメンバーは全体 backgroundUrl の背景で描かれる
    expectColorClose(await cornerPixel(cardOf(harness.sends, GLOBAL_USER)), BLUE);
    // 組み込みを選んだメンバーはそのプリセット資産で描かれ、全体背景は被らない
    const builtinCorner = await cornerPixel(cardOf(harness.sends, BUILTIN_USER));
    expectColorClose(builtinCorner, await presetCorner('herta-lavender-tea.webp'));
    expect(Math.abs(builtinCorner.b - BLUE.b)).toBeGreaterThan(24);
    // 解決できない id のメンバーは未設定として全体解決で描かれる
    expectColorClose(await cornerPixel(cardOf(harness.sends, STALE_USER)), BLUE);
  });

  it('全体 backgroundUrl が無い場合も、DB 定義のメンバーは定義で・未設定は全体プリセットで描かれる', async () => {
    const harness = createHarness();
    stubNetwork({
      enabled: true,
      settings: apiSettings({ backgroundUrl: null }),
      recipients: [
        {
          memberId: 'm-db',
          discordUserId: DB_USER,
          displayName: 'DB',
          month: 11,
          day: 22,
          cardPresetId: 'member-red',
        },
        {
          memberId: 'm-global',
          discordUserId: GLOBAL_USER,
          displayName: 'Global',
          month: 11,
          day: 22,
        },
      ],
      presetDefinitions: {
        'member-red': {
          id: 'member-red',
          label: 'メンバーの赤',
          backgroundUrl: RED_BG_URL,
          textColor: '#ffffff',
          textStroke: '#000000',
        },
      },
    });

    await runBirthdayRoleCycle(harness.contextFor({ useIvrmApiSource: true }), CYCLE_NOW);

    expect(harness.sends).toHaveLength(2);
    expectColorClose(await cornerPixel(cardOf(harness.sends, DB_USER)), RED);
    expectColorClose(
      await cornerPixel(cardOf(harness.sends, GLOBAL_USER)),
      await presetCorner('herta-night-board.webp'),
    );
  });
});
