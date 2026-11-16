import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { gameAccountsManifest } from '@herta/plugin-catalog';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  buildScoreViewReply,
  gameAccountsPlugin,
  handleGameAccountsScoreButton,
  handleGameAccountsUnlinkButton,
} from './game-accounts.js';
import type { GameAccountsRequestInput, IvrmGameAccountsResult } from './game-accounts-ivrm.js';

const guild = '123456789012345678';
const user = '223456789012345678';

type Context = PluginRuntimeContext<{ enabled: boolean }, unknown, PrismaClient>;
type Api = Parameters<typeof handleGameAccountsUnlinkButton>[2];

function makeContext(enabled = true): Context {
  return {
    client: undefined,
    prisma: undefined,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    guildId: guild,
    config: { enabled },
    manifest: gameAccountsManifest,
  } as unknown as Context;
}

interface FakeInteraction {
  calls: Array<{ method: string; options?: Record<string, unknown> }>;
  interaction: {
    guildId: string | null;
    user: { id: string };
    customId?: string;
    isButton(): boolean;
    reply(options: { content: string; flags: number }): Promise<unknown>;
    update(options: { embeds?: unknown; components?: unknown }): Promise<unknown>;
    deferUpdate(): Promise<unknown>;
    editReply(options: { embeds?: unknown; components?: unknown }): Promise<unknown>;
  };
}

function makeInteraction(
  action: 'confirm' | 'cancel',
  userId: string,
  timeline: string[],
): FakeInteraction {
  const calls: FakeInteraction['calls'] = [];
  const interaction: FakeInteraction['interaction'] = {
    guildId: guild,
    user: { id: userId },
    customId: `game-accounts:unlink:${action}:${userId}:genshin`,
    isButton: () => true,
    async reply(options) {
      timeline.push('reply');
      calls.push({ method: 'reply', options });
    },
    async update(options) {
      timeline.push('update');
      calls.push({ method: 'update', options });
    },
    async deferUpdate() {
      timeline.push('deferUpdate');
      calls.push({ method: 'deferUpdate' });
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

const unlinkOk: IvrmGameAccountsResult = { status: 'ok', action: 'unlink', gameCode: 'genshin' };

describe('game accounts unlink buttons', () => {
  it('defers before the API call and shows the result via editReply', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => {
      timeline.push('api');
      return unlinkOk;
    }) as unknown as Api;
    const { calls, interaction } = makeInteraction('confirm', user, timeline);

    await handleGameAccountsUnlinkButton(makeContext(), interaction, api);

    expect(api).toHaveBeenCalledTimes(1);
    expect(timeline).toEqual(['deferUpdate', 'editReply', 'api', 'editReply']);
    expect(calls.some((call) => call.method === 'update')).toBe(false);
    expect(calls.some((call) => call.method === 'reply')).toBe(false);
    const disable = calls.find(
      (call) => call.method === 'editReply' && call.options?.embeds === undefined,
    );
    expect(JSON.stringify(disable?.options?.components)).toContain('"disabled":true');
    const result = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(result?.options?.embeds)).toContain('解除しました');
    expect(result?.options?.components).toEqual([]);
  });

  it('rejects Cancel while Confirm is pending and still completes the unlink', async () => {
    const timeline: string[] = [];
    const apiStarted = deferred<void>();
    const apiGate = deferred<IvrmGameAccountsResult>();
    const api = vi.fn(async () => {
      apiStarted.resolve();
      return apiGate.promise;
    }) as unknown as Api;
    const confirm = makeInteraction('confirm', user, timeline);
    const cancel = makeInteraction('cancel', user, timeline);

    const confirmPromise = handleGameAccountsUnlinkButton(makeContext(), confirm.interaction, api);
    await apiStarted.promise;
    await handleGameAccountsUnlinkButton(makeContext(), cancel.interaction, api);

    expect(cancel.calls).toHaveLength(1);
    expect(cancel.calls[0]?.method).toBe('reply');
    expect(cancel.calls[0]?.options?.content).toContain('進行中です');
    expect(cancel.calls[0]?.options?.content).not.toContain('キャンセルしました');
    expect(cancel.calls.some((call) => call.method === 'update')).toBe(false);
    expect(api).toHaveBeenCalledTimes(1);

    apiGate.resolve(unlinkOk);
    await confirmPromise;

    const result = confirm.calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(result?.options?.embeds)).toContain('解除しました');
  });

  it('cancels normally when nothing is pending', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => unlinkOk) as unknown as Api;
    const { calls, interaction } = makeInteraction('cancel', '323456789012345678', timeline);

    await handleGameAccountsUnlinkButton(makeContext(), interaction, api);

    expect(api).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('update');
    expect(JSON.stringify(calls[0]?.options?.embeds)).toContain('キャンセルしました');
    expect(calls[0]?.options?.components).toEqual([]);
  });

  it('rejects a second Confirm while one is pending', async () => {
    const timeline: string[] = [];
    const apiStarted = deferred<void>();
    const apiGate = deferred<IvrmGameAccountsResult>();
    const api = vi.fn(async () => {
      apiStarted.resolve();
      return apiGate.promise;
    }) as unknown as Api;
    const first = makeInteraction('confirm', user, timeline);
    const second = makeInteraction('confirm', user, timeline);

    const firstPromise = handleGameAccountsUnlinkButton(makeContext(), first.interaction, api);
    await apiStarted.promise;
    await handleGameAccountsUnlinkButton(makeContext(), second.interaction, api);

    expect(api).toHaveBeenCalledTimes(1);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.method).toBe('reply');
    expect(second.calls[0]?.options?.content).toContain('進行中です');

    apiGate.resolve(unlinkOk);
    await firstPromise;
  });

  it('shows an API failure via editReply, not a fresh reply', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => {
      throw new Error('upstream down');
    }) as unknown as Api;
    const context = makeContext();
    const { calls, interaction } = makeInteraction('confirm', '423456789012345678', timeline);

    await handleGameAccountsUnlinkButton(context, interaction, api);

    expect(calls.some((call) => call.method === 'update')).toBe(false);
    expect(calls.some((call) => call.method === 'reply')).toBe(false);
    const result = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(result?.options?.embeds)).toContain('解除できませんでした');
    expect(context.logger.error).toHaveBeenCalled();
  });

  it('ignores buttons from another user and from a disabled plugin', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => unlinkOk) as unknown as Api;
    const stranger = makeInteraction('confirm', user, timeline);
    stranger.interaction.user = { id: '523456789012345678' };

    await handleGameAccountsUnlinkButton(makeContext(), stranger.interaction, api);
    expect(api).not.toHaveBeenCalled();
    expect(stranger.calls).toHaveLength(1);
    expect(stranger.calls[0]?.options?.content).toContain('本人だけが使えます');

    const disabled = makeInteraction('confirm', user, timeline);
    await handleGameAccountsUnlinkButton(makeContext(false), disabled.interaction, api);
    expect(api).not.toHaveBeenCalled();
    expect(disabled.calls).toHaveLength(1);
    expect(disabled.calls[0]?.options?.content).toContain('現在無効です');
  });
});

type ScoreApi = NonNullable<Parameters<typeof handleGameAccountsScoreButton>[2]>;
type ScoreResult = Extract<IvrmGameAccountsResult, { status: 'ok'; action: 'score' }>;

const scoreResult: ScoreResult = {
  status: 'ok',
  action: 'score',
  gameCode: 'genshin',
  uid: '812468719',
  showcaseStatus: 'ok',
  fetchedAt: '2026-11-15T14:43:29.060Z',
  hasSnapshot: true,
  characters: [
    {
      id: '10000098',
      name: 'クロリンデ',
      level: 80,
      artifactScore: { total: 160.8, version: 1, perPiece: [{ cv: 34.9, rolls: { critRate: 3 } }] },
    },
    {
      id: '10000046',
      name: '胡桃',
      level: 80,
      artifactScore: { total: 74.5, version: 1, perPiece: [{ cv: 30.3, rolls: { critDmg: 3 } }] },
    },
    { id: '10000061', name: '綺良々', level: 70, artifactScore: null },
  ],
};

const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function makeScoreApi(cardFails = false) {
  return vi.fn(
    async (
      _guildId: string,
      _userId: string,
      input: GameAccountsRequestInput,
    ): Promise<IvrmGameAccountsResult> => {
      if (input.action === 'score') return scoreResult;
      if (input.action === 'card') {
        if (cardFails) return { status: 'card-unavailable' };
        return {
          status: 'ok',
          action: 'card',
          gameCode: 'genshin',
          uid: '812468719',
          fetchedAt: '2026-11-15T14:43:29.060Z',
          cards: [
            {
              characterId: input.characterId ?? '',
              name: null,
              score: null,
              png: tinyPng,
            },
          ],
        };
      }
      throw new Error(`unexpected action: ${input.action}`);
    },
  ) as unknown as ScoreApi;
}

function componentsJson(components: unknown): Array<Record<string, unknown>> {
  return JSON.parse(JSON.stringify(components ?? [])) as Array<Record<string, unknown>>;
}

function rowButtons(row: Record<string, unknown>): Array<Record<string, unknown>> {
  return (row.components as Array<Record<string, unknown>>) ?? [];
}

describe('score view reply (initial /game score)', () => {
  it('shows only the first scored character, with its PNG card attached', async () => {
    const api = makeScoreApi();
    const view = await buildScoreViewReply(guild, user, scoreResult, undefined, api);

    expect(api).toHaveBeenCalledWith(
      guild,
      user,
      expect.objectContaining({ action: 'card', characterId: '10000098' }),
    );
    expect(view.files).toHaveLength(1);
    expect(view.files?.[0]?.name).toBe('game-card-10000098.png');
    expect(view.embeds).toHaveLength(1);
    expect(view.embeds[0]?.fields).toHaveLength(1);
    expect(view.embeds[0]?.fields?.[0]?.name).toContain('クロリンデ');
    // Buttons exist for the two scored characters only; the selected one
    // is disabled, and the unscored character gets no button.
    const buttons = componentsJson(view.components).flatMap(rowButtons);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({
      custom_id: `game-accounts:score:${user}:genshin:10000098`,
      label: 'クロリンデ',
      disabled: true,
    });
    expect(buttons[1]).toMatchObject({
      custom_id: `game-accounts:score:${user}:genshin:10000046`,
      label: '胡桃',
    });
    expect(buttons[1]?.disabled).toBeFalsy();
  });

  it('falls back to the text view (no file) when the card cannot be rendered', async () => {
    const api = makeScoreApi(true);
    const view = await buildScoreViewReply(guild, user, scoreResult, undefined, api);

    expect(view.files).toBeUndefined();
    expect(view.embeds[0]?.fields).toHaveLength(1);
    expect(view.embeds[0]?.fields?.[0]?.name).toContain('クロリンデ');
    expect(componentsJson(view.components).flatMap(rowButtons)).toHaveLength(2);
  });

  it('keeps the classic all-characters embed when nobody has a score', async () => {
    const api = makeScoreApi();
    const unscored: ScoreResult = {
      ...scoreResult,
      characters: scoreResult.characters.map((character) => ({
        ...character,
        artifactScore: null,
      })),
    };
    const view = await buildScoreViewReply(guild, user, unscored, undefined, api);

    expect(api).not.toHaveBeenCalled();
    expect(view.files).toBeUndefined();
    expect(view.components).toEqual([]);
    expect(view.embeds[0]?.fields).toHaveLength(3);
  });
});

interface FakeScoreInteraction {
  calls: Array<{ method: string; options?: Record<string, unknown> }>;
  interaction: {
    guildId: string | null;
    user: { id: string };
    customId?: string;
    isButton(): boolean;
    reply(options: { content: string; flags: number }): Promise<unknown>;
    update(options: { embeds?: unknown; components?: unknown }): Promise<unknown>;
    deferUpdate(): Promise<unknown>;
    editReply(options: {
      embeds?: unknown;
      components?: unknown;
      files?: unknown;
      attachments?: unknown;
    }): Promise<unknown>;
  };
}

function makeScoreInteraction(
  characterId: string,
  userId: string,
  timeline: string[],
): FakeScoreInteraction {
  const calls: FakeScoreInteraction['calls'] = [];
  const interaction: FakeScoreInteraction['interaction'] = {
    guildId: guild,
    user: { id: userId },
    customId: `game-accounts:score:${userId}:genshin:${characterId}`,
    isButton: () => true,
    async reply(options) {
      timeline.push('reply');
      calls.push({ method: 'reply', options });
    },
    async update(options) {
      timeline.push('update');
      calls.push({ method: 'update', options });
    },
    async deferUpdate() {
      timeline.push('deferUpdate');
      calls.push({ method: 'deferUpdate' });
    },
    async editReply(options) {
      timeline.push('editReply');
      calls.push({ method: 'editReply', options });
    },
  };
  return { calls, interaction };
}

describe('game accounts score switcher buttons', () => {
  it('defers, then swaps the attachment and embed to the pressed character', async () => {
    const timeline: string[] = [];
    const api = makeScoreApi();
    const { calls, interaction } = makeScoreInteraction('10000046', user, timeline);

    await handleGameAccountsScoreButton(makeContext(), interaction, api);

    expect(timeline).toEqual(['deferUpdate', 'editReply']);
    const result = calls.filter((call) => call.method === 'editReply').at(-1);
    const files = result?.options?.files as Array<{ name?: string }> | undefined;
    expect(files).toHaveLength(1);
    expect(files?.[0]?.name).toBe('game-card-10000046.png');
    expect(JSON.stringify(result?.options?.embeds)).toContain('胡桃');
    expect(JSON.stringify(result?.options?.embeds)).not.toContain('クロリンデ Lv');
    const buttons = componentsJson(result?.options?.components).flatMap(rowButtons);
    expect(buttons[0]?.disabled).toBeFalsy();
    expect(buttons[1]).toMatchObject({ label: '胡桃', disabled: true });
  });

  it('falls back to the text view and clears the old attachment when the card fails', async () => {
    const timeline: string[] = [];
    const api = makeScoreApi(true);
    const { calls, interaction } = makeScoreInteraction('10000046', user, timeline);

    await handleGameAccountsScoreButton(makeContext(), interaction, api);

    const result = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(result?.options?.files).toBeUndefined();
    expect(result?.options?.attachments).toEqual([]);
    expect(JSON.stringify(result?.options?.embeds)).toContain('胡桃');
    expect(componentsJson(result?.options?.components).flatMap(rowButtons)).toHaveLength(2);
  });

  it('lets anyone in the channel switch, always reading the view owner’s score', async () => {
    const timeline: string[] = [];
    const base = makeScoreApi();
    const seenUserIds: string[] = [];
    const api = vi.fn(async (guildId: string, userId: string, input: GameAccountsRequestInput) => {
      seenUserIds.push(userId);
      return (base as unknown as ScoreApi)(guildId, userId, input);
    }) as unknown as ScoreApi;
    const { calls, interaction } = makeScoreInteraction('10000046', user, timeline);
    interaction.user = { id: '523456789012345678' };

    await handleGameAccountsScoreButton(makeContext(), interaction, api);

    // The score re-read and the card render both name the member whose
    // buttons these are; the presser only changes what is displayed.
    expect(seenUserIds.length).toBeGreaterThan(0);
    expect(seenUserIds.every((id) => id === user)).toBe(true);
    expect(calls.some((call) => call.method === 'reply')).toBe(false);
    const result = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(result?.options?.embeds)).toContain('胡桃');
    const buttons = componentsJson(result?.options?.components).flatMap(rowButtons);
    expect(buttons[1]).toMatchObject({
      custom_id: `game-accounts:score:${user}:genshin:10000046`,
      disabled: true,
    });
  });

  it('rejects a second press while a switch is in flight', async () => {
    const timeline: string[] = [];
    const cardStarted = deferred<void>();
    const cardGate = deferred<IvrmGameAccountsResult>();
    const base = makeScoreApi();
    const api = vi.fn(
      async (
        guildId: string,
        userId: string,
        input: GameAccountsRequestInput,
      ): Promise<IvrmGameAccountsResult> => {
        if (input.action === 'card') {
          cardStarted.resolve();
          return cardGate.promise;
        }
        return (base as unknown as ScoreApi)(guildId, userId, input);
      },
    ) as unknown as ScoreApi;
    const first = makeScoreInteraction('10000046', user, timeline);
    const second = makeScoreInteraction('10000098', user, timeline);

    const firstPromise = handleGameAccountsScoreButton(makeContext(), first.interaction, api);
    await cardStarted.promise;
    await handleGameAccountsScoreButton(makeContext(), second.interaction, api);

    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.method).toBe('reply');
    expect(second.calls[0]?.options?.content).toContain('切り替え中です');

    cardGate.resolve({
      status: 'ok',
      action: 'card',
      gameCode: 'genshin',
      uid: '812468719',
      fetchedAt: null,
      cards: [{ characterId: '10000046', name: null, score: null, png: tinyPng }],
    });
    await firstPromise;
    const result = first.calls.filter((call) => call.method === 'editReply').at(-1);
    expect(JSON.stringify(result?.options?.embeds)).toContain('胡桃');
  });

  it('ignores malformed custom ids and buttons for other guilds', async () => {
    const timeline: string[] = [];
    const api = makeScoreApi();
    const malformed = makeScoreInteraction('10000046', user, timeline);
    malformed.interaction.customId = 'game-accounts:score:not-a-snowflake:genshin:10000046';
    await handleGameAccountsScoreButton(makeContext(), malformed.interaction, api);
    expect(malformed.calls).toHaveLength(0);

    const otherGuild = makeScoreInteraction('10000046', user, timeline);
    otherGuild.interaction.guildId = '999456789012345678';
    await handleGameAccountsScoreButton(makeContext(), otherGuild.interaction, api);
    expect(otherGuild.calls).toHaveLength(0);
    expect(api).not.toHaveBeenCalled();
  });
});

interface FakeCommandInteraction {
  calls: Array<{ method: string; options?: unknown }>;
  interaction: {
    guildId: string | null;
    user: { id: string };
    options: {
      getSubcommand(): string;
      getString(name: string, required?: boolean): string;
    };
    deferReply(options?: { flags?: number }): Promise<unknown>;
    editReply(options: unknown): Promise<unknown>;
    reply(options: unknown): Promise<unknown>;
  };
}

function makeCommandInteraction(subcommand: string, gameCode = 'genshin'): FakeCommandInteraction {
  const calls: FakeCommandInteraction['calls'] = [];
  const interaction: FakeCommandInteraction['interaction'] = {
    guildId: guild,
    user: { id: user },
    options: {
      getSubcommand: () => subcommand,
      getString: () => gameCode,
    },
    async deferReply(options) {
      calls.push({ method: 'deferReply', options });
    },
    async editReply(options) {
      calls.push({ method: 'editReply', options });
    },
    async reply(options) {
      calls.push({ method: 'reply', options });
    },
  };
  return { calls, interaction };
}

async function runCommand(subcommand: string, gameCode = 'genshin') {
  const { calls, interaction } = makeCommandInteraction(subcommand, gameCode);
  const commands = gameAccountsPlugin.provideCommands!(makeContext());
  await commands[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
  return calls;
}

function deferFlags(calls: FakeCommandInteraction['calls']): number | undefined {
  const defer = calls.find((call) => call.method === 'deferReply');
  return (defer?.options as { flags?: number } | undefined)?.flags;
}

function lastEditEmbedsJson(calls: FakeCommandInteraction['calls']): string {
  const edit = calls.filter((call) => call.method === 'editReply').at(-1);
  return JSON.stringify((edit?.options as { embeds?: unknown })?.embeds ?? null);
}

describe('game command reply visibility (#923)', () => {
  beforeEach(() => {
    // No integration configured: the client answers "unconfigured"
    // without any network access, which is enough to observe how the
    // command defers its reply.
    vi.stubEnv('IVRM_WEB_API_BASE_URL', '');
    vi.stubEnv('HERTA_MBTI_SYNC_SECRET', '');
    vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('defers publicly for list, score and progress', async () => {
    for (const subcommand of ['list', 'score', 'progress']) {
      const calls = await runCommand(subcommand);
      expect(deferFlags(calls)).toBeUndefined();
      // The unconfigured integration still lands in an editReply.
      expect(lastEditEmbedsJson(calls)).toContain('未設定です');
    }
  });

  it('keeps link ephemeral: it handles the member’s own UID', async () => {
    const calls = await runCommand('link');
    expect(deferFlags(calls)).toBe(MessageFlags.Ephemeral);
  });

  it('keeps unlink ephemeral with its confirmation buttons', async () => {
    const { calls, interaction } = makeCommandInteraction('unlink');
    const commands = gameAccountsPlugin.provideCommands!(makeContext());
    await commands[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('reply');
    expect((calls[0]?.options as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(calls[0]?.options)).toContain('解除');
  });

  it('answers progress for an unsupported game without the API', async () => {
    const calls = await runCommand('progress', 'zzz');
    expect(deferFlags(calls)).toBeUndefined();
    expect(lastEditEmbedsJson(calls)).toContain('探索度（HoYoLAB戦績）の表示に未対応です');
  });

  it('renders the progress embed when the API returns a snapshot', async () => {
    vi.stubEnv('IVRM_WEB_API_BASE_URL', 'https://api.ivrm.jp');
    vi.stubEnv('HERTA_MBTI_SYNC_SECRET', 'test-secret');
    vi.stubEnv('IVRM_INTEGRATION_GUILD_ID', guild);
    const snapshot = {
      provider: 'hoyolab',
      gameCode: 'genshin',
      uid: '812468719',
      server: 'os_asia',
      player: { nickname: 'いゔる。', level: 56 },
      stats: { totalChests: 2270 },
      explorations: [{ id: 1, name: 'フォンテーヌ', percent: 100, level: 10, offerings: [] }],
      endgame: [],
      roster: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        const request = JSON.parse(init.body as string) as Record<string, unknown>;
        return Response.json({
          schemaVersion: 2,
          requestId: request.requestId,
          discordUserId: user,
          action: request.action,
          gameCode: 'genshin',
          uid: '812468719',
          status: 'ok',
          fetchedAt: '2026-11-16T01:15:00.000Z',
          succeededAt: '2026-11-16T01:15:00.000Z',
          hasProgress: true,
          progress: snapshot,
        });
      }),
    );

    const calls = await runCommand('progress');
    expect(deferFlags(calls)).toBeUndefined();
    const embeds = lastEditEmbedsJson(calls);
    expect(embeds).toContain('エリア別探索度');
    expect(embeds).toContain('フォンテーヌ');
    expect(embeds).toContain('合計 2,270');
  });
});
