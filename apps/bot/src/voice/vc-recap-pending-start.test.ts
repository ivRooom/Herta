import type { Logger } from '@herta/logger';
import type { PrismaClient } from '@herta/db';
import type { VoiceBasedChannel } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVoiceTranscriptionConsentMap: vi.fn(),
  applyAutoConsentRoles: vi.fn(),
  splitVcRecapParticipants: vi.fn(),
  startVcRecapSession: vi.fn(),
  failVcRecapSession: vi.fn(),
  joinVoiceChannel: vi.fn(),
  entersState: vi.fn(),
}));

vi.mock('@herta/db', () => ({
  addVcRecapSessionParticipant: vi.fn(),
  appendVcRecapLocalWhisperSegmentIfConsented: vi.fn(),
  appendVcRecapTranscriptSegment: vi.fn(),
  completeVcRecapSession: vi.fn(),
  failVcRecapSession: mocks.failVcRecapSession,
  getVoiceTranscriptRetentionUserIds: vi.fn(),
  getVoiceTranscriptionConsentMap: mocks.getVoiceTranscriptionConsentMap,
  applyAutoConsentRoles: mocks.applyAutoConsentRoles,
  listVcRecapTranscriptSegments: vi.fn(),
  startVcRecapSession: mocks.startVcRecapSession,
}));
vi.mock('@discordjs/voice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discordjs/voice')>()),
  joinVoiceChannel: mocks.joinVoiceChannel,
  entersState: mocks.entersState,
}));
vi.mock('./vc-recap-participants.js', () => ({
  splitVcRecapParticipants: mocks.splitVcRecapParticipants,
}));

const { activeVcRecapChannelId, isVcRecapActive, revokeVcRecapConsent, startVcRecap, stopVcRecap } =
  await import('./vc-recap-session-manager.js');

function makeChannel(guildId = 'guild-1') {
  const member = { id: 'user-1', user: { bot: false }, roles: { cache: new Map() } };
  const members = new Map([[member.id, member]]);
  const humans = {
    size: 1,
    keys: () => members.keys(),
    map: (fn: (value: typeof member) => unknown) => [...members.values()].map(fn),
  };
  const speaking = { on: vi.fn(), off: vi.fn() };
  const connection = { on: vi.fn(), destroy: vi.fn(), receiver: { speaking } };
  const channel = {
    id: 'voice-1',
    guild: {
      id: guildId,
      voiceAdapterCreator: vi.fn(),
      members: { fetch: vi.fn() },
    },
    members: { filter: vi.fn(() => humans) },
  };
  mocks.joinVoiceChannel.mockReturnValue(connection);
  return { channel: channel as unknown as VoiceBasedChannel, humans, connection, speaking };
}

function deferredNotice() {
  let resolve!: () => void;
  const announce = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  return { announce, done: () => resolve() };
}

const prisma = {} as PrismaClient;
const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVoiceTranscriptionConsentMap.mockResolvedValue(new Map([['user-1', true]]));
  mocks.applyAutoConsentRoles.mockImplementation((consent: unknown) => consent);
  mocks.splitVcRecapParticipants.mockReturnValue({
    consentingUserIds: ['user-1'],
    nonConsentingUserIds: [],
  });
  mocks.startVcRecapSession.mockResolvedValue({ id: 'session-1' });
  mocks.failVcRecapSession.mockResolvedValue(undefined);
  mocks.entersState.mockResolvedValue(undefined);
});

describe('pending VC Recap start fail-closed after Discord announcement', () => {
  it('stops a pending start before any speaking subscription', async () => {
    const { channel, connection, speaking } = makeChannel();
    const notice = deferredNotice();
    const starting = startVcRecap(prisma, logger, channel, 'user-1', [], notice.announce);
    await vi.waitFor(() => expect(notice.announce).toHaveBeenCalledTimes(1));
    expect(activeVcRecapChannelId('guild-1')).toBe('voice-1');
    expect(isVcRecapActive('guild-1')).toBe(false);

    expect(await stopVcRecap(prisma, logger, 'guild-1')).toEqual({
      status: 'start_cancelled',
    });
    notice.done();
    expect(await starting).toEqual({ status: 'start_cancelled' });
    expect(speaking.on).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.failVcRecapSession).toHaveBeenCalledWith(prisma, 'session-1');
    expect(activeVcRecapChannelId('guild-1')).toBe(null);
  });

  it('allows a fresh start after cancelling a pending announcement', async () => {
    const { channel, connection, speaking } = makeChannel();
    const notice = deferredNotice();
    const firstStart = startVcRecap(prisma, logger, channel, 'user-1', [], notice.announce);
    await vi.waitFor(() => expect(notice.announce).toHaveBeenCalledTimes(1));

    expect(await stopVcRecap(prisma, logger, 'guild-1')).toEqual({
      status: 'start_cancelled',
    });
    notice.done();
    expect(await firstStart).toEqual({ status: 'start_cancelled' });
    expect(speaking.on).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(activeVcRecapChannelId('guild-1')).toBe(null);

    // The cancelled attempt must release the guild reservation; its stale
    // cancellation flag must not suppress a new, independently consented start.
    const nextAnnouncement = vi.fn().mockResolvedValue(undefined);
    const nextStart = await startVcRecap(prisma, logger, channel, 'user-1', [], nextAnnouncement);
    expect(nextStart).toMatchObject({ status: 'started' });
    expect(nextAnnouncement).toHaveBeenCalledTimes(1);
    expect(speaking.on).toHaveBeenCalledTimes(1);
  });

  it('does not send a start notice when stopped during voice connection readiness', async () => {
    const { channel, connection, speaking } = makeChannel();
    let markReady!: () => void;
    mocks.entersState.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          markReady = resolve;
        }),
    );
    const announce = vi.fn().mockResolvedValue(undefined);
    const starting = startVcRecap(prisma, logger, channel, 'user-1', [], announce);
    await vi.waitFor(() => expect(mocks.entersState).toHaveBeenCalledTimes(1));

    expect(await stopVcRecap(prisma, logger, 'guild-1')).toEqual({
      status: 'start_cancelled',
    });
    markReady();
    expect(await starting).toEqual({ status: 'start_cancelled' });
    expect(announce).not.toHaveBeenCalled();
    expect(speaking.on).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('revoking a pending participant prevents starting transcription', async () => {
    const { channel, speaking } = makeChannel();
    const notice = deferredNotice();
    const starting = startVcRecap(prisma, logger, channel, 'user-1', [], notice.announce);
    await vi.waitFor(() => expect(notice.announce).toHaveBeenCalledTimes(1));
    revokeVcRecapConsent('user-1');
    notice.done();

    expect(await starting).toEqual({ status: 'start_cancelled' });
    expect(speaking.on).not.toHaveBeenCalled();
  });

  it('last human departure during announcement prevents capture', async () => {
    const { channel, humans, speaking } = makeChannel();
    const notice = deferredNotice();
    const starting = startVcRecap(prisma, logger, channel, 'user-1', [], notice.announce);
    await vi.waitFor(() => expect(notice.announce).toHaveBeenCalledTimes(1));
    humans.size = 0;
    notice.done();

    expect(await starting).toEqual({ status: 'start_cancelled' });
    expect(speaking.on).not.toHaveBeenCalled();
  });

  it('unrelated revoke cannot cancel another guild pending start', async () => {
    const { channel, speaking } = makeChannel('guild-unrelated');
    let finishConsent!: (consents: Map<string, boolean>) => void;
    mocks.getVoiceTranscriptionConsentMap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishConsent = resolve;
        }),
    );
    const announce = vi.fn().mockResolvedValue(undefined);
    const starting = startVcRecap(prisma, logger, channel, 'user-1', [], announce);
    await vi.waitFor(() => expect(mocks.getVoiceTranscriptionConsentMap).toHaveBeenCalledTimes(1));
    revokeVcRecapConsent('different-user');
    finishConsent(new Map([['user-1', true]]));

    expect(await starting).toMatchObject({ status: 'started' });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(speaking.on).toHaveBeenCalledWith('start', expect.any(Function));
  });
});
