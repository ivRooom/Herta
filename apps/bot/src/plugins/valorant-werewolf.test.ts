import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./valorant-pick-card.js', () => ({
  renderValorantPickCard: vi.fn(async () => Buffer.from('png')),
}));

const repoMocks = vi.hoisted(() => ({
  getValorantWerewolfState: vi.fn(),
  getValorantWerewolfVoteProgress: vi.fn(),
  getValorantWerewolfRevealed: vi.fn(),
  getValorantWerewolfSecretForUser: vi.fn(),
  markValorantWerewolfSecretViewed: vi.fn(),
  openValorantWerewolfVote: vi.fn(),
  castValorantWerewolfVote: vi.fn(),
  abortValorantWerewolfGame: vi.fn(),
}));
vi.mock('./valorant-werewolf-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./valorant-werewolf-repository.js')>();
  return { ...actual, ...repoMocks };
});

const serviceMocks = vi.hoisted(() => ({
  startValorantWerewolf: vi.fn(),
  closeValorantWerewolfRoundAndSettle: vi.fn(),
  retryValorantWerewolfPunishment: vi.fn(),
}));
vi.mock('./valorant-werewolf-service.js', () => ({ ...serviceMocks }));

const sessionMocks = vi.hoisted(() => ({
  getValorantSession: vi.fn(),
  mutateValorantSession: vi.fn(),
}));
vi.mock('./valorant-session-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./valorant-session-repository.js')>();
  return { ...actual, ...sessionMocks };
});

import { valorantPlugin } from './valorant.js';

const GUILD_ID = '964326043420872704';
const CHANNEL_ID = '555555555555555555';
const SESSION_ID = 'cfc92874-f6ab-4a68-9acf-c5ecc5010a05';
const CREATOR_ID = '111111111111111111';
const WEREWOLF_ID = '222222222222222222';
const CITIZEN_ID = '333333333333333333';
const CANARY_TEXT = 'SECRET_TROLL_CANARY_TEXT';
const CANARY_TROLL = {
  itemId: 'troll-item-canary',
  text: CANARY_TEXT,
  rarity: 'rare',
  category: 'settings',
} as const;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function sessionFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: SESSION_ID,
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    messageId: 'message-1',
    creatorId: CREATOR_ID,
    mode: 'WEREWOLF',
    mapId: null,
    status: 'IN_PROGRESS',
    maxParticipants: 5,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    voiceChannelId: null,
    vcAutoJoin: false,
    trollOffUserIds: [] as string[],
    rulesVersion: 'werewolf-v1',
    result: null,
    candidates: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    participants: [
      { userId: CREATOR_ID, joinedAt: now },
      { userId: WEREWOLF_ID, joinedAt: now },
      { userId: CITIZEN_ID, joinedAt: now },
    ],
    ...overrides,
  };
}

function gameFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    sessionId: SESSION_ID,
    phase: 'PLAYING',
    rosterSnapshot: [
      { userId: CREATOR_ID, displayName: 'Alice' },
      { userId: WEREWOLF_ID, displayName: 'Bob' },
      { userId: CITIZEN_ID, displayName: 'Carol' },
    ],
    currentRound: 0,
    currentCandidateUserIds: [] as string[],
    roundHistory: [],
    firstRoundTally: null,
    voteEndsAt: null,
    assignmentStatus: 'READY',
    assignmentErrorCode: null,
    outcome: null,
    outcomeReason: null,
    accusedUserId: null,
    punishmentUserId: null,
    punishmentStatus: 'NONE',
    punishmentDrawId: null,
    punishmentItemId: null,
    punishmentText: null,
    punishmentRarity: null,
    punishmentCategory: null,
    revealedTrollItemId: null,
    revealedTrollText: null,
    revealedTrollRarity: null,
    revealedTrollCategory: null,
    startedAt: now,
    resolvedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function prismaFixture(
  config: Record<string, unknown> = { enabled: true, trollWerewolfEnabled: true },
) {
  return {
    guildPlugin: {
      findUnique: vi.fn(async () => ({ enabled: true, config })),
    },
    valorantPickSession: {
      create: vi.fn(async () => sessionFixture({ status: 'OPEN' })),
      update: vi.fn(async () => sessionFixture({ status: 'OPEN' })),
    },
  };
}

function contextWith(prisma: unknown) {
  return { config: { enabled: true }, prisma, logger } as never;
}

async function dispatchCommand(context: unknown, interaction: unknown) {
  const commands = await valorantPlugin.provideCommands?.(context as never);
  await commands?.[0]?.execute(interaction as never);
}

async function dispatchInteraction(context: unknown, interaction: unknown) {
  const events = (await valorantPlugin.provideEvents?.(context as never)) ?? [];
  const entry = events.find((event) => event.event === 'interactionCreate');
  await entry?.handler(context as never, interaction as never);
}

function commandInteraction(prismaConfig?: Record<string, unknown>) {
  const editReply = vi.fn(async (_payload: unknown) => ({}));
  const followUpPayloads: unknown[] = [];
  return {
    editReply,
    followUpPayloads,
    interaction: {
      isChatInputCommand: () => true,
      isAutocomplete: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      commandName: 'valorant',
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      user: { id: CREATOR_ID },
      appPermissions: null,
      deferred: false,
      replied: false,
      options: {
        getSubcommand: () => 'werewolf',
        getBoolean: () => false,
        getString: () => null,
        getInteger: () => null,
      },
      guild: {
        members: {
          fetch: vi.fn(async () => ({ voice: { channelId: null }, displayName: 'Alice' })),
        },
      },
      deferReply: vi.fn(async () => undefined),
      editReply,
      followUp: vi.fn(async (payload: unknown) => {
        followUpPayloads.push(payload);
        return { id: 'message-1' };
      }),
    },
    prismaConfig,
  };
}

function buttonInteraction(
  action: string,
  userId: string,
  session: ReturnType<typeof sessionFixture>,
) {
  const editReply = vi.fn(async (_payload: unknown) => ({}));
  const publicEdits: unknown[] = [];
  const message = {
    id: session.messageId,
    flags: { has: () => false },
    edit: vi.fn(async (payload: unknown) => {
      publicEdits.push(payload);
      return message;
    }),
  };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: vi.fn(async () => message) },
  };
  return {
    editReply,
    publicEdits,
    interaction: {
      isChatInputCommand: () => false,
      isAutocomplete: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      customId: `herta:valorant:pick:v1:${SESSION_ID}:${action}`,
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      user: { id: userId },
      memberPermissions: { has: () => false },
      message,
      guild: {
        channels: { fetch: vi.fn(async () => channel) },
        members: {
          cache: { get: vi.fn(() => undefined) },
          fetch: vi.fn(async (id: string) => ({ displayName: `Member-${id.slice(0, 4)}` })),
        },
      },
      deferReply: vi.fn(async () => undefined),
      editReply,
    },
  };
}

function selectInteraction(userId: string, targetUserId: string, round = 1) {
  const editReply = vi.fn(async (_payload: unknown) => ({}));
  const base = buttonInteraction(`wolf-vote-cast-${round}`, userId, sessionFixture());
  return {
    editReply,
    interaction: {
      ...base.interaction,
      isButton: () => false,
      isStringSelectMenu: () => true,
      values: [targetUserId],
      editReply,
    },
  };
}

function replyTexts(editReply: ReturnType<typeof vi.fn>): string {
  return editReply.mock.calls
    .map((call) => {
      const payload = call[0] as unknown;
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    })
    .join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  repoMocks.getValorantWerewolfState.mockResolvedValue({
    session: sessionFixture(),
    game: gameFixture(),
  });
  repoMocks.getValorantWerewolfVoteProgress.mockResolvedValue({
    session: sessionFixture(),
    game: gameFixture({ phase: 'VOTING', currentRound: 1 }),
    votedCount: 1,
    allVoted: false,
  });
  repoMocks.getValorantWerewolfRevealed.mockResolvedValue(null);
  repoMocks.markValorantWerewolfSecretViewed.mockResolvedValue(undefined);
  sessionMocks.getValorantSession.mockResolvedValue(sessionFixture());
});

describe('/valorant werewolf command (#1049)', () => {
  it('creates a WEREWOLF room when the dedicated flag is on', async () => {
    const prisma = prismaFixture();
    const { interaction, editReply, followUpPayloads } = commandInteraction();
    await dispatchCommand(contextWith(prisma), interaction);
    expect(prisma.valorantPickSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'WEREWOLF', rulesVersion: 'werewolf-v1' }),
      }),
    );
    expect(replyTexts(editReply)).toContain('人狼モードの部屋を作成しました');
    const followUp = followUpPayloads[0] as { embeds: { data: { description?: string } }[] };
    expect(followUp.embeds[0]?.data.description).toContain('人狼');
  });

  it('refuses to create a room when trollWerewolfEnabled is off', async () => {
    const prisma = prismaFixture({ enabled: true });
    const { interaction, editReply } = commandInteraction();
    await dispatchCommand(contextWith(prisma), interaction);
    expect(replyTexts(editReply)).toContain('人狼モードは現在無効です');
    expect(prisma.valorantPickSession.create).not.toHaveBeenCalled();
  });
});

describe('wolf-secret secrecy (#1049)', () => {
  it('shows the secret troll only to the werewolf themself', async () => {
    repoMocks.getValorantWerewolfSecretForUser.mockResolvedValue({
      kind: 'werewolf',
      troll: CANARY_TROLL,
    });
    const { interaction, editReply } = buttonInteraction(
      'wolf-secret',
      WEREWOLF_ID,
      sessionFixture(),
    );
    await dispatchInteraction(contextWith(prismaFixture()), interaction);
    expect(replyTexts(editReply)).toContain(CANARY_TEXT);
    expect(repoMocks.markValorantWerewolfSecretViewed).toHaveBeenCalled();
  });

  it('shows citizens and non-participants no secret', async () => {
    repoMocks.getValorantWerewolfSecretForUser.mockResolvedValue({ kind: 'citizen' });
    const citizen = buttonInteraction('wolf-secret', CITIZEN_ID, sessionFixture());
    await dispatchInteraction(contextWith(prismaFixture()), citizen.interaction);
    expect(replyTexts(citizen.editReply)).toContain('秘密の縛りはありません');
    expect(replyTexts(citizen.editReply)).not.toContain(CANARY_TEXT);

    repoMocks.getValorantWerewolfSecretForUser.mockResolvedValue({ kind: 'not_participant' });
    const outsider = buttonInteraction('wolf-secret', '999999999999999999', sessionFixture());
    await dispatchInteraction(contextWith(prismaFixture()), outsider.interaction);
    expect(replyTexts(outsider.editReply)).not.toContain(CANARY_TEXT);
  });
});

describe('public message secrecy (#1049)', () => {
  it('rebuilds the public message without any secret after a join during PLAYING', async () => {
    const session = sessionFixture();
    sessionMocks.mutateValorantSession.mockResolvedValue({
      status: 'ok',
      changed: true,
      session,
    });
    repoMocks.getValorantWerewolfState.mockResolvedValue({
      session,
      game: gameFixture({ phase: 'PLAYING' }),
    });
    const { interaction, publicEdits } = buttonInteraction('join', CITIZEN_ID, session);
    await dispatchInteraction(contextWith(prismaFixture()), interaction);
    expect(publicEdits).toHaveLength(1);
    const serialized = JSON.stringify(publicEdits[0]);
    expect(serialized).not.toContain(CANARY_TEXT);
    expect(serialized).not.toContain('werewolfUserId');
    expect(repoMocks.getValorantWerewolfRevealed).not.toHaveBeenCalled();
  });

  it('rejects normal-draw actions inside a werewolf room', async () => {
    const { interaction, editReply } = buttonInteraction('draw', CREATOR_ID, sessionFixture());
    await dispatchInteraction(contextWith(prismaFixture()), interaction);
    expect(replyTexts(editReply)).toContain('人狼モードでは使えません');
  });
});

describe('voting flow (#1049)', () => {
  it('opens the vote select with only the current candidates', async () => {
    repoMocks.getValorantWerewolfState.mockResolvedValue({
      session: sessionFixture(),
      game: gameFixture({
        phase: 'RUNOFF',
        currentRound: 2,
        currentCandidateUserIds: [CREATOR_ID, WEREWOLF_ID],
      }),
    });
    const { interaction, editReply } = buttonInteraction('wolf-vote', CITIZEN_ID, sessionFixture());
    await dispatchInteraction(contextWith(prismaFixture()), interaction);
    const payload = JSON.parse(JSON.stringify(editReply.mock.calls[0]?.[0])) as {
      components: { components: { options: { value: string }[] }[] }[];
    };
    const options = payload.components[0]?.components[0]?.options ?? [];
    expect(options.map((option) => option.value)).toEqual([CREATOR_ID, WEREWOLF_ID]);
  });

  it('rejects self votes with the dedicated message', async () => {
    repoMocks.castValorantWerewolfVote.mockResolvedValue({ status: 'self_vote' });
    const { interaction, editReply } = selectInteraction(CITIZEN_ID, CITIZEN_ID);
    await dispatchInteraction(contextWith(prismaFixture()), interaction);
    expect(replyTexts(editReply)).toContain('自分には投票できません');
  });

  it('settles automatically when the last vote completes the round', async () => {
    repoMocks.castValorantWerewolfVote.mockResolvedValue({
      status: 'ok',
      changed: true,
      votedCount: 3,
      allVoted: true,
      game: gameFixture({ phase: 'VOTING', currentRound: 1 }),
    });
    serviceMocks.closeValorantWerewolfRoundAndSettle.mockResolvedValue({
      status: 'ok',
      kind: 'resolved',
      session: sessionFixture({ status: 'COMPLETED' }),
    });
    const { interaction, editReply } = selectInteraction(CITIZEN_ID, WEREWOLF_ID);
    await dispatchInteraction(contextWith(prismaFixture()), interaction);
    expect(serviceMocks.closeValorantWerewolfRoundAndSettle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'all_voted' }),
      expect.anything(),
    );
    expect(replyTexts(editReply)).toContain('結果が確定しました');
  });
});
