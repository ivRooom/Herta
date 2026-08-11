import { getAllPluginManifests, getPluginManifest } from '@herta/plugin-catalog';
import { autoResponsePlugin } from '@herta/plugin-catalog/auto-response-runtime';
import { dailyContentPlugin } from '@herta/plugin-catalog/daily-content-runtime';
import { lfgPlugin } from '@herta/plugin-catalog/lfg-runtime';
import { moderationPlugin } from '@herta/plugin-catalog/moderation-runtime';
import { quotePlugin } from '@herta/plugin-catalog/quote-runtime';
import { teamSplitPlugin } from '@herta/plugin-catalog/team-split-runtime';
import type { Logger } from '@herta/logger';
import { createPluginContext } from '@herta/plugin-sdk';
import type { HertaPlugin } from '@herta/plugin-sdk';
import type { SlashCommand } from '../commands/registry.js';
import { afkPlugin } from './afk.js';
import { birthdayRolePlugin } from './birthday-role.js';
import { channelPolicyPlugin } from './channel-policy.js';
import { eventRsvpPlugin } from './event-rsvp.js';
import { giveawayPlugin } from './giveaway.js';
import { onboardingPlugin } from './onboarding.js';
import { pollPlugin } from './poll.js';
import { reminderPlugin } from './reminder.js';
import { roleManagerPlugin } from './role-manager.js';
import { suggestionPlugin } from './suggestion.js';
import { serverStatsPlugin } from './server-stats.js';
import { xpLevelPlugin } from './xp-level.js';
import type { RuntimePluginEntry } from './types.js';

export type { GuildEventHandler, RuntimePluginEntry } from './types.js';

export interface PluginInterfaceViolation {
  pluginId: string;
  reason: string;
}

export interface DefaultPluginRegistryDeps {
  client: unknown;
  prisma: unknown;
  logger: Logger;
}

const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const commandNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,31})$/;

/** SDK Plugin の実装が Runtime で扱える形か検証する */
export function validatePluginInterface(
  plugin: unknown,
  seenPluginIds: Set<string> = new Set(),
): PluginInterfaceViolation[] {
  const candidate = plugin as Partial<HertaPlugin> | null;
  const manifest = candidate?.manifest;
  const pluginId =
    typeof manifest?.id === 'string'
      ? manifest.id
      : typeof plugin === 'object'
        ? 'unknown'
        : 'invalid';
  const violations: PluginInterfaceViolation[] = [];
  const add = (reason: string) => violations.push({ pluginId, reason });

  if (!manifest || typeof manifest !== 'object') {
    add('manifest がありません');
    return violations;
  }
  if (!pluginIdPattern.test(manifest.id)) add('manifest.id は kebab-case で指定してください');
  if (!manifest.name || typeof manifest.name !== 'string') add('manifest.name が不正です');
  if (!manifest.version || typeof manifest.version !== 'string') add('manifest.version が不正です');
  if (!manifest.description || typeof manifest.description !== 'string')
    add('manifest.description が不正です');
  if (!manifest.author || typeof manifest.author !== 'object') add('manifest.author が不正です');
  if (!Array.isArray(manifest.permissions)) add('manifest.permissions が不正です');
  if (!Array.isArray(manifest.dependencies)) add('manifest.dependencies が不正です');
  if (!manifest.configSchema || typeof manifest.configSchema !== 'object')
    add('manifest.configSchema が不正です');
  if (!Array.isArray(manifest.events)) add('manifest.events が不正です');
  if (!Array.isArray(manifest.commands)) {
    add('manifest.commands が不正です');
    return violations;
  }
  if (seenPluginIds.has(manifest.id)) add('plugin id が重複しています');
  seenPluginIds.add(manifest.id);

  for (const hook of [
    'onLoad',
    'onEnable',
    'onDisable',
    'onUnload',
    'onConfigChange',
    'provideCommands',
    'provideEvents',
  ]) {
    if (
      candidate?.[hook as keyof HertaPlugin] !== undefined &&
      typeof candidate[hook as keyof HertaPlugin] !== 'function'
    ) {
      add(`${hook} は関数で指定してください`);
    }
  }

  for (const command of manifest.commands ?? []) {
    if (!commandNamePattern.test(command.name)) add(`command名 "${command.name}" が不正です`);
    if (command.options?.length && command.subcommands?.length) {
      add(`command "${command.name}" はoptionsとsubcommandsを同時に指定できません`);
    }
    const subcommandNames = new Set<string>();
    for (const subcommand of command.subcommands ?? []) {
      if (!commandNamePattern.test(subcommand.name)) {
        add(`subcommand名 "${subcommand.name}" が不正です`);
      }
      if (subcommandNames.has(subcommand.name)) {
        add(`subcommand名 "${subcommand.name}" が重複しています`);
      }
      subcommandNames.add(subcommand.name);
    }
  }
  return violations;
}

/** SDK Plugin を Runtime Registry の静的 Entry に変換する */
export function toRuntimePluginEntry<TConfig, TClient = unknown, TPrisma = unknown>(
  plugin: HertaPlugin<TConfig, TClient, TPrisma>,
  createContext: (
    plugin: HertaPlugin<TConfig, TClient, TPrisma>,
    guildId: string,
    config: TConfig,
  ) => Parameters<NonNullable<HertaPlugin<TConfig, TClient, TPrisma>['onEnable']>>[0],
): RuntimePluginEntry {
  const context = (guildId: string, config: Record<string, unknown>) =>
    createContext(plugin, guildId, config as TConfig);
  return {
    pluginId: plugin.manifest.id,
    plugin: plugin as unknown as HertaPlugin<Record<string, unknown>>,
    provideCommands: (config, guildId = '') =>
      (plugin.provideCommands?.(context(guildId, config)) ?? []) as SlashCommand[],
    provideEvents: (config, guildId = '') =>
      plugin.provideEvents?.(context(guildId, config)).map(({ event, handler }) => ({
        event,
        handler: (...args) => handler(context(guildId, config), ...args),
      })) ?? [],
    onEnable: async (guildId, config) => plugin.onEnable?.(context(guildId, config)),
    onDisable: async (guildId, config) => plugin.onDisable?.(context(guildId, config)),
  };
}

export class PluginRuntimeRegistry {
  private readonly entries = new Map<string, RuntimePluginEntry>();
  private readonly duplicatePluginIds = new Set<string>();
  private readonly invalidPluginIds = new Set<string>();

  constructor(entries: RuntimePluginEntry[]) {
    for (const entry of entries) {
      if (this.entries.has(entry.pluginId)) this.duplicatePluginIds.add(entry.pluginId);
      this.entries.set(entry.pluginId, entry);
    }
  }

  validateAll(logger?: Logger): PluginInterfaceViolation[] {
    const violations: PluginInterfaceViolation[] = [];
    const seen = new Set<string>();
    for (const pluginId of this.duplicatePluginIds) {
      const violation = { pluginId, reason: 'plugin id が重複しています' };
      violations.push(violation);
      this.invalidPluginIds.add(pluginId);
      logger?.warn(violation, 'Plugin Interface の検証に失敗しました');
    }
    for (const entry of this.entries.values()) {
      const entryViolations = entry.plugin
        ? validatePluginInterface(entry.plugin, seen)
        : validateRuntimeEntry(entry, seen);
      violations.push(...entryViolations);
      if (entryViolations.length > 0) this.invalidPluginIds.add(entry.pluginId);
      for (const violation of entryViolations) {
        logger?.warn(violation, 'Plugin Interface の検証に失敗しました');
      }
    }
    return violations;
  }

  get(pluginId: string): RuntimePluginEntry | undefined {
    if (this.invalidPluginIds.has(pluginId)) return undefined;
    return this.entries.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.get(pluginId) !== undefined;
  }

  getAll(): RuntimePluginEntry[] {
    return [...this.entries.keys()].flatMap((pluginId) => {
      const entry = this.get(pluginId);
      return entry ? [entry] : [];
    });
  }

  validateAgainstCatalog(logger?: Logger): { pluginId: string; reason: string }[] {
    const catalogIds = new Set(getAllPluginManifests().map((manifest) => manifest.id));
    const mismatches: { pluginId: string; reason: string }[] = [];
    for (const entry of this.entries.values()) {
      if (catalogIds.has(entry.pluginId)) {
        continue;
      }
      const reason = 'Plugin catalog manifest が見つかりません';
      mismatches.push({ pluginId: entry.pluginId, reason });
      logger?.warn({ pluginId: entry.pluginId, reason }, 'Plugin Registry と catalog が不整合です');
    }
    return mismatches;
  }
}

function validateRuntimeEntry(
  entry: RuntimePluginEntry,
  seenPluginIds: Set<string>,
): PluginInterfaceViolation[] {
  const violations: PluginInterfaceViolation[] = [];
  const add = (reason: string) => violations.push({ pluginId: entry.pluginId, reason });
  if (!pluginIdPattern.test(entry.pluginId)) add('pluginId は kebab-case で指定してください');
  if (seenPluginIds.has(entry.pluginId)) add('plugin id が重複しています');
  seenPluginIds.add(entry.pluginId);
  for (const hook of ['provideCommands', 'provideEvents', 'onEnable', 'onDisable']) {
    if (
      entry[hook as keyof RuntimePluginEntry] !== undefined &&
      typeof entry[hook as keyof RuntimePluginEntry] !== 'function'
    ) {
      add(`${hook} は関数で指定してください`);
    }
  }
  return violations;
}

const officialPluginIds = [
  'afk',
  'auto-response',
  'birthday-role',
  'channel-policy',
  'daily-content',
  'event-rsvp',
  'giveaway',
  'lfg',
  'moderation',
  'onboarding',
  'poll',
  'reminder',
  'quote',
  'role-manager',
  'suggestion',
  'server-stats',
  'team-split',
  'xp-level',
] as const;

function createOfficialEntries(deps?: DefaultPluginRegistryDeps): RuntimePluginEntry[] {
  const afkEntry = deps
    ? toRuntimePluginEntry(
        afkPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof afkPlugin.onEnable>>[0],
      )
    : undefined;
  const autoResponseEntry = deps
    ? toRuntimePluginEntry(
        autoResponsePlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof autoResponsePlugin.onEnable>>[0],
      )
    : undefined;
  const birthdayRoleEntry = deps
    ? toRuntimePluginEntry(
        birthdayRolePlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof birthdayRolePlugin.onEnable>>[0],
      )
    : undefined;
  const channelPolicyEntry = deps
    ? toRuntimePluginEntry(
        channelPolicyPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof channelPolicyPlugin.onEnable>>[0],
      )
    : undefined;
  const dailyContentEntry = deps
    ? toRuntimePluginEntry(
        dailyContentPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof dailyContentPlugin.onEnable>>[0],
      )
    : undefined;
  const eventRsvpEntry = deps
    ? toRuntimePluginEntry(
        eventRsvpPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof eventRsvpPlugin.onEnable>>[0],
      )
    : undefined;
  const giveawayEntry = deps
    ? toRuntimePluginEntry(
        giveawayPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof giveawayPlugin.onEnable>>[0],
      )
    : undefined;
  const lfgEntry = deps
    ? toRuntimePluginEntry(
        lfgPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof lfgPlugin.onEnable>>[0],
      )
    : undefined;
  const moderationEntry = deps
    ? toRuntimePluginEntry(
        moderationPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof moderationPlugin.onEnable>>[0],
      )
    : undefined;
  const onboardingEntry = deps
    ? toRuntimePluginEntry(
        onboardingPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof onboardingPlugin.onEnable>>[0],
      )
    : undefined;
  const pollEntry = deps
    ? toRuntimePluginEntry(
        pollPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof pollPlugin.onEnable>>[0],
      )
    : undefined;
  const reminderEntry = deps
    ? toRuntimePluginEntry(
        reminderPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof reminderPlugin.onEnable>>[0],
      )
    : undefined;
  const quoteEntry = deps
    ? toRuntimePluginEntry(
        quotePlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof quotePlugin.onEnable>>[0],
      )
    : undefined;
  const roleManagerEntry = deps
    ? toRuntimePluginEntry(
        roleManagerPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof roleManagerPlugin.onEnable>>[0],
      )
    : undefined;
  const suggestionEntry = deps
    ? toRuntimePluginEntry(
        suggestionPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof suggestionPlugin.onEnable>>[0],
      )
    : undefined;
  const xpLevelEntry = deps
    ? toRuntimePluginEntry(
        xpLevelPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof xpLevelPlugin.onEnable>>[0],
      )
    : undefined;
  const serverStatsEntry = deps
    ? toRuntimePluginEntry(
        serverStatsPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof serverStatsPlugin.onEnable>>[0],
      )
    : undefined;
  const teamSplitEntry = deps
    ? toRuntimePluginEntry(
        teamSplitPlugin,
        (plugin, guildId, config) =>
          createPluginContext({
            client: deps.client,
            prisma: deps.prisma,
            logger: deps.logger,
            guildId,
            config,
            manifest: plugin.manifest,
          }) as Parameters<NonNullable<typeof teamSplitPlugin.onEnable>>[0],
      )
    : undefined;

  return officialPluginIds.flatMap((pluginId) => {
    if (pluginId === 'afk' && afkEntry) return [afkEntry];
    if (!getPluginManifest(pluginId)) return [];
    if (pluginId === 'auto-response' && autoResponseEntry) return [autoResponseEntry];
    if (pluginId === 'birthday-role' && birthdayRoleEntry) return [birthdayRoleEntry];
    if (pluginId === 'channel-policy' && channelPolicyEntry) return [channelPolicyEntry];
    if (pluginId === 'daily-content' && dailyContentEntry) return [dailyContentEntry];
    if (pluginId === 'event-rsvp' && eventRsvpEntry) return [eventRsvpEntry];
    if (pluginId === 'giveaway' && giveawayEntry) return [giveawayEntry];
    if (pluginId === 'lfg' && lfgEntry) return [lfgEntry];
    if (pluginId === 'moderation' && moderationEntry) return [moderationEntry];
    if (pluginId === 'onboarding' && onboardingEntry) return [onboardingEntry];
    if (pluginId === 'poll' && pollEntry) return [pollEntry];
    if (pluginId === 'reminder' && reminderEntry) return [reminderEntry];
    if (pluginId === 'quote' && quoteEntry) return [quoteEntry];
    if (pluginId === 'role-manager' && roleManagerEntry) return [roleManagerEntry];
    if (pluginId === 'suggestion' && suggestionEntry) return [suggestionEntry];
    if (pluginId === 'server-stats' && serverStatsEntry) return [serverStatsEntry];
    if (pluginId === 'team-split' && teamSplitEntry) return [teamSplitEntry];
    if (pluginId === 'xp-level' && xpLevelEntry) return [xpLevelEntry];
    return [{ pluginId }];
  });
}

/** Bot Runtime用に公式Plugin実装を注入したRegistryを生成する。 */
export function createDefaultPluginRegistry(
  deps: DefaultPluginRegistryDeps,
): PluginRuntimeRegistry {
  return new PluginRuntimeRegistry(createOfficialEntries(deps));
}

/** テスト・catalog整合性確認用のmanifest-only Registry。 */
export const defaultPluginRegistry = new PluginRuntimeRegistry(createOfficialEntries());
