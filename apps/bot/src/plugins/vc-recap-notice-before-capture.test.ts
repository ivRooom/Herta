import type { ChatInputCommandInteraction } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startVcRecap: vi.fn(),
  stopVcRecap: vi.fn(),
  isVcRecapActive: vi.fn(() => false),
}));

vi.mock('@herta/db', () => ({
  listVcRecapSessions: vi.fn(),
}));
vi.mock('../voice/vc-recap-session-manager.js', () => ({
  activeVcRecapChannelId: vi.fn(() => null),
  isVcRecapActive: mocks.isVcRecapActive,
  startVcRecap: mocks.startVcRecap,
  stopVcRecap: mocks.stopVcRecap,
}));
vi.mock('../voice/vc-recap-consent-interaction.js', () => ({
  buildConsentActionRow: vi.fn(),
  buildConsentPromptContent: vi.fn(),
}));

const { vcRecapPlugin } = await import('./vc-recap.js');

function fakeContext() {
  return {
    manifest: {} as never,
    client: {} as never,
    prisma: {} as never,
    guildId: 'guild-1',
    config: { enabled: true, excludedChannelIds: [], autoConsentRoleIds: [] },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never,
  };
}

function makeStartInteraction() {
  const channel = {
    id: '123456',
    guild: { id: 'guild-1' },
    send: vi.fn().mockResolvedValue({ id: 'announcement-1' }),
  };
  const interaction = {
    guildId: 'guild-1',
    guild: {
      members: {
        fetch: vi.fn().mockResolvedValue({ voice: { channel } }),
      },
    },
    user: { id: 'user-1' },
    options: { getSubcommand: () => 'start' },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, channel };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/vc-recap start 録音開始通知ゲート', () => {
  it('Discordへの開始通知が成功した後にのみ開始成功と応答する', async () => {
    const { interaction, channel } = makeStartInteraction();
    mocks.startVcRecap.mockImplementationOnce(async (...args: unknown[]) => {
      const announce = args[5] as (details: {
        sessionId: string;
        consentingCount: number;
        nonConsentingUserIds: string[];
      }) => Promise<void>;
      await announce({
        sessionId: 'session-1',
        consentingCount: 1,
        nonConsentingUserIds: [],
      });
      return {
        status: 'started',
        sessionId: 'session-1',
        consentingCount: 1,
        nonConsentingUserIds: [],
      };
    });

    const [command] = vcRecapPlugin.provideCommands!(fakeContext());
    await command!.execute(interaction);

    expect(channel.send).toHaveBeenCalledWith({
      embeds: [expect.anything()],
    });
    expect(channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      (interaction.editReply as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('記録を開始しました'),
    );
  });

  it('通知送信に失敗したときは成功を報告せず明示的に失敗を返す', async () => {
    const { interaction, channel } = makeStartInteraction();
    channel.send.mockRejectedValueOnce(new Error('Missing Permissions'));
    mocks.startVcRecap.mockImplementationOnce(async (...args: unknown[]) => {
      const announce = args[5] as (details: {
        sessionId: string;
        consentingCount: number;
        nonConsentingUserIds: string[];
      }) => Promise<void>;
      try {
        await announce({ sessionId: 'session-2', consentingCount: 1, nonConsentingUserIds: [] });
      } catch {
        return { status: 'announcement_failed' };
      }
      throw new Error('通知が失敗したのに録音開始が成功してしまった');
    });

    const [command] = vcRecapPlugin.provideCommands!(fakeContext());
    await command!.execute(interaction);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('記録を開始しませんでした'),
    );
    expect(interaction.editReply).not.toHaveBeenCalledWith(
      expect.stringContaining('記録を開始しました'),
    );
  });
});
