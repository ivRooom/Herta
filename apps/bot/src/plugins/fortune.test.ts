import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { fortunePlugin } from './fortune.js';
import { EMPTY_FORTUNE_PROFILE } from './fortune-core.js';

vi.mock('./fortune-card.js', () => ({ renderFortuneCard: vi.fn(async () => Buffer.from('png')) }));

function fixture(command: string, options: Record<string, string | boolean> = {}) {
  const prisma = {
    guild: { findUnique: vi.fn(async () => ({ timezone: 'Asia/Tokyo' })) },
    $queryRaw: vi.fn(async () => [
      { ...EMPTY_FORTUNE_PROFILE, birthday: '2000-10-16', bloodType: 'AB', mbti: 'INFP-T' },
    ]),
    $executeRaw: vi.fn(async () => 1),
  };
  const interaction = {
    guildId: 'g',
    user: { id: 'u', displayName: '<@everyone>' },
    options: {
      getSubcommand: () => command,
      getString: (key: string) => options[key] ?? null,
      getBoolean: (key: string) => options[key] ?? null,
    },
    deferReply: vi.fn(),
    reply: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
  };
  const logger = { error: vi.fn() };
  const context = { config: { enabled: true }, prisma, logger } as unknown as Parameters<
    NonNullable<typeof fortunePlugin.provideCommands>
  >[0];
  return {
    prisma,
    interaction,
    logger,
    execute: async () => {
      const handlers = await fortunePlugin.provideCommands!(context);
      await handlers[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
    },
  };
}

describe('fortune command privacy and persistence', () => {
  it('defaults to private with optional profile hints', async () => {
    const f = fixture('today');
    await f.execute();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.interaction.followUp).not.toHaveBeenCalled();
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain('本人のみ');
    expect(f.prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('requires explicit public and never exposes birthday, age or blood type', async () => {
    const f = fixture('today', { public: true });
    await f.execute();
    expect(f.interaction.followUp).toHaveBeenCalledOnce();
    expect(f.interaction.editReply.mock.invocationCallOrder[0]!).toBeLessThan(
      f.interaction.followUp.mock.invocationCallOrder[0]!,
    );
    expect(f.interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [], allowedMentions: { parse: [] } }),
    );
    const body = JSON.stringify(f.interaction.followUp.mock.calls);
    expect(body).not.toContain('2000-10-16');
    expect(body).not.toContain('AB');
    expect(body).not.toContain('あなたへのヒント');
  });
  it('validates privately before saving and scopes deletion to the invoker', async () => {
    const invalid = fixture('profile', { birthday: '2023-02-29' });
    await invalid.execute();
    expect(invalid.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(invalid.interaction.followUp).not.toHaveBeenCalled();
    const valid = fixture('profile', { mbti: 'enfp-a' });
    await valid.execute();
    expect(valid.prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(JSON.stringify(valid.interaction.editReply.mock.calls)).toContain('ENFP-A');
    const forgotten = fixture('forget');
    await forgotten.execute();
    expect(forgotten.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(forgotten.prisma.$executeRaw.mock.calls[0]!.slice(1)).toEqual(['g', 'u']);
  });
  it('does not log sensitive database errors', async () => {
    const f = fixture('today');
    f.prisma.$queryRaw.mockRejectedValueOnce(new Error('secret birthday 2000-10-16'));
    await f.execute();
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain('2000-10-16');
    expect(f.interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('作成できません'));
  });
  it('does not persist derived age groups that would become stale next decade', async () => {
    const f = fixture('profile', {
      birthday: '2000-10-16',
      'age-group': '20代',
      eto: '辰',
      zodiac: '天秤座',
    });
    await f.execute();
    expect(f.prisma.$executeRaw.mock.calls[0]!.slice(-3)).toEqual([null, null, null]);
    const blank = fixture('profile', { mbti: '   ' });
    await blank.execute();
    expect(blank.prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('serializes profile and render operations even while acknowledging the first request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = fixture('today');
    first.interaction.deferReply.mockImplementationOnce(() => gate);
    const pending = first.execute();
    // Let command handler resolution finish and reach its deferred acknowledgment.
    await vi.waitFor(() => expect(first.interaction.deferReply).toHaveBeenCalledOnce());
    const second = fixture('forget');
    await second.execute();
    expect(second.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(second.prisma.$executeRaw).not.toHaveBeenCalled();
    release();
    await pending;
  });
});
