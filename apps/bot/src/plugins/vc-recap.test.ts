import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

const listVcRecapSessionsMock = vi.fn();
vi.mock('@herta/db', () => ({
  listVcRecapSessions: (...args: unknown[]) => listVcRecapSessionsMock(...args),
}));

const { normalizeVcRecapConfig, vcRecapPlugin } = await import('./vc-recap.js');

function fakeContext() {
  return {
    manifest: {} as never,
    client: {} as never,
    prisma: {} as never,
    guildId: 'guild-1',
    config: { enabled: true, excludedChannelIds: [] },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never,
  };
}

function fakeListInteraction(hasManageGuild: boolean): ChatInputCommandInteraction {
  return {
    guildId: 'guild-1',
    memberPermissions: { has: () => hasManageGuild },
    options: {
      getSubcommand: () => 'list',
      getInteger: () => null,
    },
    reply: vi.fn(),
  } as unknown as ChatInputCommandInteraction;
}

describe('/vc-recap list 権限チェック', () => {
  it('ManageGuildが無いメンバーには要約を返さない', async () => {
    const [command] = vcRecapPlugin.provideCommands!(fakeContext());
    const interaction = fakeListInteraction(false);

    await command!.execute(interaction);

    expect(listVcRecapSessionsMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('サーバー管理権限') }),
    );
  });

  it('ManageGuildを持つメンバーには一覧取得を許可する', async () => {
    listVcRecapSessionsMock.mockResolvedValueOnce({ items: [] });
    const [command] = vcRecapPlugin.provideCommands!(fakeContext());
    const interaction = fakeListInteraction(true);

    await command!.execute(interaction);

    expect(listVcRecapSessionsMock).toHaveBeenCalled();
  });
});

describe('normalizeVcRecapConfig', () => {
  it('既定値はenabled:false・excludedChannelIds:[]', () => {
    expect(normalizeVcRecapConfig(undefined)).toEqual({
      enabled: false,
      excludedChannelIds: [],
    });
  });

  it('enabledはtrueを明示しない限りfalseになる(オプトイン)', () => {
    expect(normalizeVcRecapConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeVcRecapConfig({ enabled: 'true' }).enabled).toBe(false);
  });

  it('不正なチャンネルIDは除外し、上限50件・重複排除する', () => {
    const config = normalizeVcRecapConfig({
      excludedChannelIds: ['123', '123', 'bad', ...Array.from({ length: 60 }, (_, i) => `${i}`)],
    });
    expect(config.excludedChannelIds).toHaveLength(50);
    expect(config.excludedChannelIds).toContain('123');
    expect(config.excludedChannelIds).not.toContain('bad');
  });
});
