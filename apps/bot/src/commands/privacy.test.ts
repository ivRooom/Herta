import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  erasure: vi.fn().mockResolvedValue(undefined),
  deleteVoice: vi.fn().mockResolvedValue({ deletedSessions: 1, redactedSessions: 2 }),
  consent: vi.fn().mockResolvedValue({ voiceTranscriptionConsent: false, updatedAt: new Date(0) }),
  voice: vi.fn().mockResolvedValue([]),
  transcript: vi.fn().mockResolvedValue([
    {
      sessionId: 'session-1',
      userId: 'owner-user',
      text: 'こんにちは',
      startedAt: new Date('2026-10-26T00:00:00.000Z'),
      endedAt: new Date('2026-10-26T00:00:02.000Z'),
    },
  ]),
}));
vi.mock('@herta/db', () => ({
  hasDailyBonusSchema: vi.fn(async () => false),
  getPrismaClient: () => ({ mbtiPersonalResult: { findMany: mocks.findMany } }),
  getUserDataConsent: mocks.consent,
  listVcRecapSessionsForUser: mocks.voice,
  listVcRecapTranscriptSegmentsForUser: mocks.transcript,
  deleteUserVoiceData: mocks.deleteVoice,
  requestVcRecapErasure: mocks.erasure,
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
    expect(mocks.transcript).toHaveBeenCalledWith(expect.anything(), 'owner-user');
    expect(exported.voiceTranscriptSegments).toEqual([
      {
        sessionId: 'session-1',
        text: 'こんにちは',
        startedAt: '2026-10-26T00:00:00.000Z',
        endedAt: '2026-10-26T00:00:02.000Z',
      },
    ]);
    expect(exported.userId).toBe('owner-user');
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
  });
});

describe('privacy delete-voice-data', () => {
  it('blocks new storage before deleting current VC sessions', async () => {
    const order: string[] = [];
    mocks.erasure.mockImplementationOnce(async () => {
      order.push('erase-barrier');
    });
    mocks.deleteVoice.mockImplementationOnce(async () => {
      order.push('delete-postgres');
      return { deletedSessions: 1, redactedSessions: 2 };
    });
    const interaction = {
      user: { id: 'owner-user' },
      options: { getSubcommand: () => 'delete-voice-data' },
      reply: vi.fn(),
    };
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(order).toEqual(['erase-barrier', 'delete-postgres']);
    expect(mocks.erasure).toHaveBeenCalledWith(expect.anything(), 'owner-user');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('VC要約データの削除') }),
    );
  });
});
