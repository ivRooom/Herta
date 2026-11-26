import type { GuildConfigurationOptions } from './bot-guild-options.ts';
import { authorizeIvrmIntegrationRequest } from './ivrm-integration-auth.ts';

type Environment = Record<string, string | undefined>;
type LoadOptions = (guildId: string) => Promise<GuildConfigurationOptions | null>;

const POSTABLE_CHANNEL_KINDS: ReadonlySet<string> = new Set(['text', 'announcement']);

/**
 * Project the Bot channel candidates that are safe announcement targets.
 *
 * The Bot options channel list can carry forum/thread/voice entries during
 * rolling deploys, and a channel the Bot cannot view cannot receive its posts.
 * Only text/announcement channels viewable by the Bot are projected, with the
 * bounded public fields the ivrm Admin dropdown needs.
 */
export function serializeIvrmGuildChannels(options: GuildConfigurationOptions, guildId: string) {
  if (options.guildId !== guildId || !Number.isFinite(Date.parse(options.fetchedAt))) return null;
  const ids = new Set<string>();
  const channels = [];
  for (const channel of options.channels) {
    if (!POSTABLE_CHANNEL_KINDS.has(channel.kind) || channel.viewable !== true) continue;
    if (
      !/^\d{1,20}$/u.test(channel.id) ||
      ids.has(channel.id) ||
      Array.from(channel.name).length < 1 ||
      Array.from(channel.name).length > 100 ||
      !Number.isInteger(channel.position) ||
      channel.position < 0 ||
      !(channel.parentId === null || /^\d{1,20}$/u.test(channel.parentId))
    )
      return null;
    ids.add(channel.id);
    channels.push({
      id: channel.id,
      name: channel.name,
      kind: channel.kind,
      position: channel.position,
      parentId: channel.parentId,
    });
  }
  return { status: 'ok' as const, guildId, channels, fetchedAt: options.fetchedAt };
}

/** Authorize the configured guild before loading options; expose only bounded public errors. */
export async function handleIvrmGuildChannels(
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
    const directory = options ? serializeIvrmGuildChannels(options, guildId) : null;
    return directory ? json(directory, 200) : json({ error: 'Channel directory unavailable' }, 503);
  } catch {
    return json({ error: 'Channel directory unavailable' }, 503);
  }
}
