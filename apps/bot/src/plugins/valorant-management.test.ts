import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, type ButtonInteraction } from 'discord.js';
import { valorantPlugin } from './valorant.js';
import {
  manageValorantParticipants,
  VALORANT_SESSION_PREFIX,
} from './valorant-session-repository.js';

vi.mock('./valorant-pick-card.js', () => ({
  renderValorantPickCard: vi.fn(async () => Buffer.from('test-image')),
}));
vi.mock('./valorant-session-repository.js', async (loadOriginal) => {
  const actual = await loadOriginal<typeof import('./valorant-session-repository.js')>();
  return { ...actual, manageValorantParticipants: vi.fn() };
});

const guildId = '999999999999999999';
const channelId = '888888888888888888';
const voiceChannelId = '777777777777777777';
const sessionId = 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05';
const a = '111111111111111111';
const b = '222222222222222222';
const c = '333333333333333333';

function harness() {
  const participants: { userId: string }[] = [];
  const session = {
    id: sessionId,
    guildId,
    channelId,
    messageId: 'posted-message',
    voiceChannelId,
    creatorId: 'creator',
    status: 'OPEN',
    optedOutUserIds: [],
    participants,
    maxParticipants: 1,
    expiresAt: new Date(Date.now() + 60_000),
  };
  let voiceIds = [a, b];
  const memberFetch = vi.fn(async (userId: string) => ({
    id: userId,
    user: { id: userId, bot: false },
    voice: { channelId: voiceChannelId },
  }));
  const guild = {
    voiceStates: {
      cache: {
        values: () => voiceIds.map((id) => ({ id, channelId: voiceChannelId })).values(),
      },
    },
    channels: {
      fetch: vi.fn(async () => ({
        type: ChannelType.GuildVoice,
        isVoiceBased: () => true,
      })),
    },
    members: { fetch: memberFetch },
  };
  const findFirst = vi.fn(async () => session);
  const context = {
    prisma: { valorantPickSession: { findFirst } },
    logger: { error: vi.fn(), warn: vi.fn() },
  } as unknown as Parameters<NonNullable<typeof valorantPlugin.provideEvents>>[0];
  const events = valorantPlugin.provideEvents!(context);
  const dispatch = events[0]!.handler as unknown as (
    context: unknown,
    interaction: ButtonInteraction,
  ) => Promise<void>;
  const mockInteraction = (action: string, isSelect: boolean, userId = 'creator') => {
    const editReply = vi.fn();
    const value = {
      guildId,
      channelId,
      customId: VALORANT_SESSION_PREFIX + sessionId + ':' + action,
      guild,
      user: { id: userId },
      memberPermissions: null,
      message: { id: 'ephemeral-message', flags: { has: () => true } },
      values: isSelect ? [a] : [],
      isButton: () => !isSelect,
      isUserSelectMenu: () => isSelect,
      isStringSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      deferReply: vi.fn(),
      editReply,
    };
    return { interaction: value as unknown as ButtonInteraction, editReply };
  };
  const digest = () =>
    createHash('sha256')
      .update(JSON.stringify([sessionId, voiceChannelId, [...voiceIds], [], []]))
      .digest('hex')
      .slice(0, 12);
  return {
    session,
    memberFetch,
    findFirst,
    mockInteraction,
    digest,
    setVoiceIds: (ids: string[]) => {
      voiceIds = ids;
    },
    dispatch: (interaction: ButtonInteraction) => dispatch(context, interaction),
  };
}

describe('VALORANT VC member overflow confirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT write DB on select; requires subsequent button confirmation', async () => {
    const h = harness();
    const { interaction, editReply } = h.mockInteraction('vc-choose-' + h.digest(), true);
    await h.dispatch(interaction);
    expect(manageValorantParticipants).not.toHaveBeenCalled();
    const message = editReply.mock.calls[0]![0];
    expect(message.content).toContain('最終確認');
    expect(message.content).toContain('<@' + a + '>');
    const button = message.components[0].toJSON().components[0] as { custom_id: string };
    expect(button.custom_id).toContain(':vc-stage-');
    expect(button.custom_id.length).toBeLessThanOrEqual(100);

    vi.mocked(manageValorantParticipants).mockResolvedValue({
      status: 'ok',
      session: h.session,
      changed: false,
    } as unknown as Awaited<ReturnType<typeof manageValorantParticipants>>);
    const confirm = h.mockInteraction(button.custom_id.split(':').at(-1)!, false);
    await h.dispatch(confirm.interaction);
    expect(manageValorantParticipants).toHaveBeenCalledOnce();
    expect(manageValorantParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'bulk',
        targetIds: [a],
        guildId,
        expectedVoiceChannelId: voiceChannelId,
      }),
    );
  });

  it('rejects stale VC candidate selection when voice membership changes', async () => {
    const h = harness();
    const select = h.mockInteraction('vc-choose-' + h.digest(), true);
    await h.dispatch(select.interaction);
    const selectedButton = select.editReply.mock.calls[0]![0].components[0].toJSON()
      .components[0] as { custom_id: string };
    const staged = selectedButton.custom_id.split(':').at(-1)!;
    h.setVoiceIds([b, c]);
    const confirm = h.mockInteraction(staged, false);
    await h.dispatch(confirm.interaction);
    expect(confirm.editReply).toHaveBeenCalledWith(expect.stringContaining('再取得'));
    expect(manageValorantParticipants).not.toHaveBeenCalled();
  });

  it('rejects management controls for a non-manager and expired sessions', async () => {
    const h = harness();
    const guest = h.mockInteraction('vc-choose-' + h.digest(), true, 'guest');
    await h.dispatch(guest.interaction);
    expect(guest.editReply).toHaveBeenCalledWith(expect.stringContaining('募集作成者'));
    h.session.expiresAt = new Date(Date.now() - 1000);
    const creator = h.mockInteraction('vc-choose-' + h.digest(), true);
    await h.dispatch(creator.interaction);
    expect(creator.editReply).toHaveBeenCalledWith(expect.stringContaining('期限切れ'));
    expect(manageValorantParticipants).not.toHaveBeenCalled();
  });
});
