import type { TeamSplitSessionRecord } from '@herta/plugin-catalog/team-split-service';

export type PublicTeamSplitSession = Omit<TeamSplitSessionRecord, 'seedHash'>;

export function toPublicTeamSplitSession(
  session: TeamSplitSessionRecord,
): PublicTeamSplitSession {
  const { seedHash: _seedHash, ...publicSession } = session;
  return publicSession;
}
