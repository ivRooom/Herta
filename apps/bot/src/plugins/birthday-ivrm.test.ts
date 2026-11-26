import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBirthdayRequest,
  callIvrmBirthday,
  parseBirthdayDeliveryTime,
  BIRTHDAY_PATH,
  BIRTHDAY_PURPOSE,
  type IvrmBirthdaySettings,
} from './birthday-ivrm.js';
import { QUEST_BOARD_PURPOSE } from './quest-board-ivrm.js';

const config = {
  apiBaseUrl: 'https://api.ivrm.jp',
  secret: '<fixture-secret>',
  guildId: '123456789012345678',
};
const guild = '123456789012345678';
const localDate = '2026-11-22';

afterEach(() => vi.unstubAllGlobals());

const settingsFixture: IvrmBirthdaySettings = {
  enabled: true,
  announcementChannelId: '123456789012345678',
  birthdayRoleId: '223456789012345678',
  announcementMessage: '🎂 {user} お誕生日おめでとう！',
  leapDayPolicy: 'february-28',
  pointsAmount: 300,
  deliveryTime: '09:00',
  card: {
    enabled: true,
    preset: 'herta-lavender-tea',
    backgroundUrl: null,
    showName: true,
    showAvatar: true,
    showBirthday: true,
  },
};

const recipientsFixture = [
  {
    memberId: 'member-a',
    discordUserId: '123456789012345678',
    displayName: 'A',
    month: 11,
    day: 22,
  },
  {
    memberId: 'member-b',
    discordUserId: '223456789012345678',
    displayName: 'B',
    month: 11,
    day: 22,
  },
];

function mockApi(payload: Record<string, unknown>, status = 200) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as Record<string, unknown>;
    return Response.json(
      status === 200
        ? {
            schemaVersion: 1,
            requestId: request.requestId,
            action: 'today',
            status: 'ok',
            ...payload,
          }
        : payload,
      { status },
    );
  });
}

describe('buildBirthdayRequest', () => {
  it('APIが許可するキーだけを送り、誕生日purposeで署名する', () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const timestamp = '2026-11-22T00:00:00.000Z';
    const request = buildBirthdayRequest(config, guild, localDate, requestId, timestamp);

    expect(request.url).toBe(`https://api.ivrm.jp${BIRTHDAY_PATH}`);
    const body = JSON.parse(request.init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['action', 'guildId', 'localDate', 'requestId', 'schemaVersion'].sort(),
    );
    expect(body).toMatchObject({
      schemaVersion: 1,
      guildId: guild,
      action: 'today',
      localDate,
    });

    const headers = request.init.headers as Record<string, string>;
    expect(headers['X-IVRM-Event-Id']).toBe(requestId);
    expect(headers['X-IVRM-Timestamp']).toBe(timestamp);
    const key = createHmac('sha256', config.secret).update(BIRTHDAY_PURPOSE).digest();
    const expected = createHmac('sha256', key)
      .update(['POST', BIRTHDAY_PATH, timestamp, requestId, request.init.body].join('\n'))
      .digest('hex');
    expect(headers['X-IVRM-Signature']).toBe(expected);

    // A signature minted for the quest-board purpose must differ:
    // the two integrations never accept each other's signatures.
    const questKey = createHmac('sha256', config.secret).update(QUEST_BOARD_PURPOSE).digest();
    const questSignature = createHmac('sha256', questKey)
      .update(['POST', BIRTHDAY_PATH, timestamp, requestId, request.init.body].join('\n'))
      .digest('hex');
    expect(headers['X-IVRM-Signature']).not.toBe(questSignature);
  });
});

describe('parseBirthdayDeliveryTime', () => {
  it('HH:mm形式だけを受理し、それ以外は既定09:00に解決する', () => {
    expect(parseBirthdayDeliveryTime('09:00')).toBe('09:00');
    expect(parseBirthdayDeliveryTime('18:30')).toBe('18:30');
    expect(parseBirthdayDeliveryTime('00:00')).toBe('00:00');
    expect(parseBirthdayDeliveryTime('23:59')).toBe('23:59');
    expect(parseBirthdayDeliveryTime(undefined)).toBe('09:00');
    expect(parseBirthdayDeliveryTime(null)).toBe('09:00');
    expect(parseBirthdayDeliveryTime('9:00')).toBe('09:00');
    expect(parseBirthdayDeliveryTime('24:00')).toBe('09:00');
    expect(parseBirthdayDeliveryTime('09:60')).toBe('09:00');
    expect(parseBirthdayDeliveryTime(900)).toBe('09:00');
  });
});

describe('callIvrmBirthday', () => {
  it('enabled=true の設定と当日対象者をそのまま返す', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: recipientsFixture,
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result).toEqual({
      status: 'ok',
      enabled: true,
      settings: settingsFixture,
      recipients: recipientsFixture,
    });
  });

  it('deliveryTimeを受理し、欠落・不正は既定09:00に解決する', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: { ...settingsFixture, deliveryTime: '18:30' },
        recipients: recipientsFixture,
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toMatchObject({
      status: 'ok',
      enabled: true,
      settings: { deliveryTime: '18:30' },
    });

    const settingsWithoutTime: Record<string, unknown> = { ...settingsFixture };
    delete settingsWithoutTime.deliveryTime;
    vi.stubGlobal(
      'fetch',
      mockApi({ enabled: true, settings: settingsWithoutTime, recipients: recipientsFixture }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toMatchObject({
      status: 'ok',
      enabled: true,
      settings: { deliveryTime: '09:00' },
    });

    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: { ...settingsFixture, deliveryTime: '25:00' },
        recipients: recipientsFixture,
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toMatchObject({
      status: 'ok',
      enabled: true,
      settings: { deliveryTime: '09:00' },
    });
  });

  it('enabled=false は尊重できる形（ok・recipients空）で返す', async () => {
    vi.stubGlobal('fetch', mockApi({ enabled: false, settings: null, recipients: [] }));
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result).toEqual({
      status: 'ok',
      enabled: false,
      settings: null,
      recipients: [],
    });
  });

  it('503 や通信失敗は unavailable（呼び出し側が従来経路へfallbackする）', async () => {
    vi.stubGlobal('fetch', mockApi({ status: 'error', error: 'birthday_unavailable' }, 503));
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('未設定・対象外guildはAPIを叩かずに返す', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(callIvrmBirthday(guild, localDate, null)).resolves.toEqual({
      status: 'unconfigured',
    });
    await expect(callIvrmBirthday('999999999999999999', localDate, config)).resolves.toEqual({
      status: 'ineligible-guild',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('対象者に生年・年齢が混入した応答は unavailable にする', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: [{ ...recipientsFixture[0], birthYear: 1990 }],
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('不正な月日・未知のプリセット・設定欠落は unavailable にする', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: [{ ...recipientsFixture[0], month: 13 }],
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });

    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: {
          ...settingsFixture,
          card: { ...settingsFixture.card, preset: 'unknown-preset' },
        },
        recipients: recipientsFixture,
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });

    vi.stubGlobal('fetch', mockApi({ enabled: true, settings: null, recipients: [] }));
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('requestId のエコーが一致しない応答は unavailable にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          requestId: 'someone-elses-request',
          action: 'today',
          status: 'ok',
          enabled: false,
          settings: null,
          recipients: [],
        }),
      ),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });
  });
});
