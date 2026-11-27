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
    showAge: false,
    presetDefinition: null,
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
            schemaVersion: 2,
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
      schemaVersion: 2,
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
  it('enabled=true の設定と当日対象者をそのまま返す（ageキーが無い対象者は age: null）', async () => {
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
      recipients: recipientsFixture.map((recipient) => ({
        ...recipient,
        age: null,
        cardPresetId: null,
      })),
      presetDefinitions: new Map(),
    });
  });

  it('showAge ON の設定と年齢（整数 / null）を受理する', async () => {
    const settings = {
      ...settingsFixture,
      card: { ...settingsFixture.card, showAge: true },
    };
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings,
        recipients: [
          { ...recipientsFixture[0], age: 25 },
          { ...recipientsFixture[1], age: null },
        ],
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result).toEqual({
      status: 'ok',
      enabled: true,
      settings,
      recipients: [
        { ...recipientsFixture[0], age: 25, cardPresetId: null },
        { ...recipientsFixture[1], age: null, cardPresetId: null },
      ],
      presetDefinitions: new Map(),
    });
  });

  it('card.presetDefinition があれば定義ごと受理する (#1028 R3-E)', async () => {
    const presetDefinition = {
      id: 'my-custom-preset',
      label: 'カスタムプリセット',
      backgroundUrl: 'https://media.example.com/birthday/bg.webp',
      textColor: '#ff0000',
      textStroke: '#0000ff',
    };
    const settings = {
      ...settingsFixture,
      card: { ...settingsFixture.card, presetDefinition },
    };
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings,
        recipients: recipientsFixture,
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result.status).toBe('ok');
    if (result.status === 'ok' && result.enabled) {
      expect(result.settings.card.presetDefinition).toEqual(presetDefinition);
    }
  });

  it('card.presetDefinition が不正なら定義だけを落として設定は受理する (#1028 R3-E)', async () => {
    for (const presetDefinition of [
      {
        id: 'my-custom-preset',
        label: 'カスタムプリセット',
        backgroundUrl: 'http://media.example.com/birthday/bg.webp',
        textColor: '#ff0000',
        textStroke: '#0000ff',
      },
      {
        id: 'my-custom-preset',
        label: 'カスタムプリセット',
        backgroundUrl: 'https://media.example.com/birthday/bg.webp',
        textColor: 'red',
        textStroke: '#0000ff',
      },
      'not-a-definition',
    ]) {
      const settings = {
        ...settingsFixture,
        card: { ...settingsFixture.card, presetDefinition },
      };
      vi.stubGlobal(
        'fetch',
        mockApi({
          enabled: true,
          settings,
          recipients: recipientsFixture,
        }),
      );
      const result = await callIvrmBirthday(guild, localDate, config);
      expect(result.status).toBe('ok');
      if (result.status === 'ok' && result.enabled) {
        expect(result.settings.card.presetDefinition).toBeNull();
        expect(result.settings.card.preset).toBe(settingsFixture.card.preset);
      }
    }
  });

  it('card.showAge キーが無い旧設定は showAge: false として受理する', async () => {
    const legacyCard: Record<string, unknown> = { ...settingsFixture.card };
    delete legacyCard.showAge;
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: { ...settingsFixture, card: legacyCard },
        recipients: recipientsFixture,
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result.status).toBe('ok');
    if (result.status === 'ok' && result.enabled) {
      expect(result.settings.card.showAge).toBe(false);
    }
  });

  it('v1形式の応答は unavailable にする（未着地の相手では従来経路へfallback）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const request = JSON.parse(init.body as string) as Record<string, unknown>;
        return Response.json({
          schemaVersion: 1,
          requestId: request.requestId,
          action: 'today',
          status: 'ok',
          enabled: true,
          settings: settingsFixture,
          recipients: recipientsFixture,
        });
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
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

  it('対象者に生年が混入した応答は unavailable にする（fail-closed）', async () => {
    for (const key of ['birthYear', 'birth_year', 'birthDate', 'dateOfBirth']) {
      vi.stubGlobal(
        'fetch',
        mockApi({
          enabled: true,
          settings: settingsFixture,
          recipients: [{ ...recipientsFixture[0], [key]: 1990 }],
        }),
      );
      await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
        status: 'unavailable',
      });
    }
  });

  it('対象者の年齢が整数でも null でもない応答は unavailable にする', async () => {
    for (const age of ['25', 25.5, -1, 151, true]) {
      vi.stubGlobal(
        'fetch',
        mockApi({
          enabled: true,
          settings: settingsFixture,
          recipients: [{ ...recipientsFixture[0], age }],
        }),
      );
      await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
        status: 'unavailable',
      });
    }
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

  it('メンバー個別プリセット（cardPresetId）と定義表を受理する (#1921 R3-H)', async () => {
    const definition = {
      id: 'member-red',
      label: 'メンバーの赤',
      backgroundUrl: 'https://cdn.example.invalid/member-red.png',
      textColor: '#ffffff',
      textStroke: '#34255e',
    };
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: [
          { ...recipientsFixture[0], cardPresetId: 'herta-lavender-tea' },
          { ...recipientsFixture[1], cardPresetId: 'member-red' },
        ],
        presetDefinitions: { 'member-red': definition },
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result).toEqual({
      status: 'ok',
      enabled: true,
      settings: settingsFixture,
      recipients: [
        { ...recipientsFixture[0], age: null, cardPresetId: 'herta-lavender-tea' },
        { ...recipientsFixture[1], age: null, cardPresetId: 'member-red' },
      ],
      presetDefinitions: new Map([['member-red', definition]]),
    });
  });

  it('cardPresetId が null の対象者は「指定なし」として受理する', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: [{ ...recipientsFixture[0], cardPresetId: null }],
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result.status).toBe('ok');
    if (result.status === 'ok' && result.enabled) {
      expect(result.recipients[0]?.cardPresetId).toBeNull();
    }
  });

  it('cardPresetId の形式が不正な応答は unavailable にする', async () => {
    for (const cardPresetId of ['Bad ID!', 'UPPER', '-leading-hyphen', '', 42, true]) {
      vi.stubGlobal(
        'fetch',
        mockApi({
          enabled: true,
          settings: settingsFixture,
          recipients: [{ ...recipientsFixture[0], cardPresetId }],
        }),
      );
      await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
        status: 'unavailable',
      });
    }
  });

  it('不正な定義はその id だけを落とし、他の定義と配信は受理する', async () => {
    const valid = {
      id: 'member-red',
      label: 'メンバーの赤',
      backgroundUrl: 'https://cdn.example.invalid/member-red.png',
      textColor: '#ffffff',
      textStroke: '#34255e',
    };
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: recipientsFixture,
        presetDefinitions: {
          'member-red': valid,
          // http の背景は定義として不正
          'member-http': {
            ...valid,
            id: 'member-http',
            backgroundUrl: 'http://example.invalid/x.png',
          },
          // テーブルのキーと定義の id が一致しない
          'member-mismatch': { ...valid, id: 'member-other' },
        },
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result.status).toBe('ok');
    if (result.status === 'ok' && result.enabled) {
      expect(result.presetDefinitions).toEqual(new Map([['member-red', valid]]));
    }
  });

  it('定義表のキーは Map で保持し、__proto__ を混ぜても汚染しない', async () => {
    const valid = {
      id: 'member-red',
      label: 'メンバーの赤',
      backgroundUrl: 'https://cdn.example.invalid/member-red.png',
      textColor: '#ffffff',
      textStroke: '#34255e',
    };
    // JSON 経由なら __proto__ も own property として届く。slug として
    // 不正なので定義ごと落ち、Object.prototype へは何も書かれない。
    const presetDefinitions = JSON.parse(
      JSON.stringify({
        'member-red': valid,
        constructor: { ...valid, id: 'constructor' },
        ['__proto__']: { ...valid, id: '__proto__' },
      }),
    ) as Record<string, unknown>;
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: recipientsFixture,
        presetDefinitions,
      }),
    );
    const result = await callIvrmBirthday(guild, localDate, config);
    expect(result.status).toBe('ok');
    if (result.status === 'ok' && result.enabled) {
      expect(result.presetDefinitions).toBeInstanceOf(Map);
      expect(result.presetDefinitions.get('member-red')).toEqual(valid);
      // 'constructor' は正規の slug なので Map のキーとして保持される
      expect(result.presetDefinitions.get('constructor')).toEqual({
        ...valid,
        id: 'constructor',
      });
      expect(result.presetDefinitions.has('__proto__')).toBe(false);
    }
    expect((Object.prototype as Record<string, unknown>)['member-red']).toBeUndefined();
  });

  it('定義表がオブジェクトでない応答は unavailable にする', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: recipientsFixture,
        presetDefinitions: ['member-red'],
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('cardPresetId が付いていても生年キーが混入した応答は unavailable にする', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        enabled: true,
        settings: settingsFixture,
        recipients: [{ ...recipientsFixture[0], cardPresetId: 'member-red', birthYear: 1990 }],
        presetDefinitions: {},
      }),
    );
    await expect(callIvrmBirthday(guild, localDate, config)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('requestId のエコーが一致しない応答は unavailable にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          schemaVersion: 2,
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
