import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { questBoardManifest } from '@herta/plugin-catalog';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import { handleQuestBoardPeriodSelect, questBoardPlugin } from './quest-board.js';
import type { IvrmQuestBoardResult, QuestBoardStatus } from './quest-board-ivrm.js';

const guild = '123456789012345678';
const user = '223456789012345678';

type Context = PluginRuntimeContext<{ enabled: boolean }, unknown, PrismaClient>;
type Api = Parameters<typeof handleQuestBoardPeriodSelect>[2];

function makeContext(enabled = true): Context {
  return {
    client: undefined,
    prisma: undefined,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    guildId: guild,
    config: { enabled },
    manifest: questBoardManifest,
  } as unknown as Context;
}

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
      ],
      completedCount: 0,
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
  totalCompletions: 3,
  completionsByPeriod: { daily: 1, weekly: 1, monthly: 1 },
  history: [],
};

const okResult: IvrmQuestBoardResult = { status: 'ok', board: boardFixture };

interface FakeSelectInteraction {
  calls: Array<{ method: string; options?: Record<string, unknown> }>;
  interaction: {
    guildId: string | null;
    user: { id: string };
    customId?: string;
    values?: string[];
    isStringSelectMenu(): boolean;
    reply(options: { content: string; flags: number }): Promise<unknown>;
    deferUpdate(): Promise<unknown>;
    followUp(options: { content: string; flags: number }): Promise<unknown>;
    editReply(options: { embeds?: unknown; components?: unknown }): Promise<unknown>;
  };
}

function makeSelectInteraction(
  userId: string,
  values: string[],
  timeline: string[],
): FakeSelectInteraction {
  const calls: FakeSelectInteraction['calls'] = [];
  const interaction: FakeSelectInteraction['interaction'] = {
    guildId: guild,
    user: { id: userId },
    customId: `quest-board:period:${user}`,
    values,
    isStringSelectMenu: () => true,
    async reply(options) {
      timeline.push('reply');
      calls.push({ method: 'reply', options });
    },
    async deferUpdate() {
      timeline.push('deferUpdate');
      calls.push({ method: 'deferUpdate' });
    },
    async followUp(options) {
      timeline.push('followUp');
      calls.push({ method: 'followUp', options });
    },
    async editReply(options) {
      timeline.push('editReply');
      calls.push({ method: 'editReply', options });
    },
  };
  return { calls, interaction };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('quest board period select', () => {
  it('defers before the API call and switches the view via editReply', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => {
      timeline.push('api');
      return okResult;
    }) as unknown as Api;
    const { calls, interaction } = makeSelectInteraction(user, ['weekly'], timeline);

    await handleQuestBoardPeriodSelect(makeContext(), interaction, api);

    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(guild, user);
    expect(timeline).toEqual(['deferUpdate', 'api', 'editReply']);
    const result = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(result?.options?.embeds)).toContain('ウィークリー');
    expect(JSON.stringify(result?.options?.components)).toContain(`quest-board:period:${user}`);
  });

  it('rejects presses from anyone but the command owner', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => okResult) as unknown as Api;
    const { calls, interaction } = makeSelectInteraction(
      '323456789012345678',
      ['weekly'],
      timeline,
    );

    await handleQuestBoardPeriodSelect(makeContext(), interaction, api);

    expect(api).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('reply');
    expect(calls[0]?.options?.content).toContain('本人だけが使えます');
    expect(calls[0]?.options?.flags).toBe(MessageFlags.Ephemeral);
  });

  it('rejects a second press while a switch is in flight', async () => {
    const timeline: string[] = [];
    const apiStarted = deferred<void>();
    const apiGate = deferred<IvrmQuestBoardResult>();
    const api = vi.fn(async () => {
      apiStarted.resolve();
      return apiGate.promise;
    }) as unknown as Api;
    const first = makeSelectInteraction(user, ['weekly'], timeline);
    const second = makeSelectInteraction(user, ['monthly'], timeline);

    const firstPromise = handleQuestBoardPeriodSelect(makeContext(), first.interaction, api);
    await apiStarted.promise;
    await handleQuestBoardPeriodSelect(makeContext(), second.interaction, api);

    expect(api).toHaveBeenCalledTimes(1);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.method).toBe('reply');
    expect(second.calls[0]?.options?.content).toContain('切り替え中です');

    apiGate.resolve(okResult);
    await firstPromise;
  });

  it('leaves the message untouched and tells only the presser on an API failure', async () => {
    const timeline: string[] = [];
    const api = vi.fn(
      async () => ({ status: 'not-linked' }) as IvrmQuestBoardResult,
    ) as unknown as Api;
    const { calls, interaction } = makeSelectInteraction(user, ['weekly'], timeline);

    await handleQuestBoardPeriodSelect(makeContext(), interaction, api);

    expect(calls.some((call) => call.method === 'editReply')).toBe(false);
    const followUp = calls.find((call) => call.method === 'followUp');
    expect(followUp?.options?.content).toContain('会員連携が見つかりません');
    expect(followUp?.options?.flags).toBe(MessageFlags.Ephemeral);
  });

  it('ignores disabled plugins, invalid values and foreign interactions', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => okResult) as unknown as Api;

    const disabled = makeSelectInteraction(user, ['weekly'], timeline);
    await handleQuestBoardPeriodSelect(makeContext(false), disabled.interaction, api);
    expect(disabled.calls).toHaveLength(1);
    expect(disabled.calls[0]?.options?.content).toContain('現在無効です');

    const invalid = makeSelectInteraction(user, ['yearly'], timeline);
    await handleQuestBoardPeriodSelect(makeContext(), invalid.interaction, api);
    expect(invalid.calls).toHaveLength(0);

    const foreign = makeSelectInteraction(user, ['weekly'], timeline);
    foreign.interaction.customId = 'game-accounts:score:1:genshin:1:cv';
    await handleQuestBoardPeriodSelect(makeContext(), foreign.interaction, api);
    expect(foreign.calls).toHaveLength(0);

    expect(api).not.toHaveBeenCalled();
  });
});

interface FakeCommandInteraction {
  calls: Array<{ method: string; options?: Record<string, unknown> }>;
  interaction: {
    guildId: string | null;
    user: { id: string };
    options: { getSubcommand(): string };
    reply(options: Record<string, unknown>): Promise<unknown>;
    deferReply(options: Record<string, unknown>): Promise<unknown>;
    editReply(options: Record<string, unknown> | string): Promise<unknown>;
  };
}

function makeCommandInteraction(subcommand: string): FakeCommandInteraction {
  const calls: FakeCommandInteraction['calls'] = [];
  const interaction: FakeCommandInteraction['interaction'] = {
    guildId: guild,
    user: { id: user },
    options: { getSubcommand: () => subcommand },
    async reply(options) {
      calls.push({ method: 'reply', options });
    },
    async deferReply(options) {
      calls.push({ method: 'deferReply', options });
    },
    async editReply(options) {
      calls.push({
        method: 'editReply',
        options: typeof options === 'string' ? { content: options } : options,
      });
    },
  };
  return { calls, interaction };
}

async function runCommand(subcommand: string, context = makeContext()) {
  const { calls, interaction } = makeCommandInteraction(subcommand);
  const commands = questBoardPlugin.provideCommands!(context);
  await commands[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
  return calls;
}

describe('quest command replies', () => {
  beforeEach(() => {
    vi.stubEnv('IVRM_WEB_API_BASE_URL', 'https://api.ivrm.jp');
    vi.stubEnv('HERTA_MBTI_SYNC_SECRET', 'test-secret');
    vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', guild);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const request = JSON.parse(init.body as string) as Record<string, unknown>;
        return Response.json({
          schemaVersion: 1,
          requestId: request.requestId,
          discordUserId: user,
          action: request.action,
          status: 'ok',
          board: boardFixture,
        });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('defers ephemerally and renders the requested period', async () => {
    const calls = await runCommand('daily');
    const defer = calls.find((call) => call.method === 'deferReply');
    expect(defer?.options?.flags).toBe(MessageFlags.Ephemeral);
    const edit = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(edit?.options?.embeds)).toContain('デイリー');
    expect(JSON.stringify(edit?.options?.embeds)).toContain('発言');
    expect(JSON.stringify(edit?.options?.components)).toContain(`quest-board:period:${user}`);
  });

  it('renders the weekly period for /quest weekly', async () => {
    const calls = await runCommand('weekly');
    const edit = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(edit?.options?.embeds)).toContain('ウィークリー');
  });

  it('shows the unconfigured guidance when the integration is not set up', async () => {
    vi.stubEnv('IVRM_WEB_API_BASE_URL', '');
    vi.stubEnv('HERTA_MBTI_SYNC_SECRET', '');
    vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', '');
    const calls = await runCommand('daily');
    const edit = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(edit?.options?.embeds)).toContain('未設定です');
  });

  it('answers without deferring when the plugin is disabled', async () => {
    const calls = await runCommand('daily', makeContext(false));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('reply');
    expect(calls[0]?.options?.content).toContain('有効にして利用してください');
    expect(calls[0]?.options?.flags).toBe(MessageFlags.Ephemeral);
  });
});
