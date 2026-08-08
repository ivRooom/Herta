import { z } from 'zod';
import { resolveBotHealthRequestTimeoutMs } from './bot-health.ts';

const guildMemberOptionSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  username: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  bot: z.boolean(),
});

const guildMemberSearchResponseSchema = z.object({
  members: z.array(guildMemberOptionSchema).max(20),
});

export type GuildMemberOption = z.infer<typeof guildMemberOptionSchema>;

export async function searchGuildMembers(
  guildId: string,
  query: string,
  limit = 20,
): Promise<GuildMemberOption[] | null> {
  if (!/^\d+$/u.test(guildId)) return null;
  const normalizedQuery = query.trim().slice(0, 64);
  if (!/^\d{17,20}$/u.test(normalizedQuery) && normalizedQuery.length < 2) return [];

  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  if (!healthUrl) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(`/internal/guilds/${guildId}/members`, healthUrl);
    endpoint.searchParams.set('query', normalizedQuery);
    endpoint.searchParams.set('limit', String(Math.max(1, Math.min(20, Math.trunc(limit) || 20))));
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(3_000, resolveBotHealthRequestTimeoutMs() + 2_000),
  );
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const parsed = guildMemberSearchResponseSchema.safeParse(payload);
    return parsed.success ? parsed.data.members : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
