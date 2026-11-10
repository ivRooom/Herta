import type { PrismaClient } from '@herta/db';
import { minecraftStatusManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import type { APIEmbed } from 'discord.js';

const EPHEMERAL_FLAG = 64;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_PLAYER_NAMES = 20;
const BAR_CELLS = 10;

export const MINECRAFT_STATUS_CURRENT_URL_DEFAULT = 'https://status.ivrm.jp/api/current.json';
export const MINECRAFT_STATUS_RUNTIME_URL_DEFAULT =
  'https://status.ivrm.jp/api/minecraft-runtime.json';
export const MINECRAFT_STATUS_PAGE_URL = 'https://status.ivrm.jp/';
export const MINECRAFT_STATUS_UNAVAILABLE_MESSAGE =
  'Minecraftサーバーの状態を取得できませんでした。時間をおいて再度お試しください。';

const COLOR_ONLINE = 0x57f287;
const COLOR_OFFLINE = 0xed4245;
const COLOR_ATTENTION = 0xfee75c;
const COLOR_UNKNOWN = 0x95a5a6;

export interface MinecraftStatusConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  showResources: boolean;
  showServers: boolean;
  showBackup: boolean;
  staleAfterMinutes: number;
}

/** status.ivrm.jp/api/current.json の形（収集側の都合で欠ける場合があるため全て任意） */
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

/** status.ivrm.jp/api/minecraft-runtime.json の形 */
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
  editReply(options: EditReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

interface EditReplyOptions {
  content?: string;
  embeds?: APIEmbed[];
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

export function buildMinecraftStatusEmbed(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
  config: MinecraftStatusConfig,
  now: Date = new Date(),
): APIEmbed | null {
  if (!current && !runtime) {
    return null;
  }

  const serverName = current?.server?.name ?? 'Minecraft';
  const fields: APIEmbed['fields'] = [];

  const descriptionLines: string[] = [];
  if (current?.server?.connection) {
    descriptionLines.push(`接続先: \`${current.server.connection}\``);
  }
  if (current?.server?.mode) {
    descriptionLines.push(current.server.mode);
  }

  const players = current?.players ?? runtime?.players;
  if (players && typeof players.online === 'number') {
    const maxLabel = typeof players.max === 'number' ? ` / ${players.max}` : '';
    let value = `**${players.online}${maxLabel}** 人`;
    if (typeof players.max === 'number' && players.max > 0) {
      value += `\n${bar(players.online / players.max)}`;
    }
    fields.push({ name: '👥 プレイヤー', value, inline: true });
    const names = (current?.players?.names ?? []).filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    );
    if (names.length > 0) {
      const shown = names.slice(0, MAX_PLAYER_NAMES).join(', ');
      const rest =
        names.length > MAX_PLAYER_NAMES ? ` ほか${names.length - MAX_PLAYER_NAMES}名` : '';
      fields.push({ name: '🎮 オンライン', value: `${shown}${rest}`, inline: false });
    }
  }

  if (current?.uptime?.container) {
    fields.push({ name: '⏱ 稼働時間', value: current.uptime.container, inline: true });
  }
  if (current?.versions?.minecraft) {
    fields.push({ name: '🧩 バージョン', value: current.versions.minecraft, inline: true });
  }

  if (config.showResources && current?.resources) {
    const resources = current.resources;
    const lines: string[] = [];
    const cpuPercent = parsePercent(resources.docker_cpu);
    if (resources.docker_cpu) {
      lines.push(
        cpuPercent === null
          ? `CPU ${resources.docker_cpu}`
          : `CPU ${bar(cpuPercent / 100)} ${resources.docker_cpu}`,
      );
    }
    const dockerMemory = parseMemoryUsage(resources.docker_memory);
    if (resources.docker_memory) {
      lines.push(
        dockerMemory === null
          ? `メモリ ${resources.docker_memory}`
          : `メモリ ${bar(dockerMemory.ratio)} ${dockerMemory.percent}%（${resources.docker_memory}）`,
      );
    }
    const hostMemory = parseMemoryUsage(resources.host_memory);
    if (resources.host_memory) {
      lines.push(
        hostMemory === null
          ? `ホストメモリ ${resources.host_memory}`
          : `ホストメモリ ${bar(hostMemory.ratio)} ${hostMemory.percent}%（${resources.host_memory}）`,
      );
    }
    if (resources.load_average) lines.push(`Load \`${resources.load_average}\``);
    if (lines.length > 0) {
      fields.push({ name: '📊 リソース', value: lines.join('\n'), inline: false });
    }
  }

  if (config.showServers && runtime?.servers && runtime.servers.length > 0) {
    const lines = runtime.servers.map(
      (server) =>
        `${serverStateDot(server)} **${server.id ?? server.name ?? 'unknown'}** — ${serverStateLabel(server)}`,
    );
    fields.push({ name: '🖥 サーバー状態', value: lines.join('\n'), inline: false });
  }

  if (config.showBackup && current?.backup?.latest_local?.mtime) {
    const backup = current.backup.latest_local;
    const size = backup.size ? `（${backup.size}）` : '';
    fields.push({ name: '💾 最新バックアップ', value: `${backup.mtime}${size}`, inline: true });
  }

  const embed: APIEmbed = {
    title: `🎮 ${serverName} — ${statusLabel(current, runtime)}`,
    url: MINECRAFT_STATUS_PAGE_URL,
    color: statusColor(current, runtime),
    fields,
  };
  if (descriptionLines.length > 0) {
    embed.description = descriptionLines.join('\n');
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
      embed.footer = {
        text: `最終更新 ${formatted}${stale ? ' · ⚠️ データが古い可能性があります' : ''}`,
      };
      embed.timestamp = parsed.toISOString();
    }
  }

  return embed;
}

/** 0..1 の割合を10セルのバーで表す（例: ████░░░░░░） */
export function bar(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(clamped * BAR_CELLS);
  return `\`${'█'.repeat(filled)}${'░'.repeat(BAR_CELLS - filled)}\``;
}

function parsePercent(value: string | undefined): number | null {
  if (!value) return null;
  const match = /([\d.]+)\s*%/.exec(value);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]!);
  return Number.isFinite(parsed) ? parsed : null;
}

const MEMORY_UNIT_BYTES: Record<string, number> = {
  B: 1,
  K: 1024,
  KB: 1024,
  KI: 1024,
  KIB: 1024,
  M: 1024 ** 2,
  MB: 1024 ** 2,
  MI: 1024 ** 2,
  MIB: 1024 ** 2,
  G: 1024 ** 3,
  GB: 1024 ** 3,
  GI: 1024 ** 3,
  GIB: 1024 ** 3,
  T: 1024 ** 4,
  TB: 1024 ** 4,
  TI: 1024 ** 4,
  TIB: 1024 ** 4,
};

/** "2.821GiB / 10.64GiB" のような使用量表記から割合と%を取り出す */
function parseMemoryUsage(value: string | undefined): { ratio: number; percent: number } | null {
  if (!value) return null;
  const match = /([\d.]+)\s*([A-Za-z]+)\s*\/\s*([\d.]+)\s*([A-Za-z]+)/.exec(value);
  if (!match) return null;
  const usedUnit = MEMORY_UNIT_BYTES[match[2]!.toUpperCase()];
  const totalUnit = MEMORY_UNIT_BYTES[match[4]!.toUpperCase()];
  const used = Number.parseFloat(match[1]!);
  const total = Number.parseFloat(match[3]!);
  if (!usedUnit || !totalUnit || !Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  const ratio = (used * usedUnit) / (total * totalUnit);
  return { ratio, percent: Math.round(ratio * 100) };
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

function statusColor(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
): number {
  if (current?.status === 'offline') return COLOR_OFFLINE;
  if (current?.status === 'online') {
    return runtime?.status && runtime.status !== 'operational' && runtime.status !== 'online'
      ? COLOR_ATTENTION
      : COLOR_ONLINE;
  }
  if (current?.status) return COLOR_ATTENTION;
  const main = runtime?.servers?.find((server) => server.id === 'mc-main');
  if (main) return main.runtimeStatus === 'running' ? COLOR_ONLINE : COLOR_OFFLINE;
  return COLOR_UNKNOWN;
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

function serverStateDot(server: MinecraftRuntimeServer): string {
  if (server.health === 'unhealthy') return '🔴';
  const running = server.runtimeStatus === 'running' || server.containerState === 'running';
  if (running) return '🟢';
  if (server.runtimeStatus === 'sleeping') return '🟡';
  return '🔴';
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
  const embed = buildMinecraftStatusEmbed(current, runtime, config);
  if (embed) {
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  } else {
    await interaction.editReply({
      content: MINECRAFT_STATUS_UNAVAILABLE_MESSAGE,
      allowedMentions: { parse: [] },
    });
  }
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
