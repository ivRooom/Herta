import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildQuestBoardRequest,
  callIvrmQuestBoard,
  resolveQuestBoardConfig,
  QUEST_BOARD_PATH,
  QUEST_BOARD_PURPOSE,
  type QuestBoardStatus,
} from './quest-board-ivrm.js';

const config = {
  apiBaseUrl: 'https://api.ivrm.jp',
  secret: '<fixture-secret>',
  guildId: '123456789012345678',
};
const guild = '123456789012345678';
const user = '223456789012345678';

afterEach(() => vi.unstubAllGlobals());

const boardFixture: QuestBoardStatus = {
  periods: [
    {
      periodType: 'daily',
      periodKey: '2026-11-20',
      startSlotDate: '2026-11-20',
      endSlotDate: '2026-11-20',
      endsAt: '2026-11-21T00:00:00.000Z',
      allClearPoints: 1,
      quests: [
        {
          key: 'daily-msg-5',
          title: '発言',
          description: '',
          category: 'Discord',
          signalKey: 'xp_source:herta:herta:msg:',
          threshold: 5,
          unit: '回',
          xpReward: 20,
          prerequisiteQuestKey: null,
          prerequisiteTitle: null,
          locked: false,
          progress: 3,
          completed: false,
          recorded: false,
        },
        {
          key: 'daily-quiz-answer',
          title: 'クイズ回答',
          description: '',
          category: 'デイリークイズ',
          signalKey: 'quiz_answer',
          threshold: 1,
          unit: '回',
          xpReward: 15,
          prerequisiteQuestKey: null,
          prerequisiteTitle: null,
          locked: false,
          progress: 1,
          completed: true,
          recorded: true,
        },
      ],
      completedCount: 1,
      allClear: false,
    },
    {
      periodType: 'weekly',
      periodKey: '2026-W47',
      startSlotDate: '2026-11-16',
      endSlotDate: '2026-11-22',
      endsAt: '2026-11-23T00:00:00.000Z',
      allClearPoints: 5,
      quests: [],
      completedCount: 0,
      allClear: false,
    },
    {
      periodType: 'monthly',
      periodKey: '2026-11',
      startSlotDate: '2026-11-01',
      endSlotDate: '2026-11-30',
      endsAt: '2026-12-01T00:00:00.000Z',
      allClearPoints: 10,
      quests: [],
      completedCount: 0,
      allClear: false,
    },
  ],
  totalCompletions: 1,
  completionsByPeriod: { daily: 1, weekly: 0, monthly: 0 },
  history: [
    {
      questKey: 'daily-quiz-answer',
      title: 'クイズ回答',
      category: 'デイリークイズ',
      unit: '回',
      period: 'daily',
      periodKey: '2026-11-20',
      progressSnapshot: 1,
      signalKey: 'quiz_answer',
      xpReward: 15,
      completedAt: '2026-11-20T01:05:00.000Z',
    },
  ],
};

function mockJson(payload: unknown, status = 200) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as Record<string, unknown>;
    return Response.json(
      status === 200
        ? {
            schemaVersion: 1,
            requestId: request.requestId,
            discordUserId: user,
            action: request.action,
            ...(payload as Record<string, unknown>),
          }
        : payload,
      { status },
    );
  });
}

describe('private ivrm-web quest board client', () => {
  it('restricts base URLs and configuration', () => {
    for (const value of [
      'http://api.ivrm.jp',
      'https://user:pass@api.ivrm.jp',
      'https://api.ivrm.jp/?secret=<redacted>',
      'https://api.ivrm.jp/foo',
    ])
      expect(
        resolveQuestBoardConfig({
          IVRM_WEB_API_BASE_URL: value,
          HERTA_MBTI_SYNC_SECRET: '<fixture-secret>',
          IVRM_INTEGRATION_GUILD_ID: guild,
        }),
      ).toBeNull();
    expect(
      resolveQuestBoardConfig({
        IVRM_WEB_API_BASE_URL: config.apiBaseUrl,
        HERTA_MBTI_SYNC_SECRET: '<fixture-secret>',
        IVRM_INTEGRATION_GUILD_ID: guild,
      }),
    ).toEqual(config);
    expect(
      resolveQuestBoardConfig({
        IVRM_WEB_API_BASE_URL: config.apiBaseUrl,
        HERTA_MBTI_SYNC_SECRET: '<fixture-secret>',
      }),
    ).toBeNull();
  });

  it('never sends other guild member IDs', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await callIvrmQuestBoard('323456789012345678', user, config)).toEqual({
      status: 'ineligible-guild',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await callIvrmQuestBoard(guild, user, null)).toEqual({ status: 'unconfigured' });
  });

  it('signs the status request with the quest-board purpose and exact body keys', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const stamp = '2026-11-20T00:00:00.000Z';
    const request = buildQuestBoardRequest(config, guild, user, id, stamp);
    expect(request.url).toBe(config.apiBaseUrl + QUEST_BOARD_PATH);
    const body = JSON.parse(request.init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['action', 'discordUserId', 'guildId', 'requestId', 'schemaVersion'].sort(),
    );
    expect(body).toMatchObject({ schemaVersion: 1, action: 'status', guildId: guild });
    const key = createHmac('sha256', config.secret).update(QUEST_BOARD_PURPOSE).digest();
    const expected = createHmac('sha256', key)
      .update(['POST', QUEST_BOARD_PATH, stamp, id, request.init.body].join('\n'))
      .digest('hex');
    expect(request.init.headers['X-IVRM-Signature']).toBe(expected);
    expect(request.init.headers['X-IVRM-Timestamp']).toBe(stamp);
    expect(request.init.headers['X-IVRM-Event-Id']).toBe(id);
    // A signature minted for the game-accounts purpose must not match.
    const otherKey = createHmac('sha256', config.secret).update('herta-game-accounts-v2').digest();
    const other = createHmac('sha256', otherKey)
      .update(['POST', QUEST_BOARD_PATH, stamp, id, request.init.body].join('\n'))
      .digest('hex');
    expect(request.init.headers['X-IVRM-Signature']).not.toBe(other);
  });

  it('parses the board on an ok status response', async () => {
    vi.stubGlobal('fetch', mockJson({ status: 'ok', board: boardFixture }));
    const result = await callIvrmQuestBoard(guild, user, config);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.board.periods).toHaveLength(3);
    const daily = result.board.periods.find((period) => period.periodType === 'daily');
    expect(daily?.completedCount).toBe(1);
    expect(daily?.quests[0]?.progress).toBe(3);
    expect(result.board.totalCompletions).toBe(1);
    expect(result.board.history[0]?.questKey).toBe('daily-quiz-answer');
  });

  it('maps the API failure states the bot branches on', async () => {
    vi.stubGlobal('fetch', mockJson({ status: 'not_linked', error: 'member_not_linked' }, 404));
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'not-linked' });

    vi.stubGlobal(
      'fetch',
      mockJson({ status: 'error', error: 'identity_or_baseline_unresolved' }, 409),
    );
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'duplicate' });

    vi.stubGlobal('fetch', mockJson({ status: 'disabled', error: 'quest_board_disabled' }, 503));
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'disabled' });

    vi.stubGlobal('fetch', mockJson({ status: 'error', error: 'quest_board_unavailable' }, 503));
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'unavailable' });

    vi.stubGlobal('fetch', mockJson({ status: 'error', error: 'guild_not_allowed' }, 403));
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({
      status: 'ineligible-guild',
    });

    vi.stubGlobal('fetch', mockJson({ status: 'error', error: 'quest_board_upstream_error' }, 502));
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'unavailable' });
  });

  it('fails closed on malformed or mismatched success bodies', async () => {
    // Echo mismatch: another member's response must never be rendered.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const request = JSON.parse(init.body as string) as Record<string, unknown>;
        return Response.json({
          schemaVersion: 1,
          requestId: request.requestId,
          discordUserId: '323456789012345678',
          action: 'status',
          status: 'ok',
          board: boardFixture,
        });
      }),
    );
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'unavailable' });

    // A period missing from the board is an upstream malfunction.
    const broken = {
      ...boardFixture,
      periods: boardFixture.periods.filter((period) => period.periodType !== 'monthly'),
    };
    vi.stubGlobal('fetch', mockJson({ status: 'ok', board: broken }));
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'unavailable' });

    // A quest with a non-numeric progress is an upstream malfunction.
    const badQuest = {
      ...boardFixture,
      periods: boardFixture.periods.map((period) =>
        period.periodType === 'daily'
          ? {
              ...period,
              quests: period.quests.map((quest, index) =>
                index === 0 ? { ...quest, progress: '3' } : quest,
              ),
            }
          : period,
      ),
    };
    vi.stubGlobal('fetch', mockJson({ status: 'ok', board: badQuest }));
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'unavailable' });
  });

  it('treats a network failure as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await callIvrmQuestBoard(guild, user, config)).toEqual({ status: 'unavailable' });
  });
});
