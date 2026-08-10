import { z } from 'zod';
import { resolveBotHealthRequestTimeoutMs } from './bot-health';

const guildChannelOptionSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  name: z.string().min(1),
  kind: z.enum(['text', 'announcement', 'forum', 'thread']),
  position: z.number().int(),
  parentId: z.string().regex(/^\d+$/u).nullable(),
  viewable: z.boolean().default(false),
  readMessageHistory: z.boolean().default(false),
});

const guildRoleOptionSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  name: z.string().min(1),
  color: z.string(),
  position: z.number().int(),
  managed: z.boolean(),
  mentionable: z.boolean(),
  editable: z.boolean(),
});

const guildEmojiOptionSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  name: z.string().min(1),
  animated: z.boolean(),
  available: z.boolean(),
  managed: z.boolean(),
});

const guildConfigurationOptionsSchema = z.object({
  guildId: z.string().regex(/^\d+$/u),
  guildName: z.string().min(1),
  channels: z.array(guildChannelOptionSchema),
  // Bot/Studioのローリングデプロイ中も従来レスポンスを受け取れるようoptionalにする。
  messageTargets: z.array(guildChannelOptionSchema).optional(),
  roles: z.array(guildRoleOptionSchema),
  emojis: z.array(guildEmojiOptionSchema),
  bot: z.object({
    manageMessages: z.boolean(),
    manageRoles: z.boolean(),
    moderateMembers: z.boolean(),
    kickMembers: z.boolean(),
    banMembers: z.boolean(),
    mentionEveryone: z.boolean(),
    highestRolePosition: z.number().int(),
  }),
  fetchedAt: z.string().datetime(),
});

export type GuildConfigurationOptions = z.infer<typeof guildConfigurationOptionsSchema>;
export type GuildChannelOption = GuildConfigurationOptions['channels'][number];
export type GuildRoleOption = GuildConfigurationOptions['roles'][number];
export type GuildEmojiOption = GuildConfigurationOptions['emojis'][number];

export async function getGuildConfigurationOptions(
  guildId: string,
): Promise<GuildConfigurationOptions | null> {
  if (!/^\d+$/u.test(guildId)) return null;
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  if (!healthUrl) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(`/internal/guilds/${guildId}/options`, healthUrl);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveBotHealthRequestTimeoutMs());
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const parsed = guildConfigurationOptionsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
