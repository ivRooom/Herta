import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { gameAccountsManifest } from '@herta/plugin-catalog';
import type { PluginRuntimeContext } from '@herta/plugin-sdk';
import { handleGameAccountsUnlinkButton } from './game-accounts.js';
import type { IvrmGameAccountsResult } from './game-accounts-ivrm.js';

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
    update(options: { content: string; components: never[] }): Promise<unknown>;
    deferUpdate(): Promise<unknown>;
    editReply(options: { content?: string; components?: unknown }): Promise<unknown>;
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
      (call) => call.method === 'editReply' && call.options?.content === undefined,
    );
    expect(JSON.stringify(disable?.options?.components)).toContain('"disabled":true');
    const result = calls.filter((call) => call.method === 'editReply').at(-1);
    expect(result?.options?.content).toContain('解除しました');
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
    expect(result?.options?.content).toContain('解除しました');
  });

  it('cancels normally when nothing is pending', async () => {
    const timeline: string[] = [];
    const api = vi.fn(async () => unlinkOk) as unknown as Api;
    const { calls, interaction } = makeInteraction('cancel', '323456789012345678', timeline);

    await handleGameAccountsUnlinkButton(makeContext(), interaction, api);

    expect(api).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('update');
    expect(calls[0]?.options?.content).toContain('キャンセルしました');
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
    expect(result?.options?.content).toContain('解除できませんでした');
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
