import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@herta/db';
import { minecraftStatusManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  type APIModalInteractionResponseCallbackData,
} from 'discord.js';
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
  whitelistApproverRoleIds: string[];
  whitelistOpsChannelId: string;
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
  getBoolean(name: string): boolean | null;
}

interface MinecraftStatusInteraction {
  guildId: string | null;
  options: MinecraftStatusOptions;
  user?: { id?: string };
  member?: unknown;
  deferred?: boolean;
  replied?: boolean;
  reply(options: ReplyOptions): Promise<unknown>;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  editReply(options: EditReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content?: string;
  embeds?: APIEmbed[];
  components?: APIActionRowComponent<APIButtonComponent>[];
  flags?: number;
  allowedMentions: { parse: [] };
}

interface EditReplyOptions {
  content?: string;
  embeds?: APIEmbed[];
  components?: APIActionRowComponent<APIButtonComponent>[];
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

interface MinecraftDmUser {
  send(options: { embeds: APIEmbed[]; allowedMentions: { parse: [] } }): Promise<unknown>;
}

interface MinecraftReminderGuild {
  roles: {
    fetch(roleId: string): Promise<{ members?: { keys(): Iterable<string> } } | null>;
  };
}

interface MinecraftReportClient {
  channels: { fetch(channelId: string): Promise<MinecraftReportChannel | null> };
  users?: { fetch(userId: string): Promise<MinecraftDmUser | null> };
  // 審査リマインド用 (Bot 自身の ID と、承認ロール保持者の探索に使う)
  user?: { id: string } | null;
  guilds?: { fetch(guildId: string): Promise<MinecraftReminderGuild | null> };
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
    startWhitelistReminderWorker(context);
  },
  async onDisable(context) {
    stopReportWorker(context.guildId);
    stopEventWorker(context.guildId);
    stopWhitelistReminderWorker(context.guildId);
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
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          const interaction = args[0] as MinecraftComponentInteraction | undefined;
          if (!interaction || typeof interaction.customId !== 'string') return;
          if (!interaction.customId.startsWith(MINECRAFT_WHITELIST_COMPONENT_PREFIX)) return;
          if (interaction.guildId && interaction.guildId !== context.guildId) return;
          await handleMinecraftWhitelistComponent(context, interaction);
        },
      },
    ];
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
    whitelistApproverRoleIds: normalizeRoleIds(source.whitelistApproverRoleIds),
    whitelistOpsChannelId:
      typeof source.whitelistOpsChannelId === 'string' &&
      /^\d{15,25}$/.test(source.whitelistOpsChannelId)
        ? source.whitelistOpsChannelId
        : '',
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
  if (subcommand === 'link') {
    await executeMinecraftLink(context, interaction);
    return;
  }
  if (subcommand === 'whitelist') {
    await executeMinecraftWhitelist(context, interaction, config);
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
  | {
      kind: 'responded';
      status: number;
      result: string;
      jobState?: string;
      onlineCount?: number;
    }
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
  force = false,
): Promise<MinecraftControlResult> {
  const baseUrl = process.env.MINECRAFT_CONTROL_URL;
  const secret = process.env.MINECRAFT_CONTROL_SECRET;
  if (!baseUrl || !secret) return { kind: 'unconfigured' };
  const path = minecraftControlPath(server, action);
  const method = action === 'status' ? 'GET' : 'POST';
  const timestamp = String(Math.floor(Date.now() / 1000));
  // force は署名対象のボディとして送る（サーバー側で検証される）
  const body = force ? JSON.stringify({ force: true }) : '';
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'x-ivrm-timestamp': timestamp,
        'x-ivrm-signature': buildMinecraftControlSignature(secret, method, path, timestamp, body),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body || undefined,
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
      onlineCount: typeof data.players_online === 'number' ? data.players_online : undefined,
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
  if (outcome.result === 'players_online') {
    const count =
      typeof outcome.onlineCount === 'number' ? `現在${outcome.onlineCount}人` : 'プレイヤー';
    return `${label}には${count}が接続中です。停止・再起動すると全員切断されるため、実行しませんでした。強制する場合は force オプションを付けて再実行してください。`;
  }
  if (outcome.result === 'players_unknown') {
    return `${label}の接続プレイヤー数を確認できなかったため、安全のため停止・再起動を実行しませんでした。強制する場合は force オプションを付けて再実行してください。`;
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
  // force は stop / restart のプレイヤーチェックを明示的に迂回するためのオプション
  const force =
    (action === 'stop' || action === 'restart') && interaction.options.getBoolean('force') === true;
  const outcome = await requestMinecraftControl(server, action, timeoutMs, force);
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

// ---------------------------------------------------------------------------
// Minecraft ホワイトリスト連携 (/mc link・/mc whitelist)
// ivrm-web #1075 / Herta #894。正式ルートは Web メンバーポータル
// (member.ivrm.jp/minecraft) で、Bot は追加チャネルとして同じ API を使う。
// 承認・却下・再同期は Studio 設定 whitelistApproverRoleIds の専用ロールが
// 必須 (未設定なら全員不可の fail-closed。サーバー操作ロールのような
// コード定数のフォールバックは付けない)。

export function canApproveMinecraftWhitelist(
  interaction: { member?: unknown },
  config: MinecraftStatusConfig,
): boolean {
  if (config.whitelistApproverRoleIds.length === 0) return false;
  const allowed = new Set(config.whitelistApproverRoleIds);
  return memberRoleIds(interaction).some((role) => allowed.has(role));
}

export interface MinecraftBotApiConfig {
  apiBaseUrl: string;
  // ivrm-web の HERTA_MINECRAFT_SYNC_SECRET と対になる HMAC 共有鍵
  secret: string;
}

/** IVRM_WEB_API_BASE_URL / HERTA_MINECRAFT_SYNC_SECRET が揃わない場合は null (機能は不活性) */
export function resolveMinecraftBotApiConfig(
  env: Partial<Record<string, string | undefined>>,
): MinecraftBotApiConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_MINECRAFT_SYNC_SECRET']?.trim();
  if (!rawUrl || !secret) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

export interface MinecraftBotApiRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/**
 * ivrm-web 側 herta-minecraft-service-auth.ts と同じ署名形式
 * (`${timestamp}.${eventId}.POST.${pathname}.${body}` の HMAC-SHA256) で
 * signed request を構築する。ネットワークI/Oを含まないため単体テストで検証できる。
 */
export function buildMinecraftBotApiRequest(
  config: MinecraftBotApiConfig,
  path: string,
  fields: Record<string, unknown>,
  options: { timestamp?: string; eventId?: string } = {},
): MinecraftBotApiRequest {
  const timestamp = options.timestamp ?? String(Date.now());
  const eventId = options.eventId ?? `mc-${randomUUID()}`;
  const body = JSON.stringify(fields);
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${eventId}.POST.${path}.${body}`)
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${path}`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': eventId,
        'X-IVRM-Signature': signature,
      },
      body,
    },
  };
}

export interface MinecraftBotApiResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
}

async function callMinecraftBotApi(
  config: MinecraftBotApiConfig,
  path: string,
  fields: Record<string, unknown>,
): Promise<MinecraftBotApiResult> {
  const request = buildMinecraftBotApiRequest(config, path, fields);
  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function botApiString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function whitelistStatusLabel(status: string | null): string {
  switch (status) {
    case 'synced':
      return '反映済み';
    case 'pending':
    case 'syncing':
    case 'retrying':
      return '反映待ち';
    case 'failed':
      return '反映に失敗しています（運営が再同期します）';
    case 'not_requested':
      return '未申請';
    default:
      return '不明';
  }
}

/** /minecraft/bot/link の応答を Discord 向けの文面にする */
export function formatMinecraftLinkStatus(data: Record<string, unknown>): string {
  const status = botApiString(data['status']) ?? 'none';
  const link = isRecord(data['link']) ? data['link'] : null;
  const request = isRecord(data['request']) ? data['request'] : null;
  const whitelist = isRecord(data['whitelist']) ? data['whitelist'] : null;
  const whitelistLabel = whitelistStatusLabel(whitelist ? botApiString(whitelist['status']) : null);

  if (status === 'approved' && link) {
    return [
      '✅ Minecraftアカウントと連携済みです。',
      `Minecraft: ${botApiString(link['minecraftUsername']) ?? '?'}`,
      `ホワイトリスト: ${whitelistLabel}`,
    ].join('\n');
  }
  if (status === 'pending' && request) {
    return [
      '🕓 連携申請中です（審査待ち）。',
      `Minecraft: ${botApiString(request['minecraftUsername']) ?? '?'}`,
      `申請ID: ${botApiString(request['id']) ?? '?'}`,
      '取り消す場合は /mc link の cancel を実行してください。',
    ].join('\n');
  }
  if (status === 'rejected' && request) {
    const note = botApiString(request['reviewNote']);
    return [
      '❌ 前回の連携申請は却下されました。',
      `Minecraft: ${botApiString(request['minecraftUsername']) ?? '?'}`,
      ...(note ? [`理由: ${note}`] : []),
      '再申請は /mc link の apply、または Web ポータルからできます: https://member.ivrm.jp/minecraft',
    ].join('\n');
  }
  if (status === 'cancelled') {
    return '前回の連携申請は取り消されています。再申請は /mc link の apply、または Web ポータルからできます: https://member.ivrm.jp/minecraft';
  }
  return 'Minecraftアカウントはまだ連携されていません。申請は /mc link の apply、または Web ポータルからできます: https://member.ivrm.jp/minecraft';
}

/** /minecraft/bot/requests/pending の応答を Discord 向けの文面にする */
export function formatMinecraftPendingRequests(data: Record<string, unknown>): string {
  const requests = Array.isArray(data['requests']) ? data['requests'] : [];
  if (requests.length === 0) {
    return '審査待ちの連携申請はありません。';
  }
  const shown = requests.slice(0, 10);
  const lines = shown.map((entry) => {
    const item = isRecord(entry) ? entry : {};
    const id = botApiString(item['id']) ?? '?';
    const mc = botApiString(item['minecraftUsername']) ?? '?';
    const discord = botApiString(item['discordUsername']) ?? '?';
    const at = botApiString(item['requestedAt']) ?? '';
    return `・${id} — ${mc}（Discord: ${discord}） ${at}`;
  });
  const rest = requests.length - shown.length;
  return [
    `審査待ちの連携申請: ${requests.length}件`,
    ...lines,
    ...(rest > 0 ? [`…他 ${rest} 件`] : []),
    '承認: /mc whitelist の approve（request に申請ID） / 却下: reject（note 必須）',
  ].join('\n');
}

// ---- ホワイトリスト審査の Discord UX (Embed / ボタン / モーダル / DM) ----
// /mc whitelist list の応答に承認・却下ボタンを付け、申請IDの手入力を不要にする。
// ボタン・モーダル側でも承認ロールを再検証する (fail-closed はコマンドと同じ)。
// 審査結果は申請者へ DM でも通知する (DM 不可の場合は通知だけ失敗させる)。

export const MINECRAFT_WHITELIST_COMPONENT_PREFIX = 'mcw:';
const MINECRAFT_WHITELIST_BUTTON_LIMIT = 5;

export interface MinecraftPendingRequestSummary {
  id: string;
  minecraftUsername: string;
  discordUsername: string;
  discordUserId: string | null;
  requestedAt: string | null;
}

export function parseMinecraftPendingRequests(
  data: Record<string, unknown>,
): MinecraftPendingRequestSummary[] {
  const requests = Array.isArray(data['requests']) ? data['requests'] : [];
  return requests.slice(0, 10).map((entry) => {
    const item = isRecord(entry) ? entry : {};
    return {
      id: botApiString(item['id']) ?? '?',
      minecraftUsername: botApiString(item['minecraftUsername']) ?? '?',
      discordUsername: botApiString(item['discordUsername']) ?? '?',
      discordUserId: botApiString(item['discordUserId']),
      requestedAt: botApiString(item['requestedAt']),
    };
  });
}

function formatRequestedAt(value: string | null): string {
  if (!value) return '日時不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function buildMinecraftPendingRequestsEmbed(
  requests: MinecraftPendingRequestSummary[],
): APIEmbed {
  const embed = new EmbedBuilder().setTitle('🗂️ 審査待ちの連携申請').setColor(COLOR_ATTENTION);
  if (requests.length === 0) {
    embed.setDescription('審査待ちの連携申請はありません。');
    return embed.toJSON();
  }
  embed.setDescription(`審査待ち: ${requests.length}件`);
  for (const request of requests) {
    embed.addFields({
      name: `🎮 ${request.minecraftUsername}`,
      value: [
        `Discord: ${request.discordUsername}`,
        `申請日時: ${formatRequestedAt(request.requestedAt)}`,
        `申請ID: ${request.id}`,
      ].join('\n'),
    });
  }
  if (requests.length > MINECRAFT_WHITELIST_BUTTON_LIMIT) {
    embed.setFooter({
      text: `ボタンで操作できるのは先頭${MINECRAFT_WHITELIST_BUTTON_LIMIT}件までです。残りは /mc whitelist の approve / reject、または Web 管理画面で処理してください。`,
    });
  }
  return embed.toJSON();
}

export function buildMinecraftPendingRequestRows(
  requests: MinecraftPendingRequestSummary[],
): APIActionRowComponent<APIButtonComponent>[] {
  return requests
    .slice(0, MINECRAFT_WHITELIST_BUTTON_LIMIT)
    .map((request) =>
      new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`${MINECRAFT_WHITELIST_COMPONENT_PREFIX}approve:${request.id}`)
            .setLabel(`承認: ${request.minecraftUsername}`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${MINECRAFT_WHITELIST_COMPONENT_PREFIX}reject:${request.id}`)
            .setLabel(`却下: ${request.minecraftUsername}`)
            .setStyle(ButtonStyle.Danger),
        )
        .toJSON(),
    );
}

export type MinecraftWhitelistComponentAction = 'approve' | 'reject' | 'reject-submit';

export function parseMinecraftWhitelistComponentId(customId: string): {
  action: MinecraftWhitelistComponentAction;
  requestId: string;
} | null {
  if (!customId.startsWith(MINECRAFT_WHITELIST_COMPONENT_PREFIX)) return null;
  const rest = customId.slice(MINECRAFT_WHITELIST_COMPONENT_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  const action = rest.slice(0, separator);
  const requestId = rest.slice(separator + 1);
  if (!requestId) return null;
  if (action === 'approve' || action === 'reject' || action === 'reject-submit') {
    return { action, requestId };
  }
  return null;
}

export function buildMinecraftRejectModal(
  requestId: string,
): APIModalInteractionResponseCallbackData {
  return new ModalBuilder()
    .setCustomId(`${MINECRAFT_WHITELIST_COMPONENT_PREFIX}reject-submit:${requestId}`)
    .setTitle('却下理由の入力')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('note')
          .setLabel('却下理由 (申請者にも通知されます)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    )
    .toJSON();
}

/** /minecraft/bot/link の応答を Embed にする (formatMinecraftLinkStatus の Embed 版) */
export function buildMinecraftLinkStatusEmbed(data: Record<string, unknown>): APIEmbed {
  const status = botApiString(data['status']) ?? 'none';
  const link = isRecord(data['link']) ? data['link'] : null;
  const request = isRecord(data['request']) ? data['request'] : null;
  const whitelist = isRecord(data['whitelist']) ? data['whitelist'] : null;
  const whitelistLabel = whitelistStatusLabel(whitelist ? botApiString(whitelist['status']) : null);
  const embed = new EmbedBuilder().setTitle('🎮 Minecraft連携の状態');

  if (status === 'approved' && link) {
    embed
      .setColor(COLOR_ONLINE)
      .setDescription('Minecraftアカウントと連携済みです。')
      .addFields(
        {
          name: 'Minecraft',
          value: botApiString(link['minecraftUsername']) ?? '?',
          inline: true,
        },
        { name: 'ホワイトリスト', value: whitelistLabel, inline: true },
      );
    return embed.toJSON();
  }
  if (status === 'pending' && request) {
    embed
      .setColor(COLOR_ATTENTION)
      .setDescription(
        '連携申請中です (審査待ち)。取り消す場合は /mc link の cancel を実行してください。',
      )
      .addFields(
        {
          name: 'Minecraft',
          value: botApiString(request['minecraftUsername']) ?? '?',
          inline: true,
        },
        { name: '申請ID', value: botApiString(request['id']) ?? '?' },
      );
    return embed.toJSON();
  }
  if (status === 'rejected' && request) {
    const note = botApiString(request['reviewNote']);
    embed
      .setColor(COLOR_OFFLINE)
      .setDescription(
        '前回の連携申請は却下されました。再申請は /mc link の apply、または Web ポータルからできます: https://member.ivrm.jp/minecraft',
      )
      .addFields({
        name: 'Minecraft',
        value: botApiString(request['minecraftUsername']) ?? '?',
        inline: true,
      });
    if (note) {
      embed.addFields({ name: '却下理由', value: note });
    }
    return embed.toJSON();
  }
  if (status === 'cancelled') {
    embed
      .setColor(COLOR_UNKNOWN)
      .setDescription(
        '前回の連携申請は取り消されています。再申請は /mc link の apply、または Web ポータルからできます: https://member.ivrm.jp/minecraft',
      );
    return embed.toJSON();
  }
  embed
    .setColor(COLOR_UNKNOWN)
    .setDescription(
      'Minecraftアカウントはまだ連携されていません。申請は /mc link の apply、または Web ポータルからできます: https://member.ivrm.jp/minecraft',
    );
  return embed.toJSON();
}

/** 審査結果を申請者へ DM で知らせる Embed */
export function buildMinecraftReviewNoticeEmbed(
  action: 'approve' | 'reject',
  fields: { minecraftUsername: string; note?: string },
): APIEmbed {
  if (action === 'approve') {
    return new EmbedBuilder()
      .setTitle('✅ Minecraft連携が承認されました')
      .setColor(COLOR_ONLINE)
      .setDescription(
        'ホワイトリストへの反映が始まります。数分後にサーバーへ入れるようになります。',
      )
      .addFields({ name: 'Minecraft', value: fields.minecraftUsername })
      .toJSON();
  }
  const embed = new EmbedBuilder()
    .setTitle('❌ Minecraft連携申請が却下されました')
    .setColor(COLOR_OFFLINE)
    .setDescription(
      '内容を確認のうえ、/mc link の apply または Web ポータルから再申請できます: https://member.ivrm.jp/minecraft',
    )
    .addFields({ name: 'Minecraft', value: fields.minecraftUsername });
  if (fields.note) {
    embed.addFields({ name: '却下理由', value: fields.note });
  }
  return embed.toJSON();
}

async function notifyMinecraftReviewResult(
  context: MinecraftStatusContext,
  target: MinecraftPendingRequestSummary,
  action: 'approve' | 'reject',
  note?: string,
): Promise<void> {
  if (!target.discordUserId || !context.client.users) return;
  try {
    const user = await context.client.users.fetch(target.discordUserId);
    await user?.send({
      embeds: [
        buildMinecraftReviewNoticeEmbed(action, {
          minecraftUsername: target.minecraftUsername,
          note,
        }),
      ],
      allowedMentions: { parse: [] },
    });
  } catch {
    // DM を受け取れないユーザーでは通知だけ失敗し、審査結果には影響させない
  }
}

export interface MinecraftComponentInteraction {
  guildId: string | null;
  customId: string;
  user?: { id?: string };
  member?: unknown;
  fields?: { getTextInputValue(name: string): string };
  isButton(): boolean;
  isModalSubmit(): boolean;
  reply(options: ReplyOptions): Promise<unknown>;
  update(options: EditReplyOptions): Promise<unknown>;
  showModal(modal: APIModalInteractionResponseCallbackData): Promise<unknown>;
}

async function componentEphemeralReply(
  interaction: MinecraftComponentInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  });
}

async function fetchPendingSummaries(
  api: MinecraftBotApiConfig,
  base: Record<string, unknown>,
): Promise<MinecraftPendingRequestSummary[] | null> {
  const result = await callMinecraftBotApi(api, '/minecraft/bot/requests/pending', base);
  return result.ok && result.data ? parseMinecraftPendingRequests(result.data) : null;
}

// ---- ホワイトリスト審査待ちリマインド (Herta #916) ----
// 申請から24時間を超えた審査待ちを、1時間間隔で運営チャンネルへ通知する。
// 通知先は Studio 設定 whitelistOpsChannelId (未設定なら無効の fail-closed)。
// Bot API の審査待ち一覧は「実行者 = 運営者」の Discord ID が必須で、
// ivRooom 未登録の ID では取得できない。そのため実行者は、承認ロールを
// 実際に確認できた運営者の ID を使う: /mc whitelist のコマンド・ボタン操作で
// 検証済みの ID を覚えておき、無ければ承認ロールの保持者から探索する。
// 同一申請への再通知は24時間に1回まで (運営チャンネルの Bot 自身の投稿を
// 走査し、申請IDが含まれる直近24時間の投稿があれば対象から外す)。

export const MINECRAFT_WHITELIST_REMINDER_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const WHITELIST_REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const WHITELIST_REMINDER_SCAN_LIMIT = 100;
const WHITELIST_REMINDER_MAX_OPERATOR_CANDIDATES = 5;

const whitelistReminderTimers = new Map<string, NodeJS.Timeout>();
const whitelistReminderRuns = new Map<string, Promise<void>>();
const whitelistReminderOperators = new Map<string, string>();

/** 承認ロールを確認できた運営者の Discord ID をギルドごとに覚える */
export function rememberMinecraftWhitelistOperator(guildId: string, discordUserId: string): void {
  if (guildId && discordUserId) {
    whitelistReminderOperators.set(guildId, discordUserId);
  }
}

/** 申請からの経過時間が threshold を超えた申請だけを返す (申請日時の無い・不正な申請は除く) */
export function selectOverdueMinecraftRequests(
  requests: MinecraftPendingRequestSummary[],
  nowMs: number,
  thresholdMs: number = MINECRAFT_WHITELIST_REMINDER_THRESHOLD_MS,
): MinecraftPendingRequestSummary[] {
  return requests.filter((request) => {
    if (!request.requestedAt) return false;
    const requestedMs = Date.parse(request.requestedAt);
    return Number.isFinite(requestedMs) && nowMs - requestedMs > thresholdMs;
  });
}

/** 申請からの経過時間 (時間単位、切り捨て) */
export function minecraftPendingElapsedHours(
  request: MinecraftPendingRequestSummary,
  nowMs: number,
): number {
  if (!request.requestedAt) return 0;
  const requestedMs = Date.parse(request.requestedAt);
  if (!Number.isFinite(requestedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - requestedMs) / (60 * 60 * 1000)));
}

export function buildMinecraftWhitelistReminderEmbed(
  requests: MinecraftPendingRequestSummary[],
  nowMs: number,
): APIEmbed {
  const embed = new EmbedBuilder()
    .setTitle('⏰ ホワイトリスト審査待ちのリマインド')
    .setColor(COLOR_ATTENTION)
    .setDescription(
      `申請から24時間以上が経過した審査待ちが ${requests.length} 件あります。審査をお願いします。`,
    );
  for (const request of requests) {
    embed.addFields({
      name: `🎮 ${request.minecraftUsername}`,
      value: [
        `Discord: ${request.discordUserId ? `<@${request.discordUserId}>` : request.discordUsername}`,
        `経過時間: 約${minecraftPendingElapsedHours(request, nowMs)}時間`,
        `申請日時: ${formatRequestedAt(request.requestedAt)}`,
        `申請ID: ${request.id}`,
      ].join('\n'),
    });
  }
  embed.setFooter({
    text: '審査は /mc whitelist の list、または Web 管理画面 (admin.ivrm.jp/minecraft) から行えます',
  });
  return embed.toJSON();
}

export interface MinecraftReminderChannelMessage {
  author?: { id?: string };
  authorId?: string;
  createdTimestamp?: number;
  content?: string;
  embeds?: {
    description?: string;
    footer?: { text?: string };
    fields?: { name?: string; value?: string }[];
  }[];
}

const REMINDED_REQUEST_ID_PATTERN = /申請ID:\s*([A-Za-z0-9_-]+)/g;

/**
 * 直近 windowMs 以内に Bot 自身が投稿したリマインドに含まれる申請IDを集める。
 * リマインド Embed の各フィールドに「申請ID: <id>」が入っていることが前提。
 */
export function collectRecentlyRemindedRequestIds(
  messages: Iterable<MinecraftReminderChannelMessage>,
  botUserId: string | null,
  nowMs: number,
  windowMs: number = MINECRAFT_WHITELIST_REMINDER_THRESHOLD_MS,
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (typeof message.createdTimestamp !== 'number') continue;
    if (nowMs - message.createdTimestamp > windowMs) continue;
    const authorId = message.author?.id ?? message.authorId;
    if (botUserId && authorId !== botUserId) continue;
    const texts: string[] = [];
    if (message.content) texts.push(message.content);
    for (const embed of message.embeds ?? []) {
      if (embed.description) texts.push(embed.description);
      if (embed.footer?.text) texts.push(embed.footer.text);
      for (const field of embed.fields ?? []) {
        if (field.name) texts.push(field.name);
        if (field.value) texts.push(field.value);
      }
    }
    for (const text of texts) {
      for (const match of text.matchAll(REMINDED_REQUEST_ID_PATTERN)) {
        if (match[1]) ids.add(match[1]);
      }
    }
  }
  return ids;
}

interface MinecraftReminderChannel {
  isTextBased(): boolean;
  send(options: {
    content?: string;
    embeds: APIEmbed[];
    allowedMentions: { roles: string[] };
  }): Promise<unknown>;
  messages: {
    fetch(options: { limit: number }): Promise<{
      values(): Iterable<MinecraftReminderChannelMessage>;
    }>;
  };
}

function startWhitelistReminderWorker(context: MinecraftStatusContext): void {
  stopWhitelistReminderWorker(context.guildId);
  void runMinecraftWhitelistReminderCycle(context);
  const timer = setInterval(() => {
    void runMinecraftWhitelistReminderCycle(context);
  }, WHITELIST_REMINDER_INTERVAL_MS);
  timer.unref();
  whitelistReminderTimers.set(context.guildId, timer);
}

function stopWhitelistReminderWorker(guildId: string): void {
  const timer = whitelistReminderTimers.get(guildId);
  if (timer) clearInterval(timer);
  whitelistReminderTimers.delete(guildId);
}

/** 承認ロールの保持者 (メンバーキャッシュにある範囲) の Discord ID を集める */
async function discoverWhitelistApproverIds(
  context: MinecraftStatusContext,
  config: MinecraftStatusConfig,
): Promise<string[]> {
  if (!context.client.guilds) return [];
  try {
    const guild = await context.client.guilds.fetch(context.guildId);
    if (!guild) return [];
    const ids: string[] = [];
    for (const roleId of config.whitelistApproverRoleIds) {
      const role = await guild.roles.fetch(roleId);
      for (const memberId of role?.members?.keys() ?? []) {
        if (typeof memberId === 'string' && !ids.includes(memberId)) ids.push(memberId);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * 審査待ち一覧を、運営者の ID を実行者として取得する。
 * 候補は「承認ロールの保持者 (探索できた範囲)」→「操作で検証済みの ID」の順で試し、
 * 最初に成功した ID を次回用に覚える。全て失敗したら null。
 */
async function fetchPendingForReminder(
  context: MinecraftStatusContext,
  api: MinecraftBotApiConfig,
  config: MinecraftStatusConfig,
): Promise<MinecraftPendingRequestSummary[] | null> {
  const candidates: string[] = [];
  for (const id of await discoverWhitelistApproverIds(context, config)) {
    if (!candidates.includes(id)) candidates.push(id);
  }
  const remembered = whitelistReminderOperators.get(context.guildId);
  if (remembered && !candidates.includes(remembered)) candidates.push(remembered);
  for (const discordUserId of candidates.slice(0, WHITELIST_REMINDER_MAX_OPERATOR_CANDIDATES)) {
    const result = await fetchPendingSummaries(api, {
      discordUserId,
      guildId: context.guildId,
      approverRoleVerified: true,
    });
    if (result) {
      whitelistReminderOperators.set(context.guildId, discordUserId);
      return result;
    }
  }
  return null;
}

export async function runMinecraftWhitelistReminderCycle(
  context: MinecraftStatusContext,
  nowMs: number = Date.now(),
): Promise<void> {
  const existing = whitelistReminderRuns.get(context.guildId);
  if (existing) return existing;
  const run = (async () => {
    try {
      const config = normalizeMinecraftStatusConfig(context.config);
      if (!config.enabled || !config.whitelistOpsChannelId) return;
      if (config.whitelistApproverRoleIds.length === 0) return;
      const api = resolveMinecraftBotApiConfig(process.env);
      if (!api) return;
      const requests = await fetchPendingForReminder(context, api, config);
      if (!requests) return;
      const overdue = selectOverdueMinecraftRequests(requests, nowMs);
      if (overdue.length === 0) return;
      const fetched = await context.client.channels.fetch(config.whitelistOpsChannelId);
      if (!fetched || !fetched.isTextBased()) return;
      if ((fetched as { guildId?: string | null }).guildId !== context.guildId) return;
      const channel = fetched as unknown as MinecraftReminderChannel;
      const recent = await channel.messages.fetch({ limit: WHITELIST_REMINDER_SCAN_LIMIT });
      const reminded = collectRecentlyRemindedRequestIds(
        recent.values(),
        context.client.user?.id ?? null,
        nowMs,
      );
      const fresh = overdue.filter((request) => !reminded.has(request.id));
      if (fresh.length === 0) return;
      await channel.send({
        content: config.whitelistApproverRoleIds.map((roleId) => `<@&${roleId}>`).join(' '),
        embeds: [buildMinecraftWhitelistReminderEmbed(fresh, nowMs)],
        allowedMentions: { roles: [...config.whitelistApproverRoleIds] },
      });
    } catch {
      // リマインドの失敗でワーカーを落とさない (次周期で再試行する)
    }
  })();
  whitelistReminderRuns.set(context.guildId, run);
  try {
    await run;
  } finally {
    whitelistReminderRuns.delete(context.guildId);
  }
}

/** 承認・却下ボタンと却下モーダルの処理。ロール再検証と結果 DM を含む */
export async function handleMinecraftWhitelistComponent(
  context: MinecraftStatusContext,
  interaction: MinecraftComponentInteraction,
): Promise<void> {
  const parsed = parseMinecraftWhitelistComponentId(interaction.customId);
  if (!parsed) return;
  const config = normalizeMinecraftStatusConfig(context.config);
  if (!config.enabled) {
    await componentEphemeralReply(interaction, 'Minecraft Status Pluginは現在無効です。');
    return;
  }
  if (!canApproveMinecraftWhitelist(interaction, config)) {
    await componentEphemeralReply(
      interaction,
      'この操作にはホワイトリスト承認の専用ロールが必要です。',
    );
    return;
  }
  const api = resolveMinecraftBotApiConfig(process.env);
  if (!api) {
    await componentEphemeralReply(interaction, MINECRAFT_LINK_UNAVAILABLE_MESSAGE);
    return;
  }
  const approverId = interaction.user?.id;
  const guildId = interaction.guildId ?? context.guildId;
  if (!approverId || !guildId) {
    await componentEphemeralReply(interaction, 'ユーザー情報を取得できませんでした。');
    return;
  }
  const base = { discordUserId: approverId, guildId, approverRoleVerified: true };
  // 審査リマインド (#916) の実行者候補として、ロール確認済みの運営者を覚える
  rememberMinecraftWhitelistOperator(guildId, approverId);

  if (parsed.action === 'reject') {
    if (!interaction.isButton()) return;
    await interaction.showModal(buildMinecraftRejectModal(parsed.requestId));
    return;
  }

  const action: 'approve' | 'reject' = parsed.action === 'approve' ? 'approve' : 'reject';
  let note: string | undefined;
  if (parsed.action === 'reject-submit') {
    if (!interaction.isModalSubmit()) return;
    note = interaction.fields?.getTextInputValue('note')?.trim();
    if (!note) {
      await componentEphemeralReply(interaction, '却下理由を入力してください。');
      return;
    }
  } else if (!interaction.isButton()) {
    return;
  }

  const before = await fetchPendingSummaries(api, base);
  const target = before?.find((entry) => entry.id === parsed.requestId);
  const result = await callMinecraftBotApi(api, `/minecraft/bot/requests/${action}`, {
    ...base,
    requestId: parsed.requestId,
    ...(note ? { reviewNote: note } : {}),
  });
  if (!result.ok) {
    await componentEphemeralReply(interaction, formatMinecraftBotApiError(result));
    return;
  }
  if (target) {
    await notifyMinecraftReviewResult(context, target, action, note);
  }

  const refreshed = (await fetchPendingSummaries(api, base)) ?? [];
  const payload = {
    embeds: [buildMinecraftPendingRequestsEmbed(refreshed)],
    components: buildMinecraftPendingRequestRows(refreshed),
    allowedMentions: { parse: [] } as { parse: [] },
  };
  if (interaction.isModalSubmit()) {
    // モーダル送信からは元のメッセージを更新できないため、最新の一覧を新規に返す
    await interaction.reply({
      content: action === 'approve' ? '承認しました。' : '却下しました。',
      ...payload,
      flags: EPHEMERAL_FLAG,
    });
    return;
  }
  await interaction.update(payload);
}

/** Bot API のエラーコードを Discord 向けの文面にする */
export function formatMinecraftBotApiError(result: MinecraftBotApiResult): string {
  const code = result.data ? botApiString(result.data['code']) : null;
  switch (code) {
    case 'user_not_registered':
      return 'ivRooomアカウントが見つかりませんでした。先に Web ポータルで登録してください: https://member.ivrm.jp';
    case 'bot_api_disabled':
      return 'Bot連携は現在有効化されていません（運営側の設定待ちです）。Web ポータルから申請できます: https://member.ivrm.jp/minecraft';
    case 'approved_user_link_exists':
      return 'すでにMinecraftアカウントと連携済みです。';
    case 'pending_user_request_exists':
    case 'pending_request_exists':
      return 'すでに連携申請中です。状態は /mc link の status で確認できます。';
    case 'approved_uuid_link_exists':
      return 'そのMinecraftアカウントは別のユーザーに連携済みです。';
    case 'pending_uuid_request_exists':
      return 'そのMinecraftアカウントは別の申請で審査中です。';
    case 'minecraft_profile_not_found':
      return 'Minecraftユーザーが見つかりませんでした。ユーザー名を確認してください。';
    case 'minecraft_profile_unavailable':
      return 'Minecraftプロフィールの確認に失敗しました。時間を置いて再度お試しください。';
    case 'request_not_pending':
      return 'その申請はすでに処理済みです。';
    case 'pending_request_not_found':
      return '取り消せる申請がありません。';
    case 'open_job_exists':
      return '同内容の同期ジョブが進行中です。少し待ってから確認してください。';
    case 'job_not_retryable':
      return 'そのジョブは再試行できる状態ではありません。';
    case 'approver_role_required':
      return 'ホワイトリスト承認の専用ロールが必要です。';
    default:
      break;
  }
  if (result.status === 0) {
    return '連携APIへ接続できませんでした。時間を置いて再度お試しください。';
  }
  return `エラーが発生しました（${code ?? `HTTP ${result.status}`}）。時間を置いて再度お試しください。`;
}

const MINECRAFT_LINK_UNAVAILABLE_MESSAGE =
  'Minecraft連携機能は現在利用できません（運営側の設定待ちです）。Web ポータルから申請できます: https://member.ivrm.jp/minecraft';

async function ephemeralReply(
  interaction: MinecraftStatusInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({
      content,
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.reply({
    content,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  });
}

async function ephemeralPayloadReply(
  interaction: MinecraftStatusInteraction,
  payload: {
    embeds: APIEmbed[];
    components?: APIActionRowComponent<APIButtonComponent>[];
  },
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({
      ...payload,
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.reply({
    ...payload,
    flags: EPHEMERAL_FLAG,
    allowedMentions: { parse: [] },
  });
}

async function executeMinecraftLink(
  context: MinecraftStatusContext,
  interaction: MinecraftStatusInteraction,
): Promise<void> {
  void context;
  const api = resolveMinecraftBotApiConfig(process.env);
  if (!api) {
    await ephemeralReply(interaction, MINECRAFT_LINK_UNAVAILABLE_MESSAGE);
    return;
  }
  const discordUserId = interaction.user?.id;
  if (!discordUserId || !interaction.guildId) {
    await ephemeralReply(interaction, 'ユーザー情報を取得できませんでした。');
    return;
  }
  const base = { discordUserId, guildId: interaction.guildId };
  // Bot API の応答待ちで応答期限（約3秒）を切らないよう、先に defer する
  await interaction.deferReply({ flags: EPHEMERAL_FLAG });
  const action = interaction.options.getString('action') ?? 'status';

  if (action === 'apply') {
    const username = interaction.options.getString('username');
    if (!username) {
      await ephemeralReply(
        interaction,
        'apply のときは username（Minecraftユーザー名）を指定してください。',
      );
      return;
    }
    const result = await callMinecraftBotApi(api, '/minecraft/bot/link/request', {
      ...base,
      minecraftUsername: username,
    });
    await ephemeralReply(
      interaction,
      result.ok
        ? '連携申請を受け付けました。審査が終わると自動でホワイトリストへ反映されます。状態は /mc link の status で確認できます。'
        : formatMinecraftBotApiError(result),
    );
    return;
  }

  if (action === 'cancel') {
    const result = await callMinecraftBotApi(api, '/minecraft/bot/link/cancel', base);
    await ephemeralReply(
      interaction,
      result.ok ? '連携申請を取り消しました。' : formatMinecraftBotApiError(result),
    );
    return;
  }

  const result = await callMinecraftBotApi(api, '/minecraft/bot/link', base);
  if (result.ok && result.data) {
    await ephemeralPayloadReply(interaction, {
      embeds: [buildMinecraftLinkStatusEmbed(result.data)],
    });
    return;
  }
  await ephemeralReply(interaction, formatMinecraftBotApiError(result));
}

async function executeMinecraftWhitelist(
  context: MinecraftStatusContext,
  interaction: MinecraftStatusInteraction,
  config: MinecraftStatusConfig,
): Promise<void> {
  if (!canApproveMinecraftWhitelist(interaction, config)) {
    await ephemeralReply(
      interaction,
      'この操作にはホワイトリスト承認の専用ロールが必要です。ロールが未設定の場合は、運営が Studio で設定するまで使えません。',
    );
    return;
  }
  const api = resolveMinecraftBotApiConfig(process.env);
  if (!api) {
    await ephemeralReply(interaction, MINECRAFT_LINK_UNAVAILABLE_MESSAGE);
    return;
  }
  const discordUserId = interaction.user?.id;
  if (!discordUserId || !interaction.guildId) {
    await ephemeralReply(interaction, 'ユーザー情報を取得できませんでした。');
    return;
  }
  const base = {
    discordUserId,
    guildId: interaction.guildId,
    approverRoleVerified: true,
  };
  // 審査リマインド (#916) の実行者候補として、ロール確認済みの運営者を覚える
  rememberMinecraftWhitelistOperator(interaction.guildId, discordUserId);
  // Bot API の応答待ちで応答期限（約3秒）を切らないよう、先に defer する
  await interaction.deferReply({ flags: EPHEMERAL_FLAG });
  const action = interaction.options.getString('action') ?? 'list';

  if (action === 'approve' || action === 'reject') {
    const requestId = interaction.options.getString('request');
    if (!requestId) {
      await ephemeralReply(
        interaction,
        `${action} のときは request（申請ID）を指定してください。一覧は /mc whitelist の list で確認できます。`,
      );
      return;
    }
    const note = interaction.options.getString('note');
    if (action === 'reject' && !note) {
      await ephemeralReply(interaction, 'reject のときは note（却下理由）が必須です。');
      return;
    }
    const before = await fetchPendingSummaries(api, base);
    const target = before?.find((entry) => entry.id === requestId);
    const result = await callMinecraftBotApi(api, `/minecraft/bot/requests/${action}`, {
      ...base,
      requestId,
      ...(note ? { reviewNote: note } : {}),
    });
    if (result.ok && target) {
      await notifyMinecraftReviewResult(context, target, action, note ?? undefined);
    }
    await ephemeralReply(
      interaction,
      result.ok
        ? action === 'approve'
          ? `申請 ${requestId} を承認しました。ホワイトリストへの反映が始まります。`
          : `申請 ${requestId} を却下しました。`
        : formatMinecraftBotApiError(result),
    );
    return;
  }

  if (action === 'retry') {
    const jobId = interaction.options.getString('job');
    if (!jobId) {
      await ephemeralReply(interaction, 'retry のときは job（同期ジョブID）を指定してください。');
      return;
    }
    const result = await callMinecraftBotApi(api, '/minecraft/bot/whitelist/retry', {
      ...base,
      jobId,
    });
    await ephemeralReply(
      interaction,
      result.ok
        ? `同期ジョブ ${jobId} の再試行を受け付けました。`
        : formatMinecraftBotApiError(result),
    );
    return;
  }

  const result = await callMinecraftBotApi(api, '/minecraft/bot/requests/pending', base);
  if (result.ok && result.data) {
    const requests = parseMinecraftPendingRequests(result.data);
    await ephemeralPayloadReply(interaction, {
      embeds: [buildMinecraftPendingRequestsEmbed(requests)],
      components: buildMinecraftPendingRequestRows(requests),
    });
    return;
  }
  await ephemeralReply(interaction, formatMinecraftBotApiError(result));
}
