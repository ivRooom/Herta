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

/** Work in bounded, idempotent transactions; never delete completed draw sessions. */
export async function anonymizeOldValorantSessions(
  prisma: PrismaClient,
  now = new Date(),
  batchSize = 50,
): Promise<number> {
  const cutoff = new Date(now.getTime() - VALORANT_USER_ID_RETENTION_DAYS * 86_400_000);
  const sessions = await prisma.valorantPickSession.findMany({
    where: {
      status: { in: TERMINAL },
      createdAt: { lt: cutoff },
      creatorId: { not: REDACTED },
    },
    select: { id: true, guildId: true, result: true },
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
          ...(session.result === null
            ? {}
            : { result: JSON.parse(JSON.stringify(redactValorantIdentifiers(session.result))) }),
        },
      });
      if (update.count !== 1) return false;
      await tx.valorantPickParticipant.deleteMany({ where: { sessionId: session.id } });
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
