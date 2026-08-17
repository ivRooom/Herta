import { getBotInternalApiAuthorizationHeader } from './bot-internal-api-auth';
import { resolveBotHealthRequestTimeoutMs } from './bot-health';

export interface BotGuildRoleResult {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  mentionable: boolean;
  editable: boolean;
}

export class BotGuildRoleLifecycleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'BotGuildRoleLifecycleError';
  }
}

export async function createBotGuildRole(
  guildId: string,
  input: { name: string; color: number; hoist: boolean; mentionable: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<BotGuildRoleResult> {
  const response = await requestBotRoleApi(
    guildId,
    '',
    { method: 'POST', body: JSON.stringify(input) },
    fetchImpl,
  );
  const payload = (await response.json().catch(() => null)) as {
    result?: BotGuildRoleResult;
    status?: string;
  } | null;
  if (!response.ok || !payload?.result) throw toLifecycleError(response.status, payload?.status);
  return payload.result;
}

export async function deleteBotGuildRole(
  guildId: string,
  roleId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ deleted: boolean; roleName: string | null }> {
  const response = await requestBotRoleApi(
    guildId,
    `/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
    fetchImpl,
  );
  const payload = (await response.json().catch(() => null)) as {
    result?: { deleted: boolean; roleName: string | null };
    status?: string;
  } | null;
  if (!response.ok || !payload?.result) throw toLifecycleError(response.status, payload?.status);
  return payload.result;
}

async function requestBotRoleApi(
  guildId: string,
  suffix: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  const authorization = getBotInternalApiAuthorizationHeader();
  if (!healthUrl || !authorization) {
    throw new BotGuildRoleLifecycleError('Bot内部APIが設定されていません', 503, 'not_configured');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(`/internal/guilds/${guildId}/roles${suffix}`, healthUrl);
  } catch {
    throw new BotGuildRoleLifecycleError('Bot内部API URLが不正です', 503, 'invalid_url');
  }
  try {
    return await fetchImpl(endpoint, {
      ...init,
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(resolveBotHealthRequestTimeoutMs() + 10_000),
    });
  } catch {
    throw new BotGuildRoleLifecycleError(
      'Bot内部APIへ接続できませんでした。Discord側で処理済みか確認してください。',
      503,
      'transport_unknown',
    );
  }
}

function toLifecycleError(status: number, code = 'unavailable'): BotGuildRoleLifecycleError {
  const message =
    code === 'manage_roles_required'
      ? 'Herta Botに「ロールの管理」権限がありません。'
      : code === 'role_protected'
        ? '保護Roleは削除できません。'
        : code === 'role_managed'
          ? 'Discord Managed Roleは削除できません。'
          : code === 'role_not_editable'
            ? 'Bot以上のRoleは削除できません。Role階層を確認してください。'
            : code === 'guild_not_found'
              ? '対象Discordサーバーが見つかりません。'
              : code === 'rate_limited'
                ? 'Discord APIのRate Limitに達しました。'
                : 'Discord Role操作に失敗しました。';
  return new BotGuildRoleLifecycleError(message, status, code);
}
