import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createCommonPointsCommand } from './common-points.js';

const guildId = '111111111111111111';
const userId = '222222222222222222';
const env = {
  COMMON_POINTS_ENABLED: 'true',
  HERTA_POINTS_GUILD_ID: guildId,
  HERTA_POINTS_SECRET: 'synthetic-local-test-key',
};
function interaction(guild: string | null = guildId) {
  return {
    guildId: guild,
    user: { id: userId },
    options: { getUser: vi.fn(() => ({ id: '333333333333333333' })) },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
}
type Input = Parameters<ReturnType<typeof createCommonPointsCommand>['execute']>[0];

describe('private common wallet command', () => {
  it.each([null, '444444444444444444'])(
    'rejects noncanonical guild %s without IO',
    async (guild) => {
      const target = interaction(guild);
      const fetcher = vi.fn();
      await createCommonPointsCommand(env, fetcher).execute(target as unknown as Input);
      expect(fetcher).not.toHaveBeenCalled();
      expect(target.deferReply).not.toHaveBeenCalled();
      expect(target.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      );
    },
  );
  it('disabled configuration never queries a wallet', async () => {
    const target = interaction();
    const fetcher = vi.fn();
    await createCommonPointsCommand({}, fetcher).execute(target as unknown as Input);
    expect(fetcher).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledOnce();
  });
  it('defers privately and reads only the authenticated subject on every invocation', async () => {
    const target = interaction();
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      const request = input as Request;
      expect(request.url).toBe('https://api.ivrm.jp/v1/points/herta/balance');
      expect(await request.json()).toEqual({ guildId, discordUserId: userId });
      expect(request.cache).toBe('no-store');
      return new Response(
        JSON.stringify({
          status: 'ok',
          userId: 'canonical-synthetic',
          account: {
            balance: fetcher.mock.calls.length === 1 ? 160 : 170,
            lifetimeEarned: 200,
            lifetimeSpent: 30,
          },
        }),
      );
    });
    const command = createCommonPointsCommand(env, fetcher);
    expect(command.definition.options).toBeUndefined();
    await command.execute(target as unknown as Input);
    expect(target.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('**160 pt**'),
        allowedMentions: { parse: [] },
      }),
    );
    await command.execute(target as unknown as Input);
    expect(target.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('**170 pt**'),
      }),
    );
    expect(target.options.getUser).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(target.reply).not.toHaveBeenCalled();
  });
  it.each([409, 503])('does not invent zero or local score when API returns %s', async (status) => {
    const target = interaction();
    await createCommonPointsCommand(
      env,
      vi.fn(async () => new Response('', { status })),
    ).execute(target as unknown as Input);
    const content = target.editReply.mock.calls[0]![0].content as string;
    expect(content).toContain('確認できませんでした');
    expect(content).not.toContain('0 pt');
  });
  it('network failure stays private and does not expose errors or signing credentials', async () => {
    const target = interaction();
    await createCommonPointsCommand(
      env,
      vi.fn(async () => {
        throw new Error(env.HERTA_POINTS_SECRET);
      }),
    ).execute(target as unknown as Input);
    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(JSON.stringify(target.editReply.mock.calls)).not.toContain(env.HERTA_POINTS_SECRET);
    expect(target.editReply.mock.calls[0]![0].content).toContain('確認できませんでした');
  });
});
