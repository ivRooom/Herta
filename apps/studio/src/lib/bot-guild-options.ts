import { z } from 'zod';
import { resolveBotHealthRequestTimeoutMs } from './bot-health.ts';
import { getBotInternalApiAuthorizationHeader } from './bot-internal-api-auth.ts';

export const guildChannelOptionSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  name: z.string().min(1),
  kind: z.enum(['text', 'announcement', 'forum', 'thread', 'voice']),
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
  fetchedAt: z.iso.datetime(),
});

export type GuildConfigurationOptions = z.infer<typeof guildConfigurationOptionsSchema>;
export type GuildChannelOption = GuildConfigurationOptions['channels'][number];
export type GuildRoleOption = GuildConfigurationOptions['roles'][number];
export type GuildEmojiOption = GuildConfigurationOptions['emojis'][number];

export async function getGuildConfigurationOptions(
  guildId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GuildConfigurationOptions | null> {
  if (!/^\d+$/u.test(guildId)) return null;
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  const authorization = getBotInternalApiAuthorizationHeader();
  if (!healthUrl || !authorization) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(`/internal/guilds/${guildId}/options`, healthUrl);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveBotHealthRequestTimeoutMs());
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
      },
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

const GUILD_CONFIGURATION_OPTIONS_CACHE_TTL_MS = 30_000;

type GuildConfigurationOptionsCacheEntry = {
  promise: Promise<GuildConfigurationOptions | null>;
  expiresAt: number;
};

const guildConfigurationOptionsCache = new Map<string, GuildConfigurationOptionsCacheEntry>();

/**
 * 画面表示専用の、TTL付きキャッシュで Guild options を取得する。
 *
 * チャンネル/Role/Emoji の候補一覧は表示データであり、画面遷移のたびに Bot へ
 * 問い合わせると遷移全体が Bot の応答待ちになるため、30秒のハードTTLで再利用する。
 * 進行中の取得は Promise ごとキャッシュし、同時リクエストを1回の取得へ合流させる。
 * 取得失敗 (null) はキャッシュせず、次回アクセスで再取得して Bot の復旧を早く反映する。
 *
 * 注意: 認可判断や更新系の検証 (Bot権限の確認、Role の存在確認など) には使わないこと。
 * それらは鮮度が要るため `getGuildConfigurationOptions` で常時最新を取得する。
 */
export function getGuildConfigurationOptionsCached(
  guildId: string,
): Promise<GuildConfigurationOptions | null> {
  if (!/^\d+$/u.test(guildId)) return Promise.resolve(null);

  const now = Date.now();
  const cached = guildConfigurationOptionsCache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = getGuildConfigurationOptions(guildId).then((result) => {
    if (!result && guildConfigurationOptionsCache.get(guildId)?.promise === promise) {
      guildConfigurationOptionsCache.delete(guildId);
    }
    return result;
  });
  guildConfigurationOptionsCache.set(guildId, {
    promise,
    expiresAt: now + GUILD_CONFIGURATION_OPTIONS_CACHE_TTL_MS,
  });
  return promise;
}
