import type { PrismaClient } from '@herta/db';
import { minecraftStatusManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import { AttachmentBuilder, type APIEmbed } from 'discord.js';
import {
  renderMinecraftStatusCard,
  type MinecraftServerTone,
  type MinecraftStatusCardModel,
  type MinecraftStatusTone,
} from './minecraft-status-card.js';

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
  runtime?: { os?: string; cpu_model?: string; cpu_cores?: string };
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
  startability?: string;
  startable?: boolean;
  reason?: string;
  autoScaleUp?: boolean;
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
  files?: AttachmentBuilder[];
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
          : `メモリ ${bar(dockerMemory.ratio)} ${dockerMemory.percent}%`,
      );
    }
    const hostMemory = parseMemoryUsage(resources.host_memory);
    if (resources.host_memory) {
      lines.push(
        hostMemory === null
          ? `ホストメモリ ${resources.host_memory}`
          : `ホストメモリ ${bar(hostMemory.ratio)} ${hostMemory.percent}%`,
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
    description: statusSummaryDescription(current, runtime),
    fields,
  };
  if (descriptionLines.length > 0) {
    embed.description = `${embed.description}\n${descriptionLines.join('\n')}`;
  }

  const footer = updatedFooter(current, runtime, config, now);
  if (footer) {
    embed.footer = { text: footer.text };
    embed.timestamp = footer.iso;
  }

  return embed;
}

export function statusSummaryDescription(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
): string {
  const tone = statusTone(current, runtime);
  const sentence =
    tone === 'online'
      ? '正常稼働中です。'
      : tone === 'attention'
        ? '稼働中ですが、一部に異常があります。'
        : tone === 'offline'
          ? '現在オフラインです。'
          : '状態を取得できませんでした。';
  const rawConnection = current?.server?.connection;
  const connection = rawConnection && rawConnection.length > 0 ? rawConnection : 'mc.ivrm.jp';
  return `${sentence}\n\nIP: ${connection}\n稼働状況: ${MINECRAFT_STATUS_PAGE_URL}`;
}

export function buildMinecraftStatusImageEmbed(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
  config: MinecraftStatusConfig,
  now: Date = new Date(),
): APIEmbed | null {
  if (!current && !runtime) {
    return null;
  }
  const serverName = current?.server?.name ?? 'Minecraft';
  const embed: APIEmbed = {
    title: `🎮 ${serverName} — ${statusLabel(current, runtime)}`,
    url: MINECRAFT_STATUS_PAGE_URL,
    color: statusColor(current, runtime),
    description: statusSummaryDescription(current, runtime),
    image: { url: 'attachment://herta-minecraft-status.png' },
  };
  const footer = updatedFooter(current, runtime, config, now);
  if (footer) {
    embed.footer = { text: footer.text };
    embed.timestamp = footer.iso;
  }
  return embed;
}

function updatedFooter(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
  config: MinecraftStatusConfig,
  now: Date,
): { text: string; iso: string } | null {
  const updatedAt = current?.collected_at ?? runtime?.generatedAt;
  if (!updatedAt) return null;
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const stale = now.getTime() - parsed.getTime() > config.staleAfterMinutes * 60_000;
  const formatted = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
  return {
    text: `最終更新 ${formatted}${stale ? ' · ⚠️ データが古い可能性があります' : ''}`,
    iso: parsed.toISOString(),
  };
}

export function buildMinecraftStatusCardModel(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
  config: MinecraftStatusConfig,
): MinecraftStatusCardModel | null {
  if (!current && !runtime) {
    return null;
  }
  const model: MinecraftStatusCardModel = {
    serverName: current?.server?.name ?? 'Minecraft',
    statusText: statusTextOf(current),
    statusTone: statusTone(current, runtime),
  };
  if (current?.server?.connection) model.connection = current.server.connection;
  if (current?.server?.mode) model.mode = current.server.mode;

  const players = current?.players ?? runtime?.players;
  if (players && typeof players.online === 'number') {
    const names = (current?.players?.names ?? []).filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    );
    model.players = {
      online: players.online,
      ratio:
        typeof players.max === 'number' && players.max > 0 ? players.online / players.max : null,
    };
    if (typeof players.max === 'number') model.players.max = players.max;
    if (names.length > 0) {
      const shown = names.slice(0, MAX_PLAYER_NAMES).join(', ');
      const rest =
        names.length > MAX_PLAYER_NAMES ? ` ほか${names.length - MAX_PLAYER_NAMES}名` : '';
      model.players.namesLine = `${shown}${rest}`;
    }
  }

  if (config.showResources && current?.resources) {
    const resources: NonNullable<MinecraftStatusCardModel['resources']> = {};
    const cpu = parsePercent(current.resources.docker_cpu);
    if (cpu !== null) resources.cpuPercent = cpu;
    const memory = parseMemoryUsage(current.resources.docker_memory);
    if (memory !== null) resources.memoryPercent = memory.percent;
    const hostMemory = parseMemoryUsage(current.resources.host_memory);
    if (hostMemory !== null) resources.hostMemoryPercent = hostMemory.percent;
    if (current.resources.load_average) resources.loadAverage = current.resources.load_average;
    if (Object.keys(resources).length > 0) model.resources = resources;
  }

  if (config.showServers && runtime?.servers && runtime.servers.length > 0) {
    model.servers = runtime.servers.map((server) => ({
      name: server.id ?? server.name ?? 'unknown',
      stateLabel: serverStateLabel(server),
      tone: serverStateTone(server),
    }));
  }

  if (current?.uptime?.container) model.uptime = current.uptime.container;
  if (current?.versions?.minecraft) model.version = current.versions.minecraft;
  const hostLabel = hostLabelOf(current);
  if (hostLabel) model.hostLabel = hostLabel;
  const backupMtime = current?.backup?.latest_local?.mtime;
  if (config.showBackup && backupMtime) {
    const backupSize = current?.backup?.latest_local?.size;
    model.backupLabel = `${formatBackupTime(backupMtime)}${backupSize ? `（${backupSize}）` : ''}`;
  }
  return model;
}

function statusTextOf(current: MinecraftCurrentStatus | null): string {
  if (current?.status === 'offline') return 'オフライン';
  if (current?.status === 'online') return 'オンライン';
  return '状態不明';
}

function statusTone(
  current: MinecraftCurrentStatus | null,
  runtime: MinecraftRuntimeStatus | null,
): MinecraftStatusTone {
  const color = statusColor(current, runtime);
  if (color === COLOR_ONLINE) return 'online';
  if (color === COLOR_OFFLINE) return 'offline';
  if (color === COLOR_ATTENTION) return 'attention';
  return 'unknown';
}

function serverStateTone(server: MinecraftRuntimeServer): MinecraftServerTone {
  // 休止（設計どおりのスリープ）は異常ではないので、health より優先して判定する
  if (server.runtimeStatus === 'sleeping') return 'sleep';
  const running = server.runtimeStatus === 'running' || server.containerState === 'running';
  if (running) return server.health === 'unhealthy' ? 'bad' : 'ok';
  if (server.runtimeStatus === 'starting') return 'warn';
  // 停止中コンテナの health は未稼働ゆえに unhealthy になりがちで当てにならない。
  // 異常かどうかは collector の startability（OOM・マウント不備・メモリ不足の判定）で決める。
  if (server.startability === 'unavailable') return 'bad';
  return 'warn';
}

/** "Oracle Linux Server 9.7" + Neoverse-N1 + 2コア → "Oracle Cloud · Oracle Linux 9.7 · Neoverse-N1 · 2コア" */
function hostLabelOf(current: MinecraftCurrentStatus | null): string | null {
  const runtime = current?.runtime;
  const os = typeof runtime?.os === 'string' ? runtime.os : undefined;
  const cpuModel = typeof runtime?.cpu_model === 'string' ? runtime.cpu_model : undefined;
  const cpuCores =
    typeof runtime?.cpu_cores === 'string'
      ? runtime.cpu_cores
      : typeof runtime?.cpu_cores === 'number'
        ? String(runtime.cpu_cores)
        : undefined;
  if (!os && !cpuModel) return null;
  const parts: string[] = [];
  if (os?.includes('Oracle')) parts.push('Oracle Cloud');
  if (os) parts.push(os.replace(' Server', ''));
  if (cpuModel) parts.push(cpuModel);
  if (cpuCores) parts.push(`${cpuCores}コア`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "2026-11-10 15:00:45" → "11/10 15:00"（収集ホストの壁時計表記をそのまま整形し、解釈できなければ元の表記） */
function formatBackupTime(mtime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(mtime);
  if (!match) return mtime;
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}:${match[5]}`;
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
    // 全体色は Minecraft サーバー群の状態だけで決める。runtime 側の総合ステータスは
    // ボイスチャット等の周辺要素でも partial_outage になるため、色には使わない。
    return COLOR_ONLINE;
  }
  if (current?.status) return COLOR_ATTENTION;
  const main = runtime?.servers?.find((server) => server.id === 'mc-main');
  if (main) return main.runtimeStatus === 'running' ? COLOR_ONLINE : COLOR_OFFLINE;
  return COLOR_UNKNOWN;
}

function serverStateLabel(server: MinecraftRuntimeServer): string {
  // 休止中は「接続すると自動起動する」設計どおりの状態なので、異常とは表示しない
  if (server.runtimeStatus === 'sleeping') {
    return server.startable === false ? '休止中' : '休止中（接続で自動起動）';
  }
  let state: string;
  if (server.runtimeStatus === 'running' || server.containerState === 'running') {
    state = '稼働中';
  } else if (server.runtimeStatus === 'starting') {
    state = '起動中';
  } else {
    state = '停止中';
    // 停止中は health でなく startability で異常を判定する（serverStateTone と同じ理由）
    return server.startability === 'unavailable' ? `${state}（異常）` : state;
  }
  if (server.health === 'healthy') return `${state}（正常）`;
  if (server.health === 'unhealthy') return `${state}（異常）`;
  return server.health ? `${state}（${server.health}）` : state;
}

function serverStateDot(server: MinecraftRuntimeServer): string {
  const tone = serverStateTone(server);
  return tone === 'ok' ? '🟢' : tone === 'warn' ? '🟡' : tone === 'sleep' ? '💤' : '🔴';
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
  try {
    const cardModel = buildMinecraftStatusCardModel(current, runtime, config);
    if (cardModel) {
      const card = await renderMinecraftStatusCard(cardModel);
      const imageEmbed = buildMinecraftStatusImageEmbed(current, runtime, config);
      if (imageEmbed) {
        await interaction.editReply({
          embeds: [imageEmbed],
          files: [new AttachmentBuilder(card, { name: 'herta-minecraft-status.png' })],
          allowedMentions: { parse: [] },
        });
        return;
      }
    }
  } catch {
    // モデル構築・画像描画に失敗した場合はフィールド形式の Embed にフォールバックする
  }
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
