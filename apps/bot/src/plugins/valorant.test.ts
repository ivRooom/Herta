import { describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { VALORANT_AGENTS } from '@herta/plugin-catalog';
import { normalizeValorantConfig, valorantPlugin } from './valorant.js';

function fixture({
  inVoice = true,
  participants = ['u1', 'u2'],
  bots = [] as string[],
  enabled = true,
  enabledAgents,
}: {
  inVoice?: boolean;
  participants?: string[];
  bots?: string[];
  enabled?: boolean;
  enabledAgents?: string[];
} = {}) {
  const members = new Map(
    [...participants, ...bots].map((id) => [id, { id, user: { bot: bots.includes(id) } }]),
  );
  const channel = { name: 'ゲームVC', members };
  const fetch = vi.fn().mockResolvedValue({
    voice: { channel: inVoice ? channel : null },
  });
  const reply = vi.fn();
  const interaction = {
    guildId: 'guild',
    guild: { members: { fetch } },
    user: { id: 'u1' },
    options: { getSubcommand: () => 'random' },
    reply,
  };
  const context = { config: { enabled, enabledAgents }, prisma: {}, logger: {} } as unknown as Parameters<
    NonNullable<typeof valorantPlugin.provideCommands>
  >[0];
  return {
    reply,
    fetch,
    execute: async () => {
      const handlers = await valorantPlugin.provideCommands!(context);
      await handlers[0]!.execute(interaction as unknown as ChatInputCommandInteraction);
    },
  };
}

describe('Valorant random', () => {
  it('抽選候補は未設定時30名、設定時は選択したAgentだけ', () => {
    expect(normalizeValorantConfig({}).enabledAgents).toEqual([...VALORANT_AGENTS]);
    expect(normalizeValorantConfig({ enabledAgents: ['Jett', 'Astra'] }).enabledAgents).toEqual(['Jett', 'Astra']);
  });

  it('不正なAgentを含む永続設定には公式一覧を使う', () => {
    expect(normalizeValorantConfig({ enabledAgents: ['not-an-agent'] }).enabledAgents).toEqual([...VALORANT_AGENTS]);
    expect(normalizeValorantConfig({ enabledAgents: ['Jett', 'Jett'] }).enabledAgents).toEqual([...VALORANT_AGENTS]);
    expect(normalizeValorantConfig({ enabledAgents: [] }).enabledAgents).toEqual([...VALORANT_AGENTS]);
  });

  it('VCの人間だけを割り当て、botを除外して公開する', async () => {
    const f = fixture({ bots: ['bot1'], enabledAgents: ['Jett', 'Astra'] });
    await f.execute();
    expect(f.fetch).toHaveBeenCalledWith('u1');
    expect(f.reply).toHaveBeenCalledOnce();
    const options = f.reply.mock.calls[0]![0];
    expect(options.allowedMentions).toEqual({ parse: [] });
    expect(options.embeds).toHaveLength(1);
    const description = options.embeds[0].data.description as string;
    expect(description).toContain('<@u1>');
    expect(description).toContain('<@u2>');
    expect(description).not.toContain('bot1');
    expect(description).toMatch(/Astra/);
    expect(description).toMatch(/Jett/);
  });

  it('VC未参加ならプライベートエラー', async () => {
    const f = fixture({ inVoice: false });
    await f.execute();
    expect(f.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it('Agent候補が足りない場合は割り当てずエラー', async () => {
    const f = fixture({ enabledAgents: ['Astra'] });
    await f.execute();
    const options = f.reply.mock.calls[0]![0];
    expect(options.flags).toBe(MessageFlags.Ephemeral);
    expect(options.content).toContain('不足');
  });

  it('invokerが対象VCにない場合は誤抽選しない', async () => {
    const f = fixture({ participants: ['u2'] });
    await f.execute();
    expect(f.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
  });

  it('Plugin configが無効な場合はVCを取得しない', async () => {
    const f = fixture({ enabled: false });
    await f.execute();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
  });

  it('Manifestにrandomサブコマンドが公開されている', () => {
    expect(valorantPlugin.manifest.commands[0]?.subcommands?.some((command) => command.name === 'random')).toBe(true);
  });
});
