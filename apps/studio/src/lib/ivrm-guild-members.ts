import type { GuildMemberOption } from './bot-guild-members.ts';
import { authorizeIvrmIntegrationRequest } from './ivrm-integration-auth.ts';

type Environment = Record<string, string | undefined>;
type LoadMembers = (
  guildId: string,
  query: string,
  limit: number,
) => Promise<GuildMemberOption[] | null>;
const MEMBER_ID = /^\d{17,20}$/u;

/** Project only the fields needed by named member selectors, without internal role/avatar data. */
function memberSummary(member: GuildMemberOption) {
  if (
    !member ||
    !MEMBER_ID.test(member.id) ||
    typeof member.username !== 'string' ||
    typeof member.displayName !== 'string' ||
    typeof member.bot !== 'boolean' ||
    Array.from(member.username).length < 1 ||
    Array.from(member.username).length > 100 ||
    Array.from(member.displayName).length < 1 ||
    Array.from(member.displayName).length > 100
  )
    return null;
  return {
    id: member.id,
    username: member.username,
    displayName: member.displayName,
    bot: member.bot,
  };
}

/** Authorize before any Bot lookup, separating cached name search from a force/exact snapshot. */
export async function handleIvrmGuildMembers(
  request: Request,
  guildId: string,
  loadMembers: LoadMembers,
  userId?: string,
  environment: Environment = process.env,
): Promise<Response> {
  const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
    Response.json(body, {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extra,
      },
    });
  const auth = authorizeIvrmIntegrationRequest(request, environment);
  if (auth.status === 'unconfigured') return json({ error: 'Integration unavailable' }, 503);
  if (auth.status !== 'authorized')
    return json({ error: 'Unauthorized' }, 401, {
      'WWW-Authenticate': 'Bearer realm="ivrm-integration"',
    });
  if (guildId !== auth.config.guildId) return json({ error: 'Not found' }, 404);
  const params = new URL(request.url).searchParams;
  const query = userId ?? (params.get('query') ?? '').trim();
  const rawLimit = userId === undefined ? (params.get('limit') ?? '20') : '1';
  if (userId !== undefined ? !MEMBER_ID.test(userId) : query.length < 2 || query.length > 64)
    return json({ error: 'Invalid query' }, 400);
  if (!/^(?:[1-9]|1[0-9]|20)$/u.test(rawLimit)) return json({ error: 'Invalid limit' }, 400);
  const limit = Number(rawLimit);
  try {
    // Numeric exact IDs trigger force:true in the existing Bot member lookup, bypassing name-search cache.
    const members = await loadMembers(guildId, query, limit);
    if (!members || members.length > limit)
      return json({ error: 'Member directory unavailable' }, 503);
    const ids = new Set<string>();
    const summaries = [];
    for (const member of members) {
      const summary = memberSummary(member);
      if (!summary || ids.has(summary.id))
        return json({ error: 'Member directory unavailable' }, 503);
      ids.add(summary.id);
      summaries.push(summary);
    }
    const fetchedAt = new Date().toISOString();
    if (userId === undefined)
      return json({ status: 'ok', guildId, query, members: summaries, fetchedAt }, 200);
    if (members.length === 0) return json({ error: 'Not found' }, 404);
    const member = members[0]!;
    if (
      member.id !== userId ||
      !Array.isArray(member.roleIds) ||
      member.roleIds.length > 250 ||
      member.roleIds.some((id) => typeof id !== 'string' || !/^\d{1,20}$/u.test(id)) ||
      new Set(member.roleIds).size !== member.roleIds.length
    )
      return json({ error: 'Member snapshot unavailable' }, 503);
    return json(
      {
        status: 'ok',
        guildId,
        member: { ...summaries[0]!, roleIds: member.roleIds.filter((id) => id !== guildId) },
        fetchedAt,
      },
      200,
    );
  } catch {
    return json({ error: 'Member directory unavailable' }, 503);
  }
}
