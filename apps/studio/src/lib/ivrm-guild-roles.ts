import type { GuildConfigurationOptions } from './bot-guild-options.ts';
import { authorizeIvrmIntegrationRequest } from './ivrm-integration-auth.ts';

type Environment = Record<string, string | undefined>;
type LoadOptions = (guildId: string) => Promise<GuildConfigurationOptions | null>;

export function serializeIvrmGuildRoles(options: GuildConfigurationOptions, guildId: string) {
  if (options.guildId !== guildId || !Number.isFinite(Date.parse(options.fetchedAt))) return null;
  const ids = new Set<string>();
  const roles = [];
  for (const role of options.roles) {
    if (
      !/^\d{17,20}$/u.test(role.id) ||
      ids.has(role.id) ||
      Array.from(role.name).length < 1 ||
      Array.from(role.name).length > 100 ||
      !/^#[0-9a-f]{6}$/iu.test(role.color) ||
      !Number.isInteger(role.position) ||
      role.position < 0 ||
      typeof role.managed !== 'boolean'
    )
      return null;
    ids.add(role.id);
    roles.push({
      id: role.id,
      name: role.name,
      color: Number.parseInt(role.color.slice(1), 16),
      position: role.position,
      managed: role.managed,
    });
  }
  return { status: 'ok' as const, guildId, roles, fetchedAt: options.fetchedAt };
}

export async function handleIvrmGuildRoles(
  request: Request,
  guildId: string,
  loadOptions: LoadOptions,
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
  const authorization = authorizeIvrmIntegrationRequest(request, environment);
  if (authorization.status === 'unconfigured')
    return json({ error: 'Integration unavailable' }, 503);
  if (authorization.status !== 'authorized')
    return json({ error: 'Unauthorized' }, 401, {
      'WWW-Authenticate': 'Bearer realm="ivrm-integration"',
    });
  if (guildId !== authorization.config.guildId) return json({ error: 'Not found' }, 404);
  try {
    const options = await loadOptions(guildId);
    const directory = options ? serializeIvrmGuildRoles(options, guildId) : null;
    return directory ? json(directory, 200) : json({ error: 'Role directory unavailable' }, 503);
  } catch {
    return json({ error: 'Role directory unavailable' }, 503);
  }
}
