import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { fortunePlugin } from './fortune.js';
import { EMPTY_FORTUNE_PROFILE } from './fortune-core.js';
import { fetchIvrmFortuneProfile } from './fortune-ivrm-profile.js';
import { fortuneManifest } from '@herta/plugin-catalog';
vi.mock('./fortune-card.js', () => ({ renderFortuneCard: vi.fn(async () => Buffer.from('png')) }));
vi.mock('./fortune-ivrm-profile.js', () => ({ fetchIvrmFortuneProfile: vi.fn() }));
const linked = {
  status: 'linked' as const,
  profile: { ...EMPTY_FORTUNE_PROFILE, birthday: '2000-10-16', mbti: 'INFP', bloodType: 'AB' },
};
beforeEach(() => {
  vi.mocked(fetchIvrmFortuneProfile).mockReset().mockResolvedValue(linked);
});
function fixture(command: string, isPublic = false) {
  const prisma = {
    guild: { findUnique: vi.fn(async () => ({ timezone: 'Asia/Tokyo' })) },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(async () => 1),
  };
  const interaction = {
    guildId: '123456789012345678',
    user: { id: '223456789012345678', displayName: '<@everyone>' },
    options: { getSubcommand: () => command, getBoolean: () => isPublic },
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
describe('ivrm-web-backed fortune command', () => {
  it('loads the invoking Discord member, privately, without copying profile data to Herta', async () => {
    const f = fixture('today');
    await f.execute();
    expect(fetchIvrmFortuneProfile).toHaveBeenCalledWith(
      f.interaction.guildId,
      f.interaction.user.id,
      expect.any(String),
    );
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.interaction.followUp).not.toHaveBeenCalled();
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain('ivrm-web');
    expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(f.prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('publishes only on explicit request and excludes source data and private hints', async () => {
    const f = fixture('today', true);
    await f.execute();
    expect(f.interaction.followUp).toHaveBeenCalledOnce();
    expect(f.interaction.editReply.mock.invocationCallOrder[0]!).toBeLessThan(
      f.interaction.followUp.mock.invocationCallOrder[0]!,
    );
    const body = JSON.stringify(f.interaction.followUp.mock.calls);
    for (const privateValue of ['2000-10-16', 'AB', 'INFP', 'あなたへのヒント'])
      expect(body).not.toContain(privateValue);
    expect(f.interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [], allowedMentions: { parse: [] } }),
    );
  });
  it('shows the current source with an edit link, never accepting duplicate registration', async () => {
    const f = fixture('profile');
    await f.execute();
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain('2000-10-16');
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain('member.ivrm.jp');
    expect(
      fortuneManifest.commands[0]!.subcommands!.find((x) => x.name === 'profile')!.options,
    ).toBeUndefined();
    expect(f.prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('distinguishes absent linkage and transient failure without using local fallback data', async () => {
    for (const status of [
      'not-linked',
      'unavailable',
      'unconfigured',
      'ineligible-guild',
    ] as const) {
      vi.mocked(fetchIvrmFortuneProfile).mockResolvedValueOnce({ status });
      const f = fixture('today');
      await f.execute();
      const body = JSON.stringify(f.interaction.editReply.mock.calls);
      expect(body).toContain(
        status === 'not-linked'
          ? '見つかりません'
          : status === 'unconfigured'
            ? '未設定'
            : status === 'ineligible-guild'
              ? '対象外'
              : '現在取得できません',
      );
      expect(body).not.toContain('INFP');
      expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
    }
  });
  it('removes only legacy Herta data, with no remote modification', async () => {
    const f = fixture('forget');
    await f.execute();
    expect(fetchIvrmFortuneProfile).not.toHaveBeenCalled();
    expect(f.prisma.$executeRaw.mock.calls[0]!.slice(1)).toEqual([
      f.interaction.guildId,
      f.interaction.user.id,
    ]);
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain(
      'ivrm-webの登録情報は変更しません',
    );
  });
});
