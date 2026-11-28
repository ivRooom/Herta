import type { PrismaClient } from '@prisma/client';

/** Retain agent-level statistics without retaining permanent Discord user IDs. */
export const VALORANT_USER_ID_RETENTION_DAYS = 90;
const REDACTED = 'redacted';
const TERMINAL = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

/** All nested userId keys are scrubbed; non-identifying agent and score fields remain. */
export function redactValorantIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValorantIdentifiers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'userId')
        .map(([key, child]) => [key, redactValorantIdentifiers(child)]),
    );
  }
  return value;
}

function tallyCountsOnly(value: unknown): number[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.values(value).filter(
    (count): count is number => typeof count === 'number' && Number.isFinite(count),
  );
}

/**
 * Werewolf game snapshots (#1049) with every Discord ID and display name
 * removed. What remains is safe history: roster size, per-round vote
 * count distributions, close reasons, outcome and the troll/punishment
 * texts (not identifiers). Individual vote targets never survive.
 */
export function anonymizeWerewolfGameData(game: {
  rosterSnapshot: unknown;
  roundHistory: unknown;
  firstRoundTally: unknown;
}): { rosterSnapshot: unknown; roundHistory: unknown; firstRoundTally: unknown } {
  const roster = Array.isArray(game.rosterSnapshot) ? game.rosterSnapshot : [];
  const history = Array.isArray(game.roundHistory) ? game.roundHistory : [];
  return {
    rosterSnapshot: { anonymized: true, size: roster.length },
    roundHistory: history.map((entry) => {
      const record =
        typeof entry === 'object' && entry !== null && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};
      return {
        round: typeof record['round'] === 'number' ? record['round'] : 0,
        tally: tallyCountsOnly(record['tally']),
        votedCount: typeof record['votedCount'] === 'number' ? record['votedCount'] : 0,
        rosterSize: typeof record['rosterSize'] === 'number' ? record['rosterSize'] : 0,
        closeReason: typeof record['closeReason'] === 'string' ? record['closeReason'] : 'unknown',
      };
    }),
    firstRoundTally:
      game.firstRoundTally === null || game.firstRoundTally === undefined
        ? null
        : tallyCountsOnly(game.firstRoundTally),
  };
}

/** Work in bounded, idempotent transactions; never delete completed draw sessions. */
export async function anonymizeOldValorantSessions(
  prisma: PrismaClient,
  now = new Date(),
  batchSize = 50,
): Promise<number> {
  const cutoff = new Date(now.getTime() - VALORANT_USER_ID_RETENTION_DAYS * 86_400_000);
  await prisma.valorantPickSession.updateMany({
    where: { status: 'OPEN', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  const sessions = await prisma.valorantPickSession.findMany({
    where: {
      status: { in: TERMINAL },
      createdAt: { lt: cutoff },
      creatorId: { not: REDACTED },
    },
    select: { id: true, guildId: true, result: true, mode: true },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(100, batchSize)),
  });
  let processed = 0;
  for (const session of sessions) {
    const changed = await prisma.$transaction(async (tx) => {
      const update = await tx.valorantPickSession.updateMany({
        where: {
          id: session.id,
          guildId: session.guildId,
          status: { in: TERMINAL },
          creatorId: { not: REDACTED },
        },
        data: {
          creatorId: REDACTED,
          optedOutUserIds: [],
          voiceChannelId: null,
          ...(session.result === null
            ? {}
            : { result: JSON.parse(JSON.stringify(redactValorantIdentifiers(session.result))) }),
        },
      });
      if (update.count !== 1) return false;
      await tx.valorantPickParticipant.deleteMany({ where: { sessionId: session.id } });
      // Portal/Discord operation actor records (#1050, S6-H2) carry the
      // same Discord IDs, so they are anonymized on the same schedule.
      // Guarded for callers whose transaction fake predates the table.
      if (tx.valorantPickSessionAction) {
        await tx.valorantPickSessionAction.updateMany({
          where: { sessionId: session.id, actorUserId: { not: REDACTED } },
          data: { actorUserId: REDACTED },
        });
      }
      if (session.mode === 'WEREWOLF') {
        // Werewolf secrets and votes must not outlive the retention
        // window (#1049): delete both outright and scrub the game's
        // public snapshots down to counts and outcome.
        await tx.valorantWerewolfVote.deleteMany({ where: { sessionId: session.id } });
        await tx.valorantWerewolfSecret.deleteMany({ where: { sessionId: session.id } });
        const game = await tx.valorantWerewolfGame.findUnique({
          where: { sessionId: session.id },
          select: { rosterSnapshot: true, roundHistory: true, firstRoundTally: true },
        });
        if (game) {
          const scrubbed = anonymizeWerewolfGameData(game);
          await tx.valorantWerewolfGame.update({
            where: { sessionId: session.id },
            data: {
              rosterSnapshot: JSON.parse(JSON.stringify(scrubbed.rosterSnapshot)),
              roundHistory: JSON.parse(JSON.stringify(scrubbed.roundHistory)),
              firstRoundTally:
                scrubbed.firstRoundTally === null
                  ? undefined
                  : JSON.parse(JSON.stringify(scrubbed.firstRoundTally)),
              accusedUserId: null,
              punishmentUserId: null,
            },
          });
        }
      }
      const match = await tx.valorantMatchResult.findUnique({
        where: { sessionId: session.id },
        select: { playerResults: true },
      });
      if (match) {
        await tx.valorantMatchResult.update({
          where: { sessionId: session.id },
          data: {
            enteredBy: REDACTED,
            matchId: null,
            playerResults: JSON.parse(
              JSON.stringify(redactValorantIdentifiers(match.playerResults)),
            ),
          },
        });
      }
      return true;
    });
    if (changed) processed++;
  }
  return processed;
}
