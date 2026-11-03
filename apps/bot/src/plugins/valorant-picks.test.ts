import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { valorantPlugin } from './valorant.js';

async function executePicks({
  scope = 'self',
  admin = false,
  rows = [],
}: {
  scope?: 'self' | 'guild';
  admin?: boolean;
  rows?: Array<{ result: unknown }>;
}) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    guildId: '12345678901234567',
    user: { id: 'self' },
    memberPermissions: { has: () => admin },
    options: {
      getSubcommand: () => 'picks',
      getString: (name: string) => (name === 'scope' ? scope : null),
    },
    deferReply,
    editReply,
    reply,
    deferred: false,
    replied: false,
  };
  const context = {
    config: { enabled: true },
    prisma: { valorantPickSession: { findMany } },
    logger: { warn: vi.fn(), error: vi.fn() },
  } as unknown as Parameters<NonNullable<typeof valorantPlugin.provideCommands>>[0];
  const commands = await valorantPlugin.provideCommands!(context);
  await commands[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
  return { findMany, deferReply, editReply, reply };
}

describe('/valorant picks', () => {
  it('shows only own agent and role counts in a private reply', async () => {
    const subject = await executePicks({
      rows: [
        {
          result: [
            { userId: 'self', agentId: 'jett' },
            { userId: 'other-user', agentId: 'omen' },
          ],
        },
      ],
    });
    expect(subject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guildId: '12345678901234567', status: 'COMPLETED' },
        take: 5001,
      }),
    );
    expect(subject.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const message = subject.editReply.mock.calls[0]![0].content as string;
    expect(message).toContain('ジェット: 1回');
    expect(message).toContain('デュエリスト: 1回');
    expect(message).not.toContain('オーメン');
    expect(message).not.toContain('other-user');
  });

  it('denies guild-wide statistics to a member without management permission', async () => {
    const subject = await executePicks({ scope: 'guild', admin: false });
    expect(subject.findMany).not.toHaveBeenCalled();
    expect(subject.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('管理権限'),
        flags: MessageFlags.Ephemeral,
      }),
    );
  });

  it('shows aggregate counts to authorized guild staff without user identifiers', async () => {
    const subject = await executePicks({
      scope: 'guild',
      admin: true,
      rows: [
        {
          result: [
            { userId: 'self', agentId: 'jett' },
            { userId: 'other-user', agentId: 'omen' },
          ],
        },
      ],
    });
    const message = subject.editReply.mock.calls[0]![0].content as string;
    expect(message).toContain('ジェット: 1回');
    expect(message).toContain('オーメン: 1回');
    expect(message).toContain('対象抽選: 1件');
    expect(message).not.toContain('other-user');
  });
});
