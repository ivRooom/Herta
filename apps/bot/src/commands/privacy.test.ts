import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  consent: vi.fn().mockResolvedValue({ voiceTranscriptionConsent: false, updatedAt: new Date(0) }),
  voice: vi.fn().mockResolvedValue([]),
}));
vi.mock('@herta/db', () => ({
  getPrismaClient: () => ({ mbtiPersonalResult: { findMany: mocks.findMany } }),
  getUserDataConsent: mocks.consent,
  listVcRecapSessionsForUser: mocks.voice,
  deleteUserVoiceData: vi.fn(),
  setVoiceTranscriptionConsent: vi.fn(),
}));
import { privacyCommand } from './privacy.js';
describe('privacy export', () => {
  it('exports the invoking user MBTI history across guilds without access tokens', async () => {
    const rows = [
      { id: 'first', guildId: 'guild-a', resultType: 'INFP' },
      { id: 'second', guildId: 'guild-b', resultType: 'ENFP' },
    ];
    mocks.findMany.mockResolvedValue(rows);
    const interaction = {
      user: { id: 'owner-user' },
      options: { getSubcommand: () => 'export' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(mocks.findMany.mock.calls[0]![0].where).toEqual({ discordUserId: 'owner-user' });
    expect(mocks.findMany.mock.calls[0]![0].select.completionKey).toBeUndefined();
    const payload = interaction.editReply.mock.calls[0]![0];
    const exported = JSON.parse(payload.files[0].attachment.toString('utf8'));
    expect(exported.mbtiResults).toEqual(rows);
    expect(exported.voiceRecapSessions).toEqual([]);
    expect(exported.userId).toBe('owner-user');
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
  });
});
