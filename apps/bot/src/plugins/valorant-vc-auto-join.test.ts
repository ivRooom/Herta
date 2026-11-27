import { beforeEach, describe, expect, it, vi } from 'vitest';
import { valorantPlugin } from './valorant.js';
import {
  autoJoinValorantSession,
  findOpenValorantAutoJoinSessions,
  type ValorantAutoJoinResult,
  type ValorantSessionSnapshot,
} from './valorant-session-repository.js';

vi.mock('./valorant-pick-card.js', () => ({
  renderValorantPickCard: vi.fn(async () => Buffer.from('mock-image')),
}));

vi.mock('./valorant-session-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./valorant-session-repository.js')>();
  return {
    ...actual,
    findOpenValorantAutoJoinSessions: vi.fn(),
    autoJoinValorantSession: vi.fn(),
  };
});

const GUILD_ID = 'guild';
const VOICE_CHANNEL_ID = '123456789012345678';
const USER_ID = '111111111111111111';

const findMock = vi.mocked(findOpenValorantAutoJoinSessions);
const autoJoinMock = vi.mocked(autoJoinValorantSession);

function sessionFixture(overrides: Record<string, unknown> = {}): ValorantSessionSnapshot {
  return {
    id: 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05',
    guildId: GUILD_ID,
    channelId: 'channel',
    messageId: 'posted-message',
    creatorId: 'owner',
    status: 'OPEN',
    mode: 'RANDOM',
    mapId: null,
    voiceChannelId: VOICE_CHANNEL_ID,
    optedOutUserIds: [],
    trollOffUserIds: [],
    vcAutoJoin: true,
    maxParticipants: 5,
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    rulesVersion: 'fisher-yates-v1',
    candidates: [],
    result: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    participants: [],
    ...overrides,
  } as unknown as ValorantSessionSnapshot;
}

function voiceState(
  channelId: string | null,
  user: { id: string; bot?: boolean } = { id: USER_ID },
) {
  return { channelId, member: { user: { id: user.id, bot: user.bot ?? false } } };
}

function makeContext(config: Record<string, unknown> = { enabled: true }) {
  const edit = vi.fn().mockResolvedValue({});
  const messageFetch = vi.fn().mockResolvedValue({ edit });
  const channelFetch = vi
    .fn()
    .mockResolvedValue({ isTextBased: () => true, messages: { fetch: messageFetch } });
  const guildFetch = vi.fn().mockResolvedValue({ channels: { fetch: channelFetch } });
  const context = {
    config,
    guildId: GUILD_ID,
    client: { guilds: { fetch: guildFetch } },
    prisma: { guildPlugin: { findUnique: vi.fn().mockResolvedValue(null) } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { context, edit, messageFetch, channelFetch, guildFetch };
}

type TestContext = ReturnType<typeof makeContext>['context'];

async function dispatch(context: TestContext, oldState: unknown, newState: unknown): Promise<void> {
  const events = valorantPlugin.provideEvents!(
    context as unknown as Parameters<NonNullable<typeof valorantPlugin.provideEvents>>[0],
  );
  const entry = events.find((item) => item.event === 'voiceStateUpdate');
  if (!entry) throw new Error('voiceStateUpdate handler is not registered');
  await entry.handler(
    context as unknown as Parameters<typeof entry.handler>[0],
    oldState,
    newState,
  );
}

function joinedResult(session: ValorantSessionSnapshot): ValorantAutoJoinResult {
  return { status: 'ok', session, changed: true, becameFull: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMock.mockResolvedValue([sessionFixture()]);
  autoJoinMock.mockResolvedValue(
    joinedResult(sessionFixture({ participants: [{ userId: USER_ID }] })),
  );
});

describe('VALORANT VC auto-join voiceStateUpdate handler (#1048)', () => {
  it('registers a member who joins the pinned VC and refreshes the recruitment embed', async () => {
    const { context, edit } = makeContext();
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    expect(findMock).toHaveBeenCalledWith(context.prisma, GUILD_ID, VOICE_CHANNEL_ID);
    expect(autoJoinMock).toHaveBeenCalledWith(context.prisma, {
      guildId: GUILD_ID,
      id: 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05',
      userId: USER_ID,
      voiceChannelId: VOICE_CHANNEL_ID,
    });
    expect(edit).toHaveBeenCalledOnce();
    const payload = edit.mock.calls[0]![0] as {
      embeds: Array<{ data: { description?: string } }>;
    };
    expect(payload.embeds[0]!.data.description).toContain('VC自動参加：ON');
    expect(payload.embeds[0]!.data.description).toContain('<@' + USER_ID + '>');
  });

  it('does nothing when a participant leaves the VC (participation is kept)', async () => {
    const { context, edit } = makeContext();
    await dispatch(context, voiceState(VOICE_CHANNEL_ID), voiceState(null));
    expect(findMock).not.toHaveBeenCalled();
    expect(autoJoinMock).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('ignores joins to other voice channels and leaves from other channels', async () => {
    const { context, edit } = makeContext();
    findMock.mockResolvedValue([]);
    await dispatch(context, voiceState(null), voiceState('999999999999999999'));
    await dispatch(context, voiceState('999999999999999999'), voiceState(null));
    expect(autoJoinMock).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('does not touch the DB for in-channel state changes such as mute toggles', async () => {
    const { context } = makeContext();
    await dispatch(context, voiceState(VOICE_CHANNEL_ID), voiceState(VOICE_CHANNEL_ID));
    expect(findMock).not.toHaveBeenCalled();
    expect(autoJoinMock).not.toHaveBeenCalled();
  });

  it('treats a channel move into the pinned VC as a join', async () => {
    const { context, edit } = makeContext();
    await dispatch(context, voiceState('999999999999999999'), voiceState(VOICE_CHANNEL_ID));
    expect(autoJoinMock).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledOnce();
  });

  it('ignores bot members even if one reaches the handler', async () => {
    const { context } = makeContext();
    await dispatch(
      context,
      voiceState(null, { id: '222222222222222222', bot: true }),
      voiceState(VOICE_CHANNEL_ID, { id: '222222222222222222', bot: true }),
    );
    expect(findMock).not.toHaveBeenCalled();
    expect(autoJoinMock).not.toHaveBeenCalled();
  });

  it('writes nothing when no auto-join session targets the channel', async () => {
    const { context, edit } = makeContext();
    findMock.mockResolvedValue([]);
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    expect(autoJoinMock).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('does not refresh the embed when the member is opted out, full, or already joined', async () => {
    const { context, edit } = makeContext();
    autoJoinMock.mockResolvedValue({ status: 'opted_out' });
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    autoJoinMock.mockResolvedValue({ status: 'full' });
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    autoJoinMock.mockResolvedValue({
      status: 'ok',
      session: sessionFixture({ participants: [{ userId: USER_ID }] }),
      changed: false,
      becameFull: false,
    });
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    expect(autoJoinMock).toHaveBeenCalledTimes(3);
    expect(edit).not.toHaveBeenCalled();
  });

  it('registers the member into every open auto-join session pinned to the same VC', async () => {
    const { context, edit } = makeContext();
    const second = sessionFixture({ id: 'd0d0d0d0-abab-4c4c-8c8c-505050505050' });
    findMock.mockResolvedValue([sessionFixture(), second]);
    autoJoinMock.mockImplementation(async (_prisma, input) =>
      joinedResult(sessionFixture({ id: input.id, participants: [{ userId: USER_ID }] })),
    );
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    expect(autoJoinMock).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it('keeps the DB registration even when the Discord message edit fails', async () => {
    const { context, guildFetch } = makeContext();
    guildFetch.mockRejectedValue(new Error('discord unavailable'));
    await expect(
      dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID)),
    ).resolves.toBeUndefined();
    expect(autoJoinMock).toHaveBeenCalledOnce();
    expect(context.logger.warn).toHaveBeenCalled();
  });

  it('does nothing while the plugin is disabled for the guild', async () => {
    const { context } = makeContext({ enabled: false });
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    expect(findMock).not.toHaveBeenCalled();
    expect(autoJoinMock).not.toHaveBeenCalled();
  });

  it('continues with the next session when one registration fails', async () => {
    const { context, edit } = makeContext();
    const second = sessionFixture({ id: 'd0d0d0d0-abab-4c4c-8c8c-505050505050' });
    findMock.mockResolvedValue([sessionFixture(), second]);
    autoJoinMock
      .mockRejectedValueOnce(new Error('db conflict'))
      .mockResolvedValue(
        joinedResult(sessionFixture({ id: second.id, participants: [{ userId: USER_ID }] })),
      );
    await dispatch(context, voiceState(null), voiceState(VOICE_CHANNEL_ID));
    expect(autoJoinMock).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledOnce();
    expect(context.logger.warn).toHaveBeenCalled();
  });
});
