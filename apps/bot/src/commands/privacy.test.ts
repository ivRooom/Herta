import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  erasure: vi.fn().mockResolvedValue(undefined),
  openAiConsent: vi.fn().mockResolvedValue(true),
  revokeActive: vi.fn(),
  newConsentFind: vi.fn().mockResolvedValue([]),
  erasureFind: vi.fn().mockResolvedValue(null),
  deleteVoice: vi.fn().mockResolvedValue({ deletedSessions: 1, redactedSessions: 2 }),
  revokeVoice: vi.fn().mockResolvedValue(undefined),
  consent: vi.fn().mockResolvedValue({ voiceTranscriptionConsent: false, updatedAt: new Date(0) }),
  ticketLinkEnabled: vi.fn(() => false),
  erasureCaseCreate: vi.fn(),
  buildErasurePayload: vi.fn((input: unknown) => ({ kind: 'create', input })),
  enqueue: vi.fn().mockResolvedValue(1),
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
  getPrismaClient: () => ({
    mbtiPersonalResult: { findMany: mocks.findMany },
    vcRecapExplicitConsent: { findMany: mocks.newConsentFind },
    vcRecapErasureRequest: { findUnique: mocks.erasureFind },
  }),
  getUserDataConsent: mocks.consent,
  listVcRecapSessionsForUser: mocks.voice,
  listVcRecapTranscriptSegmentsForUser: mocks.transcript,
  deleteUserVoiceData: mocks.deleteVoice,
  requestVcRecapErasure: mocks.erasure,
  setVcRecapOpenAiAudioConsent: mocks.openAiConsent,
  setVoiceTranscriptionConsent: mocks.revokeVoice,
  createVcRecapErasureCase: mocks.erasureCaseCreate,
  isVcRecapErasureTicketLinkEnabled: mocks.ticketLinkEnabled,
}));
vi.mock('../plugins/tickets-core.js', () => ({
  buildTicketErasureCreatePayload: mocks.buildErasurePayload,
}));
vi.mock('../plugins/tickets-outbox-repository.js', () => ({
  enqueueTicketPayloads: mocks.enqueue,
}));
vi.mock('../voice/vc-recap-session-manager.js', () => ({
  revokeVcRecapConsent: mocks.revokeActive,
}));
import { privacyCommand } from './privacy.js';
describe('privacy export', () => {
  it('exports the invoking user MBTI history across guilds without access tokens', async () => {
    const rows = [
      { id: 'first', guildId: 'guild-a', resultType: 'INFP' },
      { id: 'second', guildId: 'guild-b', resultType: 'ENFP' },
    ];
    mocks.findMany.mockResolvedValue(rows);
    mocks.newConsentFind.mockResolvedValueOnce([
      {
        purpose: 'openai_audio_processing',
        policyVersion: 'vc-recap-openai-audio-2026-10-31-v1',
        consentedAt: new Date('2026-10-31T01:00:00Z'),
        revokedAt: null,
        updatedAt: new Date('2026-10-31T01:00:00Z'),
      },
    ]);
    mocks.erasureFind.mockResolvedValueOnce(null);
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
    expect(mocks.newConsentFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'owner-user' } }),
    );
    expect(exported.explicitVoiceConsents).toEqual([
      {
        purpose: 'openai_audio_processing',
        policyVersion: 'vc-recap-openai-audio-2026-10-31-v1',
        consentedAt: '2026-10-31T01:00:00.000Z',
        revokedAt: null,
        updatedAt: '2026-10-31T01:00:00.000Z',
      },
    ]);
    expect(exported.voiceErasureRequest).toBeNull();
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
    mocks.revokeVoice.mockImplementationOnce(async () => {
      order.push('revoke-voice');
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
    expect(order).toEqual(['erase-barrier', 'delete-postgres', 'revoke-voice']);
    expect(mocks.revokeVoice).toHaveBeenCalledWith(expect.anything(), 'owner-user', false);
    expect(mocks.erasure).toHaveBeenCalledWith(expect.anything(), 'owner-user');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('VC要約データの削除') }),
    );
    const notice = interaction.reply.mock.calls[0]![0].content as string;
    expect(notice).toContain('PostgreSQL');
    expect(notice).toContain('完全削除完了通知ではありません');
    expect(notice).toContain('バックアップ');
    expect(notice).toContain('削除障壁');
  });
});

describe('privacy delete-voice-data (チケット連携フラグ ON・方式B)', () => {
  function ticketedInteraction(overrides: Record<string, unknown> = {}) {
    return {
      user: { id: 'owner-user', username: 'owner', displayName: 'Owner' },
      guildId: 'guild-1',
      options: {
        getSubcommand: () => 'delete-voice-data',
        getString: () => null,
      },
      reply: vi.fn(),
      ...overrides,
    };
  }

  it('fence と同意失効は即時に効かせ、PG 削除は実行せずケース登録と起票を行う', async () => {
    mocks.ticketLinkEnabled.mockReturnValueOnce(true);
    mocks.deleteVoice.mockClear();
    mocks.enqueue.mockClear();
    mocks.buildErasurePayload.mockClear();
    const order: string[] = [];
    mocks.erasure.mockImplementationOnce(async () => {
      order.push('fence');
    });
    mocks.erasureCaseCreate.mockImplementationOnce(async () => {
      order.push('case');
      return { created: true, erasureCase: { requestId: 'req-new' } };
    });
    mocks.enqueue.mockImplementationOnce(async () => {
      order.push('enqueue');
      return 1;
    });
    mocks.revokeVoice.mockImplementationOnce(async () => {
      order.push('consent-off');
    });
    const interaction = ticketedInteraction({
      options: {
        getSubcommand: () => 'delete-voice-data',
        getString: () => ' 退会のため ',
      },
    });
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(order).toEqual(['fence', 'case', 'enqueue', 'consent-off']);
    // 承認前に PG 削除は実行されない。
    expect(mocks.deleteVoice).not.toHaveBeenCalled();
    expect(mocks.erasure).toHaveBeenCalledWith(expect.anything(), 'owner-user');
    expect(mocks.erasureCaseCreate).toHaveBeenCalledWith(expect.anything(), {
      userId: 'owner-user',
      guildId: 'guild-1',
      reason: '退会のため',
    });
    expect(mocks.buildErasurePayload).toHaveBeenCalledWith({
      requestId: 'req-new',
      discordUserId: 'owner-user',
      requesterName: 'Owner',
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), 'guild-1', [
      expect.objectContaining({ kind: 'create' }),
    ]);
    const notice = interaction.reply.mock.calls[0]![0].content as string;
    expect(notice).toContain('削除申請を受け付けました');
    expect(notice).toContain('req-new');
    expect(notice).toContain('承認の後に実行されます');
  });

  it('未完了ケースがある間は新規の起票をせず、既存の申請を案内する', async () => {
    mocks.ticketLinkEnabled.mockReturnValueOnce(true);
    mocks.deleteVoice.mockClear();
    mocks.enqueue.mockClear();
    mocks.erasureCaseCreate.mockResolvedValueOnce({
      created: false,
      erasureCase: { requestId: 'req-open' },
    });
    const interaction = ticketedInteraction();
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(mocks.deleteVoice).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    const notice = interaction.reply.mock.calls[0]![0].content as string;
    expect(notice).toContain('既に受け付けています');
    expect(notice).toContain('req-open');
  });

  it('Guild 外 (DM) では起票を登録しないが、申請自体は受け付ける', async () => {
    mocks.ticketLinkEnabled.mockReturnValueOnce(true);
    mocks.enqueue.mockClear();
    mocks.erasureCaseCreate.mockResolvedValueOnce({
      created: true,
      erasureCase: { requestId: 'req-dm' },
    });
    const interaction = ticketedInteraction({ guildId: null });
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.erasureCaseCreate).toHaveBeenCalledWith(expect.anything(), {
      userId: 'owner-user',
      guildId: null,
      reason: null,
    });
    const notice = interaction.reply.mock.calls[0]![0].content as string;
    expect(notice).toContain('削除申請を受け付けました');
    expect(notice).toContain('req-dm');
  });
});

describe('openai-audio-consent', () => {
  it('withdraws only OpenAI consent, not legacy AWS capture or voice retention', async () => {
    mocks.revokeActive.mockClear();
    mocks.revokeVoice.mockClear();
    const interaction = {
      user: { id: 'owner-user' },
      options: { getSubcommand: () => 'openai-audio-consent', getBoolean: () => false },
      reply: vi.fn(),
    };
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(mocks.openAiConsent).toHaveBeenCalledWith(expect.anything(), 'owner-user', false);
    expect(mocks.revokeActive).not.toHaveBeenCalled();
    expect(mocks.revokeVoice).not.toHaveBeenCalled();
  });

  it('requires an explicit user action and does not reuse legacy consent', async () => {
    const interaction = {
      user: { id: 'owner-user' },
      options: {
        getSubcommand: () => 'openai-audio-consent',
        getBoolean: () => true,
      },
      reply: vi.fn(),
    };
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(mocks.openAiConsent).toHaveBeenCalledWith(expect.anything(), 'owner-user', true);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('OpenAI') }),
    );
  });

  it('refuses explicit opt-in while a prior erasure is pending', async () => {
    mocks.openAiConsent.mockResolvedValueOnce(false);
    const interaction = {
      user: { id: 'owner-user' },
      options: {
        getSubcommand: () => 'openai-audio-consent',
        getBoolean: () => true,
      },
      reply: vi.fn(),
    };
    await privacyCommand.execute(interaction as unknown as ChatInputCommandInteraction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('登録できません') }),
    );
  });
});
