import type { PrismaClient } from '@herta/db';
import { minecraftStatusManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';

const EPHEMERAL_FLAG = 64;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_PLAYER_NAMES = 20;

export const MINECRAFT_STATUS_CURRENT_URL_DEFAULT = 'https://stats.ivrm.jp/api/current.json';
export const MINECRAFT_STATUS_RUNTIME_URL_DEFAULT =
  'https://stats.ivrm.jp/api/minecraft-runtime.json';

export interface MinecraftStatusConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  showResources: boolean;
  showServers: boolean;
  showBackup: boolean;
  staleAfterMinutes: number;
}

/** stats.ivrm.jp/api/current.json の形（収集側の都合で欠ける場合があるため全て任意） */
export interface MinecraftCurrentStatus {
  status?: string;
  collected_at?: string;
  server?: { name?: string; mode?: string; connection?: string };
  players?: { online?: number; max?: number; names?: string[] };
  uptime?: { container?: string };
  resources?: {
    docker_cpu?: string;
    docker_memory?: string;
    host_memory?: string;
    load_average?: string;
  };
  versions?: { minecraft?: string; java?: string };
  backup?: { latest_local?: { file?: string; size?: string; mtime?: string } };
}

/** stats.ivrm.jp/api/minecraft-runtime.json の形 */
export interface MinecraftRuntimeServer {
  id?: string;
  name?: string;
  role?: string;
  containerState?: string;
  health?: string;
  runtimeStatus?: string;
}

export interface MinecraftRuntimeStatus {
  generatedAt?: string;
  status?: string;
  players?: { online?: number; max?: number };
  servers?: MinecraftRuntimeServer[];
}

interface MinecraftStatusOptions {
  getSubcommand(): string;
}

interface MinecraftStatusInteraction {
  guildId: string | null;
  options: MinecraftStatusOptions;
  reply(options: ReplyOptions): Promise<unknown>;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  editReply(options: { content: string; allowedMentions: { parse: [] } }): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type MinecraftStatusContext = PluginRuntimeContext<MinecraftStatusConfig, unknown, PrismaClient>;

export const minecraftStatusPlugin = definePlugin<MinecraftStatusConfig, unknown, PrismaClient>({
  manifest: minecraftStatusManifest,
  provideCommands(context) {
    const command: CommandHandler<MinecraftStatusInteraction> = {
      definition: minecraftStatusManifest.commands[0]!,
      async execute(interaction) {
        await executeMinecraftCommand(context, interaction);
      },
    };
    return [command];
  },
});

export function normalizeMinecraftStatusConfig(value: unknown): MinecraftStatusConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? false : source.ephemeralResponses === true,
    showResources: source.showResources === undefined ? true : source.showResources === true,
    showServers: source.showServers === undefined ? true : source.showServers === true,
    showBackup: source.showBackup === undefined ? true : source.showBackup === true,
    staleAfterMinutes: clamp(toInteger(source.staleAfterMinutes, 3), 1, 60),
  };
}

export function formatMinecraftStatus(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
  config: MinecraftStatusConfig,
  now: Date = new Date(),
): string {
  if (!current && !runtime) {
    return 'Minecraftサーバーの状態を取得できませんでした。時間をおいて再度お試しください。';
  }

  const serverName = current?.server?.name ?? 'Minecraft';
  const lines: string[] = [`**🎮 ${serverName} — ${statusLabel(current, runtime)}**`];

  if (current?.server?.connection) {
    lines.push(`接続先: \`${current.server.connection}\``);
  }

  const players = current?.players ?? runtime?.players;
  if (players && typeof players.online === 'number') {
    const max = typeof players.max === 'number' ? ` / ${players.max}` : '';
    lines.push(`プレイヤー: **${players.online}${max}**`);
    const names = (current?.players?.names ?? []).filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    );
    if (names.length > 0) {
      const shown = names.slice(0, MAX_PLAYER_NAMES).join(', ');
      const rest =
        names.length > MAX_PLAYER_NAMES ? ` ほか${names.length - MAX_PLAYER_NAMES}名` : '';
      lines.push(`オンライン: ${shown}${rest}`);
    }
  }

  if (current?.uptime?.container) {
    lines.push(`稼働時間: **${current.uptime.container}**`);
  }
  if (current?.versions?.minecraft) {
    lines.push(`バージョン: ${current.versions.minecraft}`);
  }

  if (config.showResources && current?.resources) {
    const resources = current.resources;
    const parts: string[] = [];
    if (resources.docker_cpu) parts.push(`CPU ${resources.docker_cpu}`);
    if (resources.docker_memory) parts.push(`メモリ ${resources.docker_memory}`);
    if (resources.load_average) parts.push(`Load ${resources.load_average}`);
    if (parts.length > 0) lines.push(`リソース: ${parts.join(' / ')}`);
  }

  if (config.showBackup && current?.backup?.latest_local?.mtime) {
    const backup = current.backup.latest_local;
    const size = backup.size ? `（${backup.size}）` : '';
    lines.push(`最新バックアップ: ${backup.mtime}${size}`);
  }

  if (config.showServers && runtime?.servers && runtime.servers.length > 0) {
    lines.push('サーバー状態:');
    for (const server of runtime.servers) {
      lines.push(`• ${server.id ?? server.name ?? 'unknown'}: ${serverStateLabel(server)}`);
    }
  }

  const updatedAt = current?.collected_at ?? runtime?.generatedAt;
  if (updatedAt) {
    const parsed = new Date(updatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      const stale = now.getTime() - parsed.getTime() > config.staleAfterMinutes * 60_000;
      const formatted = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(parsed);
      lines.push(`最終更新: ${formatted}${stale ? '（⚠️ データが古い可能性があります）' : ''}`);
    }
  }

  return lines.join('\n');
}

function statusLabel(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
): string {
  if (current?.status === 'online') return '🟢 オンライン';
  if (current?.status === 'offline') return '🔴 オフライン';
  if (current?.status) return `⚠️ ${current.status}`;
  const main = runtime?.servers?.find((server) => server.id === 'mc-main');
  if (main) return main.runtimeStatus === 'running' ? '🟢 オンライン' : '🔴 オフライン';
  return '⚠️ 状態不明';
}

function serverStateLabel(server: MinecraftRuntimeServer): string {
  let state: string;
  if (server.runtimeStatus === 'running' || server.containerState === 'running') {
    state = '稼働中';
  } else if (server.runtimeStatus === 'sleeping') {
    state = 'スリープ中';
  } else {
    state = '停止中';
  }
  if (server.health === 'healthy') return `${state}（正常）`;
  if (server.health === 'unhealthy') return `${state}（異常）`;
  return server.health ? `${state}（${server.health}）` : state;
}

async function executeMinecraftCommand(
  context: MinecraftStatusContext,
  interaction: MinecraftStatusInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await reply(context, interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }

  const config = normalizeMinecraftStatusConfig(context.config);
  if (!config.enabled) {
    await reply(context, interaction, 'Minecraft Status Pluginは現在無効です。');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== 'status') {
    await reply(context, interaction, '不明なMinecraft Status操作です。');
    return;
  }

  // 取得に時間がかかる場合でも応答期限（約3秒）を切らないよう、先に defer する
  await interaction.deferReply({
    flags: config.ephemeralResponses ? EPHEMERAL_FLAG : undefined,
  });
  const [current, runtime] = await Promise.all([fetchCurrentStatus(), fetchRuntimeStatus()]);
  await interaction.editReply({
    content: formatMinecraftStatus(current, runtime, config),
    allowedMentions: { parse: [] },
  });
}

async function fetchCurrentStatus(): Promise<MinecraftCurrentStatus | null> {
  const url = process.env.MINECRAFT_STATUS_CURRENT_URL ?? MINECRAFT_STATUS_CURRENT_URL_DEFAULT;
  const data = await fetchJson(url);
  return isRecord(data) ? (data as MinecraftCurrentStatus) : null;
}

async function fetchRuntimeStatus(): Promise<MinecraftRuntimeStatus | null> {
  const url = process.env.MINECRAFT_STATUS_RUNTIME_URL ?? MINECRAFT_STATUS_RUNTIME_URL_DEFAULT;
  const data = await fetchJson(url);
  return isRecord(data) ? (data as MinecraftRuntimeStatus) : null;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function reply(
  context: MinecraftStatusContext,
  interaction: MinecraftStatusInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: normalizeMinecraftStatusConfig(context.config).ephemeralResponses
      ? EPHEMERAL_FLAG
      : undefined,
    allowedMentions: { parse: [] },
  });
}

function toInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
