import { createHash, createHmac } from 'node:crypto';
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
export const MINECRAFT_STATUS_HISTORY_URL_DEFAULT =
  'https://status.ivrm.jp/api/metrics-history.json';
export const MINECRAFT_STATUS_REPORTS_URL_DEFAULT = 'https://status.ivrm.jp/api/reports.json';
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
  showPerformanceGraph: boolean;
  showServers: boolean;
  showBackup: boolean;
  staleAfterMinutes: number;
  announceReports: boolean;
  reportChannelId: string;
  announceEvents: boolean;
  eventChannelId: string;
  operatorRoleIds: string[];
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

/** /api/metrics-history.json の形（ivrm-mc-metricsd が生成する階層化時系列） */
export interface MinecraftMetricsHistory {
  tiers?: {
    '10s'?: {
      series?: Record<string, [number, number | null, number | null][]>;
    };
  };
}

interface MinecraftStatusOptions {
  getSubcommand(): string;
  getString(name: string): string | null;
}

interface MinecraftStatusInteraction {
  guildId: string | null;
  options: MinecraftStatusOptions;
  user?: { id?: string };
  member?: unknown;
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
  allowedMentions: { parse: [] } | { users: string[] };
}

interface MinecraftReportChannel {
  isTextBased(): boolean;
  send(options: { embeds: APIEmbed[]; allowedMentions: { parse: [] } }): Promise<unknown>;
  messages: {
    fetch(options: { limit: number }): Promise<{
      values(): Iterable<{
        content?: string;
        embeds?: { url?: string; description?: string }[];
      }>;
    }>;
  };
}

interface MinecraftReportClient {
  channels: { fetch(channelId: string): Promise<MinecraftReportChannel | null> };
}

type MinecraftStatusContext = PluginRuntimeContext<
  MinecraftStatusConfig,
  MinecraftReportClient,
  PrismaClient
>;

export const minecraftStatusPlugin = definePlugin<
  MinecraftStatusConfig,
  MinecraftReportClient,
  PrismaClient
>({
  manifest: minecraftStatusManifest,
  async onEnable(context) {
    startReportWorker(context);
    startEventWorker(context);
  },
  async onDisable(context) {
    stopReportWorker(context.guildId);
    stopEventWorker(context.guildId);
  },
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
    showPerformanceGraph:
      source.showPerformanceGraph === undefined ? true : source.showPerformanceGraph === true,
    showServers: source.showServers === undefined ? true : source.showServers === true,
    showBackup: source.showBackup === undefined ? true : source.showBackup === true,
    staleAfterMinutes: clamp(toInteger(source.staleAfterMinutes, 3), 1, 60),
    announceReports: source.announceReports === true,
    reportChannelId:
      typeof source.reportChannelId === 'string' && /^\d{15,25}$/.test(source.reportChannelId)
        ? source.reportChannelId
        : '',
    announceEvents: source.announceEvents === true,
    eventChannelId:
      typeof source.eventChannelId === 'string' && /^\d{15,25}$/.test(source.eventChannelId)
        ? source.eventChannelId
        : '',
    operatorRoleIds: normalizeRoleIds(source.operatorRoleIds),
  };
}

function normalizeRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (item): item is string => typeof item === 'string' && /^\d{5,25}$/.test(item),
  );
  return [...new Set(ids)].slice(0, 20);
}

/** 実行メンバーのロールID一覧を取り出す（discord.js の GuildMember と生の API メンバー両対応） */
export function memberRoleIds(interaction: { member?: unknown }): string[] {
  const member = isRecord(interaction.member) ? interaction.member : null;
  if (!member) return [];
  const roles = member.roles;
  if (Array.isArray(roles)) {
    return roles.filter((role): role is string => typeof role === 'string');
  }
  if (isRecord(roles) && roles.cache instanceof Map) {
    return [...roles.cache.keys()].filter((key): key is string => typeof key === 'string');
  }
  return [];
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
    const rawCpuPercent = parsePercent(resources.docker_cpu);
    const cpuPercent =
      rawCpuPercent === null ? null : normalizeCpuPercent(rawCpuPercent, cpuCoreCount(current));
    if (resources.docker_cpu) {
      lines.push(
        cpuPercent === null
          ? `CPU ${resources.docker_cpu}`
          : `CPU ${bar(cpuPercent / 100)} ${Math.round(cpuPercent)}%`,
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
  history?: MinecraftMetricsHistory | null,
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
    if (cpu !== null) resources.cpuPercent = normalizeCpuPercent(cpu, cpuCoreCount(current));
    const memory = parseMemoryUsage(current.resources.docker_memory);
    if (memory !== null) resources.memoryPercent = memory.percent;
    const hostMemory = parseMemoryUsage(current.resources.host_memory);
    if (hostMemory !== null) resources.hostMemoryPercent = hostMemory.percent;
    if (current.resources.load_average) resources.loadAverage = current.resources.load_average;
    if (Object.keys(resources).length > 0) model.resources = resources;
  }

  if (config.showPerformanceGraph && history) {
    const performance = buildPerformanceModel(history);
    if (performance) model.performance = performance;
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

const PERFORMANCE_SERIES_DEFS: { key: string; label: string; color: string }[] = [
  { key: 'mc-main', label: '生活', color: '#57f287' },
  { key: 'mc-resource', label: '資源', color: '#60a5fa' },
  { key: 'host', label: 'ホスト', color: '#f59e0b' },
];
const PERFORMANCE_MAX_POINTS = 180; // 10秒階層で30分ぶん

export function buildPerformanceModel(
  history: MinecraftMetricsHistory,
): MinecraftStatusCardModel['performance'] | null {
  const series = history.tiers?.['10s']?.series;
  if (!series) return null;
  const cpu: NonNullable<MinecraftStatusCardModel['performance']>['cpu'] = [];
  const memory: NonNullable<MinecraftStatusCardModel['performance']>['memory'] = [];
  for (const def of PERFORMANCE_SERIES_DEFS) {
    const entries = series[def.key];
    if (!Array.isArray(entries) || entries.length < 2) continue;
    const sorted = [...entries]
      .filter(
        (entry): entry is [number, number | null, number | null] =>
          Array.isArray(entry) && typeof entry[0] === 'number',
      )
      .sort((a, b) => a[0] - b[0])
      .slice(-PERFORMANCE_MAX_POINTS);
    if (sorted.length < 2) continue;
    const toPoints = (index: 1 | 2): (number | null)[] =>
      sorted.map((entry) =>
        typeof entry[index] === 'number' && Number.isFinite(entry[index])
          ? (entry[index] as number)
          : null,
      );
    const cpuPoints = toPoints(1);
    const memoryPoints = toPoints(2);
    if (cpuPoints.filter((value) => value !== null).length >= 2) {
      cpu.push({ label: def.label, color: def.color, points: cpuPoints });
    }
    if (memoryPoints.filter((value) => value !== null).length >= 2) {
      memory.push({ label: def.label, color: def.color, points: memoryPoints });
    }
  }
  if (cpu.length === 0 && memory.length === 0) return null;
  return { cpu, memory };
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

/**
 * docker stats の CPU% は「1コア = 100%」換算で、複数コアのホストでは 100% を超える。
 * 表示ではホスト全体を 100% として正規化し、上限を 100% にする。
 */
export function normalizeCpuPercent(rawPercent: number, cores: number): number {
  const safeCores = Number.isFinite(cores) && cores >= 1 ? cores : 1;
  return Math.min(100, Math.max(0, rawPercent / safeCores));
}

function cpuCoreCount(current: MinecraftCurrentStatus | null): number {
  const raw = current?.runtime?.cpu_cores;
  const parsed =
    typeof raw === 'string' ? Number.parseInt(raw, 10) : typeof raw === 'number' ? raw : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
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
  if (subcommand === 'main' || subcommand === 'resource') {
    await executeMinecraftControl(context, interaction, config, subcommand);
    return;
  }
  if (subcommand !== 'status') {
    await reply(context, interaction, '不明なMinecraft Status操作です。');
    return;
  }

  // 取得に時間がかかる場合でも応答期限（約3秒）を切らないよう、先に defer する
  await interaction.deferReply({
    flags: config.ephemeralResponses ? EPHEMERAL_FLAG : undefined,
  });
  const [current, runtime, history] = await Promise.all([
    fetchCurrentStatus(),
    fetchRuntimeStatus(),
    config.showPerformanceGraph ? fetchMetricsHistory() : Promise.resolve(null),
  ]);
  try {
    const cardModel = buildMinecraftStatusCardModel(current, runtime, config, history);
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

/**
 * サーバー操作（/mc main・/mc resource）の実行に必要な Discord ロール（当面はコード管理。
 * 将来的にプラグイン設定や環境変数へ移す前提で、設定側の追加ロールとは和集合で判定する）
 */
export const MINECRAFT_START_REQUIRED_ROLE_ID = '1114417432346501130';

export function canControlMinecraftServer(
  interaction: { member?: unknown },
  config: MinecraftStatusConfig,
): boolean {
  const allowed = new Set([MINECRAFT_START_REQUIRED_ROLE_ID, ...config.operatorRoleIds]);
  return memberRoleIds(interaction).some((role) => allowed.has(role));
}

/** 操作エンドポイント向けの HMAC 署名（サーバー側 ivrm-mc-control と同じ署名対象文字列） */
export function buildMinecraftControlSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  body: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret)
    .update(`${method}\n${path}\n${timestamp}\n${bodyHash}`)
    .digest('hex');
}

export type MinecraftControlServer = 'main' | 'resource';
export type MinecraftControlAction = 'start' | 'stop' | 'restart' | 'save' | 'regenerate';

const MINECRAFT_SERVER_IDS: Record<MinecraftControlServer, string> = {
  main: 'mc-main',
  resource: 'mc-resource',
};
const MINECRAFT_SERVER_LABELS: Record<MinecraftControlServer, string> = {
  main: 'メインワールド',
  resource: '資源サーバー',
};
const MINECRAFT_CONTROL_ACTIONS: Record<MinecraftControlServer, MinecraftControlAction[]> = {
  main: ['start', 'stop', 'restart', 'save'],
  resource: ['start', 'stop', 'restart', 'save', 'regenerate'],
};
const CONTROL_COOLDOWN_MS: Record<MinecraftControlAction, number> = {
  start: 180_000,
  stop: 60_000,
  restart: 180_000,
  save: 30_000,
  regenerate: 180_000,
};
const CONTROL_POLL_INTERVAL_MS = 10_000;
const CONTROL_POLL_ATTEMPTS = 15;
const REGENERATE_POLL_INTERVAL_MS = 20_000;
const REGENERATE_POLL_ATTEMPTS = 30;

const lastControlRequest = new Map<string, number>();

type MinecraftControlResult =
  | { kind: 'responded'; status: number; result: string; jobState?: string }
  | { kind: 'unconfigured' }
  | { kind: 'error' };

export function minecraftControlPath(
  server: MinecraftControlServer,
  action: MinecraftControlAction | 'status',
): string {
  return `/v1/servers/${server}/${action}`;
}

async function requestMinecraftControl(
  server: MinecraftControlServer,
  action: MinecraftControlAction | 'status',
  timeoutMs: number,
): Promise<MinecraftControlResult> {
  const baseUrl = process.env.MINECRAFT_CONTROL_URL;
  const secret = process.env.MINECRAFT_CONTROL_SECRET;
  if (!baseUrl || !secret) return { kind: 'unconfigured' };
  const path = minecraftControlPath(server, action);
  const method = action === 'status' ? 'GET' : 'POST';
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'x-ivrm-timestamp': timestamp,
        'x-ivrm-signature': buildMinecraftControlSignature(secret, method, path, timestamp, ''),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!isRecord(data)) return { kind: 'error' };
    const job = isRecord(data.job) ? data.job : undefined;
    return {
      kind: 'responded',
      status: response.status,
      result: typeof data.result === 'string' ? data.result : '',
      jobState: typeof job?.state === 'string' ? job.state : undefined,
    };
  } catch {
    return { kind: 'error' };
  }
}

/** エンドポイントの結果コードをユーザー向け文へ変換する（ポーリングで確定するものは null） */
export function minecraftControlImmediateMessage(
  server: MinecraftControlServer,
  outcome: MinecraftControlResult,
): string | null {
  const label = MINECRAFT_SERVER_LABELS[server];
  if (outcome.kind === 'unconfigured')
    return '操作の受け口が未設定です。管理者に連絡してください。';
  if (outcome.kind === 'error') {
    return `${label}の操作リクエストに失敗しました。時間をおいて再度お試しください。`;
  }
  if (outcome.status === 409) {
    return '他の操作が実行中です。終わってからお試しください。';
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return `${label}の操作リクエストが受け付けられませんでした。/mc status で状態を確認してください。`;
  }
  switch (outcome.result) {
    case 'already_running':
      return `${label}は既に起動しています。`;
    case 'already_stopped':
      return `${label}は既に停止しています。`;
    case 'not_running':
      return `${label}は起動していないため、セーブは行われませんでした。`;
    case 'saved':
      return `${label}をセーブしました。`;
    case 'stopped':
      return `${label}をセーブして停止しました。`;
    case 'save_failed':
      return `${label}のセーブに失敗したため、操作を中止しました。`;
    case 'start_failed':
    case 'stop_failed':
      return `${label}の操作に失敗しました。/mc status で状態を確認してください。`;
    default:
      return null;
  }
}

async function waitForServerRunning(server: MinecraftControlServer): Promise<boolean> {
  const serverId = MINECRAFT_SERVER_IDS[server];
  for (let attempt = 0; attempt < CONTROL_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, CONTROL_POLL_INTERVAL_MS));
    const runtime = await fetchRuntimeStatus();
    const target = runtime?.servers?.find((item) => item.id === serverId);
    if (target?.runtimeStatus === 'running') return true;
    if (target?.startability === 'unavailable') return false;
  }
  return false;
}

async function executeMinecraftControl(
  context: MinecraftStatusContext,
  interaction: MinecraftStatusInteraction,
  config: MinecraftStatusConfig,
  server: MinecraftControlServer,
): Promise<void> {
  const label = MINECRAFT_SERVER_LABELS[server];
  const rawAction = interaction.options.getString('action');
  const action = MINECRAFT_CONTROL_ACTIONS[server].find((item) => item === rawAction);
  if (!action) {
    await reply(context, interaction, '不明な操作です。');
    return;
  }
  if (!canControlMinecraftServer(interaction, config)) {
    await reply(context, interaction, 'この操作には運営ロールが必要です。');
    return;
  }

  const cooldownKey = `${interaction.guildId}:${server}:${action}`;
  const nowMs = Date.now();
  const last = lastControlRequest.get(cooldownKey) ?? 0;
  if (nowMs - last < CONTROL_COOLDOWN_MS[action]) {
    await reply(
      context,
      interaction,
      'その操作を受け付けたばかりです。少し時間をおいてからお試しください。',
    );
    return;
  }
  lastControlRequest.set(cooldownKey, nowMs);

  await interaction.deferReply({
    flags: config.ephemeralResponses ? EPHEMERAL_FLAG : undefined,
  });

  // 処理完了の報告では実行者へメンション通知する
  const executorId = interaction.user?.id;
  const mention = executorId ? `<@${executorId}> ` : '';
  const mentionAllowed: { parse: [] } | { users: string[] } = executorId
    ? { users: [executorId] }
    : { parse: [] };

  // stop / restart はエンドポイント側でセーブと停止完了まで待つため、長めのタイムアウトにする
  const timeoutMs = action === 'stop' || action === 'restart' ? 300_000 : 30_000;
  const outcome = await requestMinecraftControl(server, action, timeoutMs);
  if (outcome.kind !== 'responded' || outcome.status >= 400) {
    // 受け付けられなかった操作ではクールダウンを解除し、すぐ再試行できるようにする
    lastControlRequest.delete(cooldownKey);
  }
  const immediate = minecraftControlImmediateMessage(server, outcome);
  if (immediate) {
    await interaction.editReply({
      content: `${mention}${immediate}`,
      allowedMentions: mentionAllowed,
    });
    return;
  }
  if (outcome.kind !== 'responded') {
    await interaction.editReply({
      content: `${mention}${label}の操作に失敗しました。`,
      allowedMentions: mentionAllowed,
    });
    return;
  }

  if (action === 'start' || action === 'restart') {
    const running = await waitForServerRunning(server);
    const verb = action === 'start' ? '起動' : '再起動';
    await interaction.editReply({
      content:
        mention +
        (running
          ? server === 'resource'
            ? `資源サーバーが${verb}しました。接続先: mc.ivrm.jp:25999（ゲーム内では /server resource でも移動できます）`
            : `メインワールドが${verb}しました。接続先: mc.ivrm.jp`
          : `${verb}を開始しましたが、完了を確認できませんでした。/mc status で状態を確認してください。`),
      allowedMentions: mentionAllowed,
    });
    return;
  }

  if (action === 'regenerate' && outcome.result === 'regenerate_started') {
    await interaction.editReply({
      content:
        '資源ワールドの再生成を開始しました。プレイヤーがいる場合は警告のうえ約5分後に実行されます。完了までそのままお待ちください。',
      allowedMentions: { parse: [] },
    });
    let finalState = 'timeout';
    for (let attempt = 0; attempt < REGENERATE_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, REGENERATE_POLL_INTERVAL_MS));
      const status = await requestMinecraftControl('resource', 'status', 15_000);
      if (status.kind === 'responded' && status.jobState && status.jobState !== 'running') {
        finalState = status.jobState;
        break;
      }
    }
    await interaction.editReply({
      content:
        mention +
        (finalState === 'done'
          ? '資源ワールドを再生成しました（旧ワールドはアーカイブ済みです）。接続すると新しいワールドで起動します。'
          : finalState === 'failed'
            ? '資源ワールドの再生成に失敗しました。管理者に連絡してください。'
            : '再生成の完了を確認できませんでした。/mc status で状態を確認してください。'),
      allowedMentions: mentionAllowed,
    });
    return;
  }

  await interaction.editReply({
    content: `${mention}${label}の操作結果を確認できませんでした。/mc status で状態を確認してください。`,
    allowedMentions: mentionAllowed,
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

async function fetchMetricsHistory(): Promise<MinecraftMetricsHistory | null> {
  const url = process.env.MINECRAFT_STATUS_HISTORY_URL ?? MINECRAFT_STATUS_HISTORY_URL_DEFAULT;
  const data = await fetchJson(url);
  return isRecord(data) ? (data as MinecraftMetricsHistory) : null;
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

/** 日次レポート（status.ivrm.jp/reports）の Discord 通知ワーカー */

export interface MinecraftReportEntry {
  date: string;
  url: string;
  tpsAvg?: number | null;
  tpsMin?: number | null;
  cpuMaxHost?: number | null;
  playersMax?: number | null;
}

const REPORT_WORKER_INTERVAL_MS = 10 * 60 * 1000;
const announcedReportDates = new Map<string, string>();
const reportWorkerTimers = new Map<string, NodeJS.Timeout>();
const reportWorkerRuns = new Map<string, Promise<void>>();

function startReportWorker(context: MinecraftStatusContext): void {
  stopReportWorker(context.guildId);
  void runReportCycle(context);
  const timer = setInterval(() => {
    void runReportCycle(context);
  }, REPORT_WORKER_INTERVAL_MS);
  timer.unref();
  reportWorkerTimers.set(context.guildId, timer);
}

function stopReportWorker(guildId: string): void {
  const timer = reportWorkerTimers.get(guildId);
  if (timer) clearInterval(timer);
  reportWorkerTimers.delete(guildId);
}

/** 通知対象は「今日（JST）より前の最新レポート」。当日の部分レポートは通知しない。 */
export function pickReportToAnnounce(
  entries: MinecraftReportEntry[],
  todayJst: string,
): MinecraftReportEntry | null {
  const past = entries
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date < todayJst)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return past[0] ?? null;
}

export function reportAlreadyPosted(
  messages: Iterable<{ content?: string; embeds?: { url?: string; description?: string }[] }>,
  url: string,
): boolean {
  for (const message of messages) {
    if (message.content && message.content.includes(url)) return true;
    for (const embed of message.embeds ?? []) {
      if (embed.url === url) return true;
      if (embed.description && embed.description.includes(url)) return true;
    }
  }
  return false;
}

export function todayInTokyo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function buildReportAnnouncement(entry: MinecraftReportEntry): APIEmbed {
  const lines = [
    `TPS 平均 ${entry.tpsAvg ?? '—'} / 最低 ${entry.tpsMin ?? '—'}`,
    `ホストCPU 最大 ${entry.cpuMaxHost ?? '—'}%`,
    `プレイヤー 最大 ${entry.playersMax ?? '—'} 人`,
    '',
    `[レポートを開く](${entry.url})`,
  ];
  return {
    title: `📊 Minecraft 日次レポート ${entry.date}`,
    url: entry.url,
    description: lines.join('\n'),
    color: COLOR_ONLINE,
    footer: { text: 'status.ivrm.jp' },
  };
}

async function runReportCycle(context: MinecraftStatusContext): Promise<void> {
  const existing = reportWorkerRuns.get(context.guildId);
  if (existing) return existing;
  const run = (async () => {
    try {
      const config = normalizeMinecraftStatusConfig((context as { config?: unknown }).config ?? {});
      if (!config.enabled || !config.announceReports || !config.reportChannelId) return;
      const url = process.env.MINECRAFT_STATUS_REPORTS_URL ?? MINECRAFT_STATUS_REPORTS_URL_DEFAULT;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (!Array.isArray(data)) return;
      const entries = data.filter(
        (item): item is MinecraftReportEntry =>
          isRecord(item) && typeof item.date === 'string' && typeof item.url === 'string',
      );
      const target = pickReportToAnnounce(entries, todayInTokyo());
      if (!target) return;
      if (announcedReportDates.get(context.guildId) === target.date) return;
      const channel = await context.client.channels.fetch(config.reportChannelId);
      if (!channel || !channel.isTextBased()) return;
      if ((channel as { guildId?: string | null }).guildId !== context.guildId) return;
      const recent = await channel.messages.fetch({ limit: 50 });
      if (reportAlreadyPosted(recent.values(), target.url)) {
        announcedReportDates.set(context.guildId, target.date);
        return;
      }
      await channel.send({
        embeds: [buildReportAnnouncement(target)],
        allowedMentions: { parse: [] },
      });
      announcedReportDates.set(context.guildId, target.date);
    } catch {
      // 通知の失敗は次周期で再試行する（ここでは落とさない）
    }
  })();
  reportWorkerRuns.set(context.guildId, run);
  try {
    await run;
  } finally {
    reportWorkerRuns.delete(context.guildId);
  }
}

// サーバー起動/停止イベント通知（#865 案2）

export interface MinecraftServerEvent {
  seq: number;
  at: string;
  server: 'main' | 'resource';
  action: 'start' | 'die' | 'oom';
  exitCode?: number;
}

const EVENT_WORKER_INTERVAL_MS = 60 * 1000;
const EVENT_POST_LIMIT_PER_CYCLE = 10;
const eventTimers = new Map<string, ReturnType<typeof setInterval>>();
const eventCursors = new Map<string, number>();
const eventWorkerRuns = new Set<string>();
const eventWorkerEpochs = new Map<string, number>();

const SERVER_LABELS: Record<MinecraftServerEvent['server'], string> = {
  main: '生活サーバー',
  resource: '資源サーバー',
};

export function parseServerEvents(payload: unknown): MinecraftServerEvent[] {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return [];
  const events: MinecraftServerEvent[] = [];
  for (const item of payload.events) {
    if (!isRecord(item)) continue;
    const seq = toInteger(item.seq, 0);
    if (seq <= 0) continue;
    if (item.server !== 'main' && item.server !== 'resource') continue;
    if (item.action !== 'start' && item.action !== 'die' && item.action !== 'oom') continue;
    const atRaw = typeof item.at === 'string' ? item.at : '';
    events.push({
      seq,
      // 不正な日時は Discord が埋め込みを拒否し通知全体が止まるため、検証して捨てる
      at: atRaw !== '' && !Number.isNaN(Date.parse(atRaw)) ? atRaw : '',
      server: item.server,
      action: item.action,
      exitCode: item.exitCode === undefined ? undefined : toInteger(item.exitCode, 0),
    });
  }
  return events.sort((a, b) => a.seq - b.seq);
}

export function pickNewServerEvents(
  events: MinecraftServerEvent[],
  lastSeq: number,
): MinecraftServerEvent[] {
  return events.filter((event) => event.seq > lastSeq);
}

export function describeServerEvent(event: MinecraftServerEvent): {
  title: string;
  color: number;
  description?: string;
} {
  const label = SERVER_LABELS[event.server];
  if (event.action === 'start') {
    return { title: `🟢 ${label}が起動しました`, color: 0x2ecc71 };
  }
  if (event.action === 'oom') {
    return {
      title: `⚠️ ${label}がメモリ不足で終了しました`,
      color: 0xe74c3c,
      description: 'OOM（メモリ不足）によりプロセスが終了しました。',
    };
  }
  if (event.exitCode !== undefined && event.exitCode !== 0) {
    return {
      title: `⚠️ ${label}が異常終了しました`,
      color: 0xe74c3c,
      description: `終了コード: ${event.exitCode}`,
    };
  }
  return { title: `⏹️ ${label}が停止しました`, color: 0x95a5a6 };
}

export function buildServerEventAnnouncement(event: MinecraftServerEvent): APIEmbed {
  const described = describeServerEvent(event);
  return {
    title: described.title,
    description: described.description,
    color: described.color,
    timestamp: event.at || undefined,
    footer: { text: 'status.ivrm.jp' },
  };
}

function eventsUrl(): string {
  return process.env.MINECRAFT_STATUS_EVENTS_URL ?? 'https://status.ivrm.jp/api/events.json';
}

function startEventWorker(context: MinecraftStatusContext): void {
  stopEventWorker(context.guildId);
  eventWorkerEpochs.set(context.guildId, (eventWorkerEpochs.get(context.guildId) ?? 0) + 1);
  void runEventCycle(context);
  const timer = setInterval(() => {
    void runEventCycle(context);
  }, EVENT_WORKER_INTERVAL_MS);
  timer.unref?.();
  eventTimers.set(context.guildId, timer);
}

function stopEventWorker(guildId: string): void {
  const timer = eventTimers.get(guildId);
  if (timer) {
    clearInterval(timer);
    eventTimers.delete(guildId);
  }
  // 実行中のサイクルを無効化する（旧設定への投稿・カーソル前進を防ぐ）
  eventWorkerEpochs.set(guildId, (eventWorkerEpochs.get(guildId) ?? 0) + 1);
}

async function runEventCycle(context: MinecraftStatusContext): Promise<void> {
  if (eventWorkerRuns.has(context.guildId)) return;
  eventWorkerRuns.add(context.guildId);
  const epoch = eventWorkerEpochs.get(context.guildId) ?? 0;
  const stillCurrent = () => (eventWorkerEpochs.get(context.guildId) ?? 0) === epoch;
  try {
    const config = normalizeMinecraftStatusConfig(context.config);
    if (!config.enabled || !config.announceEvents || !config.eventChannelId) return;
    const response = await fetch(eventsUrl(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return;
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.events)) return;
    const events = parseServerEvents(payload);
    const lastSeq = eventCursors.get(context.guildId);
    if (lastSeq === undefined) {
      // 初回はカーソル同期のみ（過去イベントを投稿しない）。空でも 0 で初期化し、
      // 次に来る最初のイベントを取りこぼさない
      if (!stillCurrent()) return;
      eventCursors.set(context.guildId, events.length === 0 ? 0 : events[events.length - 1]!.seq);
      return;
    }
    if (events.length === 0) return;
    const fresh = pickNewServerEvents(events, lastSeq).slice(0, EVENT_POST_LIMIT_PER_CYCLE);
    if (fresh.length === 0) return;
    const channel = await context.client.channels.fetch(config.eventChannelId);
    if (!channel || !channel.isTextBased()) return;
    if ((channel as { guildId?: string | null }).guildId !== context.guildId) return;
    for (const event of fresh) {
      if (!stillCurrent()) return;
      await channel.send({
        embeds: [buildServerEventAnnouncement(event)],
        allowedMentions: { parse: [] },
      });
      if (!stillCurrent()) return;
      eventCursors.set(context.guildId, event.seq);
    }
  } catch {
    // 通知の失敗でワーカーを落とさない（次周期で再試行する）
  } finally {
    eventWorkerRuns.delete(context.guildId);
    // 無効化→再有効化で世代が変わっていたら、後継サイクルを待たずに実行する
    // （停止したままならタイマーが無いので再実行しない）
    if (!stillCurrent() && eventTimers.has(context.guildId)) {
      setTimeout(() => {
        void runEventCycle(context);
      }, 0);
    }
  }
}
