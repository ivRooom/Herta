import type { PrismaClient } from '@herta/db';
import { birthdayRoleManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';

const EPHEMERAL_FLAG = 64;
const MANAGE_ROLES_PERMISSION = 268435456n;
const DISCORD_ID_PATTERN = /^\d+$/;
const MAX_RESPONSE_LENGTH = 1900;
const WORKER_INTERVAL_MS = 60 * 60 * 1000;
const STALE_DELIVERY_MS = 2 * 60 * 60 * 1000;
const ROLE_ASSIGNED_PREFIX = 'role-assigned:';
const ROLE_REMOVED_PREFIX = 'role-removed:';

export type LeapDayPolicy = 'february-28' | 'march-1' | 'skip';

export interface BirthdayRoleConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  assignRole: boolean;
  birthdayRoleId: string | null;
  sendAnnouncement: boolean;
  announcementChannelId: string | null;
  announcementMessage: string;
  leapDayPolicy: LeapDayPolicy;
}

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface BirthdayRegistrationLike {
  userId: string;
  month: number;
  day: number;
}

interface BirthdayCommandOptions {
  getSubcommand(): string;
  getInteger(name: string, required?: boolean): number | null;
}

interface BirthdayReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

interface BirthdayEditReplyOptions {
  content: string;
  allowedMentions: { parse: [] };
}

interface BirthdayCommandInteraction {
  guildId: string | null;
  user: { id: string };
  options: BirthdayCommandOptions;
  replied: boolean;
  deferred: boolean;
  deferReply(options?: { flags?: number }): Promise<unknown>;
  editReply(options: BirthdayEditReplyOptions): Promise<unknown>;
  reply(options: BirthdayReplyOptions): Promise<unknown>;
  followUp(options: BirthdayReplyOptions): Promise<unknown>;
}

interface BirthdayRole {
  id: string;
  managed: boolean;
  editable: boolean;
}

interface BirthdayMember {
  roles: {
    cache: { has(roleId: string): boolean };
    add(roleId: string): Promise<unknown>;
    remove(roleId: string): Promise<unknown>;
  };
}

interface BirthdayGuild {
  id: string;
  members: {
    me: {
      permissions: { has(permission: bigint): boolean };
    } | null;
    fetch(userId: string): Promise<BirthdayMember>;
  };
  roles: {
    fetch(roleId: string): Promise<BirthdayRole | null>;
  };
  channels: {
    fetch(channelId: string): Promise<BirthdayChannel | null>;
  };
}

interface BirthdayChannel {
  isTextBased(): boolean;
  send(options: {
    content: string;
    allowedMentions: { parse: []; users: string[] };
  }): Promise<{ id: string }>;
}

interface BirthdayClient {
  guilds: {
    fetch(guildId: string): Promise<BirthdayGuild>;
  };
}

type BirthdayRuntimeContext = PluginRuntimeContext<
  BirthdayRoleConfig,
  BirthdayClient,
  PrismaClient
>;

const workerTimers = new Map<string, NodeJS.Timeout>();
const guildCycleLocks = new Map<string, Promise<void>>();

export const birthdayRolePlugin = definePlugin<BirthdayRoleConfig, BirthdayClient, PrismaClient>({
  manifest: birthdayRoleManifest,
  async onEnable(context) {
    startBirthdayWorker(context);
  },
  async onDisable(context) {
    stopBirthdayWorker(context.guildId);
  },
  provideCommands(context) {
    const command: CommandHandler<BirthdayCommandInteraction> = {
      definition: birthdayRoleManifest.commands[0]!,
      async execute(interaction) {
        await executeBirthdayCommand(context, interaction);
      },
    };
    return [command];
  },
});

export function normalizeBirthdayRoleConfig(value: unknown): BirthdayRoleConfig {
  const source = isRecord(value) ? value : {};
  const announcementMessage =
    normalizeText(source.announcementMessage, 1000) ?? '🎂 {user} お誕生日おめでとう！';
  const leapDayPolicy: LeapDayPolicy =
    source.leapDayPolicy === 'march-1' || source.leapDayPolicy === 'skip'
      ? source.leapDayPolicy
      : 'february-28';

  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? true : source.ephemeralResponses === true,
    assignRole: source.assignRole === undefined ? true : source.assignRole === true,
    birthdayRoleId: normalizeDiscordId(source.birthdayRoleId),
    sendAnnouncement:
      source.sendAnnouncement === undefined ? true : source.sendAnnouncement === true,
    announcementChannelId: normalizeDiscordId(source.announcementChannelId),
    announcementMessage,
    leapDayPolicy,
  };
}

export function isValidBirthday(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(2000, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function resolveEffectiveBirthday(
  month: number,
  day: number,
  year: number,
  policy: LeapDayPolicy,
): { month: number; day: number } | null {
  if (month !== 2 || day !== 29 || isLeapYear(year)) return { month, day };
  if (policy === 'skip') return null;
  return policy === 'march-1' ? { month: 3, day: 1 } : { month: 2, day: 28 };
}

export function getLocalDateParts(now: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const year = read('year');
  const month = read('month');
  const day = read('day');
  if (!year || !month || !day) throw new Error(`InvalidTimezoneDate:${timeZone}`);
  return { year, month, day };
}

export function formatLocalDate(parts: LocalDateParts): string {
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

export function getDaysUntilBirthday(
  registration: BirthdayRegistrationLike,
  today: LocalDateParts,
  policy: LeapDayPolicy,
): number | null {
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1]) {
    const effective = resolveEffectiveBirthday(registration.month, registration.day, year, policy);
    if (!effective) continue;
    const birthdayUtc = Date.UTC(year, effective.month - 1, effective.day);
    if (birthdayUtc >= todayUtc) return Math.floor((birthdayUtc - todayUtc) / 86_400_000);
  }
  return null;
}

export function formatBirthdayListPages(registrations: BirthdayRegistrationLike[]): string[] {
  if (registrations.length === 0) return ['登録されている誕生日はまだありません。'];
  const sorted = [...registrations].sort(
    (a, b) => a.month - b.month || a.day - b.day || a.userId.localeCompare(b.userId),
  );
  const lines = sorted.map(
    (entry) =>
      `${entry.month.toString().padStart(2, '0')}/${entry.day.toString().padStart(2, '0')}  <@${entry.userId}>`,
  );
  return paginateLines('**誕生日一覧**', lines);
}

export function findNextBirthdays(
  registrations: BirthdayRegistrationLike[],
  today: LocalDateParts,
  policy: LeapDayPolicy,
): { days: number; registrations: BirthdayRegistrationLike[] } | null {
  const candidates = registrations.flatMap((registration) => {
    const days = getDaysUntilBirthday(registration, today, policy);
    return days === null ? [] : [{ registration, days }];
  });
  if (candidates.length === 0) return null;
  const minDays = Math.min(...candidates.map((candidate) => candidate.days));
  return {
    days: minDays,
    registrations: candidates
      .filter((candidate) => candidate.days === minDays)
      .map((candidate) => candidate.registration),
  };
}

export async function runBirthdayRoleCycle(
  context: BirthdayRuntimeContext,
  now = new Date(),
): Promise<void> {
  await withGuildCycleLock(context.guildId, async () => {
    const config = normalizeBirthdayRoleConfig(context.config);
    if (!config.enabled || (!config.assignRole && !config.sendAnnouncement)) return;

    const guildRecord = await context.prisma.guild.findUnique({
      where: { id: context.guildId },
      select: { timezone: true },
    });
    const timeZone = guildRecord?.timezone || 'Asia/Tokyo';
    const today = getLocalDateParts(now, timeZone);
    const localDate = formatLocalDate(today);
    const registrations = await context.prisma.birthdayRegistration.findMany({
      where: { guildId: context.guildId },
      select: { userId: true, month: true, day: true },
    });
    const todaysRegistrations = registrations.filter((registration) => {
      const effective = resolveEffectiveBirthday(
        registration.month,
        registration.day,
        today.year,
        config.leapDayPolicy,
      );
      return effective?.month === today.month && effective.day === today.day;
    });
    const todaysUsers = new Set(todaysRegistrations.map((registration) => registration.userId));
    const guild = await context.client.guilds.fetch(context.guildId);

    await cleanupPreviousBirthdayRoles(context, guild, localDate, todaysUsers);

    if (config.assignRole && config.birthdayRoleId) {
      const role = await validateBirthdayRole(guild, config.birthdayRoleId);
      if (!role) {
        context.logger.warn(
          { roleId: config.birthdayRoleId },
          'Birthday RoleをBotから安全に編集できません',
        );
      } else {
        for (const registration of todaysRegistrations) {
          await processDelivery(
            context,
            {
              userId: registration.userId,
              localDate,
              kind: `${ROLE_ASSIGNED_PREFIX}${role.id}`,
            },
            async () => {
              const member = await guild.members.fetch(registration.userId);
              if (!member.roles.cache.has(role.id)) await member.roles.add(role.id);
              return null;
            },
          );
        }
      }
    }

    if (config.sendAnnouncement && config.announcementChannelId) {
      const channel = await guild.channels.fetch(config.announcementChannelId);
      if (!channel?.isTextBased()) {
        context.logger.warn(
          { channelId: config.announcementChannelId },
          'Birthday Roleのお祝い投稿Channelを利用できません',
        );
      } else {
        for (const registration of todaysRegistrations) {
          await processDelivery(
            context,
            { userId: registration.userId, localDate, kind: 'announcement' },
            async () => {
              const content = truncate(
                config.announcementMessage.replaceAll('{user}', `<@${registration.userId}>`),
                MAX_RESPONSE_LENGTH,
              );
              const message = await channel.send({
                content,
                allowedMentions: { parse: [], users: [registration.userId] },
              });
              return message.id;
            },
          );
        }
      }
    }
  });
}

async function executeBirthdayCommand(
  context: BirthdayRuntimeContext,
  interaction: BirthdayCommandInteraction,
): Promise<void> {
  const config = normalizeBirthdayRoleConfig(context.config);
  if (!config.enabled) {
    await respond(interaction, 'Birthday Roleは設定で無効になっています', true);
    return;
  }
  if (!interaction.guildId) {
    await respond(interaction, 'このコマンドはサーバー内でのみ利用できます', true);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (!['set', 'remove', 'me', 'next', 'list'].includes(subcommand)) {
    await respond(interaction, '指定されたサブコマンドは利用できません', true);
    return;
  }

  if (subcommand === 'set') {
    const month = interaction.options.getInteger('month', true);
    const day = interaction.options.getInteger('day', true);
    if (month === null || day === null || !isValidBirthday(month, day)) {
      await respond(interaction, '存在する月日を指定してください。2月29日は登録できます。', true);
      return;
    }
    await defer(interaction, config.ephemeralResponses);
    await context.prisma.birthdayRegistration.upsert({
      where: { guildId_userId: { guildId: interaction.guildId, userId: interaction.user.id } },
      create: { guildId: interaction.guildId, userId: interaction.user.id, month, day },
      update: { month, day },
    });
    context.logger.info(
      { guildId: interaction.guildId, userId: interaction.user.id, month, day },
      '誕生日を登録しました',
    );
    await respond(
      interaction,
      `誕生日を ${month}月${day}日 として登録しました。生年は保存していません。`,
      config.ephemeralResponses,
    );
    return;
  }

  await defer(interaction, config.ephemeralResponses);

  if (subcommand === 'remove') {
    const result = await context.prisma.birthdayRegistration.deleteMany({
      where: { guildId: interaction.guildId, userId: interaction.user.id },
    });
    await respond(
      interaction,
      result.count > 0 ? '誕生日登録を削除しました。' : '削除する誕生日登録はありません。',
      config.ephemeralResponses,
    );
    return;
  }

  if (subcommand === 'me') {
    const registration = await context.prisma.birthdayRegistration.findUnique({
      where: { guildId_userId: { guildId: interaction.guildId, userId: interaction.user.id } },
      select: { month: true, day: true },
    });
    await respond(
      interaction,
      registration
        ? `登録中の誕生日: ${registration.month}月${registration.day}日\n生年は保存していません。`
        : '誕生日はまだ登録されていません。',
      config.ephemeralResponses,
    );
    return;
  }

  const registrations = await context.prisma.birthdayRegistration.findMany({
    where: { guildId: interaction.guildId },
    select: { userId: true, month: true, day: true },
  });

  if (subcommand === 'list') {
    const pages = formatBirthdayListPages(registrations);
    await respond(interaction, pages[0]!, config.ephemeralResponses);
    for (const page of pages.slice(1)) {
      await followUp(interaction, page, config.ephemeralResponses);
    }
    return;
  }

  const guildRecord = await context.prisma.guild.findUnique({
    where: { id: interaction.guildId },
    select: { timezone: true },
  });
  const today = getLocalDateParts(new Date(), guildRecord?.timezone || 'Asia/Tokyo');
  const next = findNextBirthdays(registrations, today, config.leapDayPolicy);
  if (!next) {
    await respond(
      interaction,
      '次の誕生日を計算できる登録がありません。',
      config.ephemeralResponses,
    );
    return;
  }
  const users = next.registrations.map((entry) => `<@${entry.userId}>`).join(' ');
  const label = next.days === 0 ? '今日' : next.days === 1 ? '明日' : `${next.days}日後`;
  await respond(interaction, `次の誕生日は${label}です。\n${users}`, config.ephemeralResponses);
}

async function cleanupPreviousBirthdayRoles(
  context: BirthdayRuntimeContext,
  guild: BirthdayGuild,
  localDate: string,
  todaysUsers: Set<string>,
): Promise<void> {
  const assignments = await context.prisma.birthdayDelivery.findMany({
    where: {
      guildId: context.guildId,
      kind: { startsWith: ROLE_ASSIGNED_PREFIX },
      status: 'completed',
      localDate: { not: localDate },
    },
    select: { userId: true, localDate: true, kind: true },
  });

  for (const assignment of assignments) {
    if (todaysUsers.has(assignment.userId)) continue;
    const roleId = assignment.kind.slice(ROLE_ASSIGNED_PREFIX.length);
    if (!DISCORD_ID_PATTERN.test(roleId)) continue;
    await processDelivery(
      context,
      {
        userId: assignment.userId,
        localDate: assignment.localDate,
        kind: `${ROLE_REMOVED_PREFIX}${roleId}`,
      },
      async () => {
        const role = await validateBirthdayRole(guild, roleId);
        if (!role) return null;
        const member = await guild.members.fetch(assignment.userId);
        if (member.roles.cache.has(role.id)) await member.roles.remove(role.id);
        return null;
      },
    );
  }
}

async function validateBirthdayRole(
  guild: BirthdayGuild,
  roleId: string,
): Promise<BirthdayRole | null> {
  if (!guild.members.me?.permissions.has(MANAGE_ROLES_PERMISSION)) return null;
  const role = await guild.roles.fetch(roleId);
  if (!role || role.id === guild.id || role.managed || !role.editable) return null;
  return role;
}

async function processDelivery(
  context: BirthdayRuntimeContext,
  input: { userId: string; localDate: string; kind: string },
  task: () => Promise<string | null>,
): Promise<void> {
  const idempotencyKey = [
    'birthday',
    context.guildId,
    input.userId,
    input.localDate,
    input.kind,
  ].join(':');
  const staleBefore = new Date(Date.now() - STALE_DELIVERY_MS);
  await context.prisma.birthdayDelivery.updateMany({
    where: { idempotencyKey, status: 'processing', updatedAt: { lt: staleBefore } },
    data: { status: 'failed', errorName: 'StaleDelivery' },
  });
  const delivery = await context.prisma.birthdayDelivery.upsert({
    where: { idempotencyKey },
    create: {
      guildId: context.guildId,
      userId: input.userId,
      localDate: input.localDate,
      kind: input.kind,
      idempotencyKey,
      status: 'pending',
    },
    update: {},
    select: { id: true, status: true },
  });
  if (delivery.status === 'completed') return;

  const claim = await context.prisma.birthdayDelivery.updateMany({
    where: { id: delivery.id, status: { in: ['pending', 'failed'] } },
    data: { status: 'processing', errorName: null },
  });
  if (claim.count === 0) return;

  try {
    const messageId = await task();
    await context.prisma.birthdayDelivery.update({
      where: { id: delivery.id },
      data: { status: 'completed', messageId, errorName: null, completedAt: new Date() },
    });
  } catch (error) {
    const errorName = error instanceof Error && error.name ? error.name : 'UnknownError';
    await context.prisma.birthdayDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', errorName },
    });
    context.logger.warn(
      { err: error, guildId: context.guildId, userId: input.userId, kind: input.kind },
      'Birthday Role deliveryの処理に失敗しました',
    );
  }
}

function startBirthdayWorker(context: BirthdayRuntimeContext): void {
  stopBirthdayWorker(context.guildId);
  void runBirthdayRoleCycle(context).catch((error) => {
    context.logger.warn({ err: error }, 'Birthday Role初回定期処理に失敗しました');
  });
  const timer = setInterval(() => {
    void runBirthdayRoleCycle(context).catch((error) => {
      context.logger.warn({ err: error }, 'Birthday Role定期処理に失敗しました');
    });
  }, WORKER_INTERVAL_MS);
  timer.unref?.();
  workerTimers.set(context.guildId, timer);
}

function stopBirthdayWorker(guildId: string): void {
  const timer = workerTimers.get(guildId);
  if (timer) clearInterval(timer);
  workerTimers.delete(guildId);
}

async function withGuildCycleLock<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const previous = guildCycleLocks.get(guildId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  guildCycleLocks.set(guildId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (guildCycleLocks.get(guildId) === tail) guildCycleLocks.delete(guildId);
  }
}

function paginateLines(header: string, lines: string[]): string[] {
  const pages: string[] = [];
  let current = header;
  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length <= MAX_RESPONSE_LENGTH) {
      current = next;
      continue;
    }
    pages.push(current);
    current = `${header}（続き）\n${line}`;
  }
  pages.push(current);
  return pages;
}

async function defer(interaction: BirthdayCommandInteraction, ephemeral: boolean): Promise<void> {
  if (interaction.replied || interaction.deferred) return;
  await interaction.deferReply(ephemeral ? { flags: EPHEMERAL_FLAG } : undefined);
}

async function respond(
  interaction: BirthdayCommandInteraction,
  content: string,
  ephemeral: boolean,
): Promise<void> {
  const safeContent = truncate(content, MAX_RESPONSE_LENGTH);
  if (interaction.deferred) {
    await interaction.editReply({ content: safeContent, allowedMentions: { parse: [] } });
    return;
  }
  const options = createReplyOptions(safeContent, ephemeral);
  if (interaction.replied) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}

async function followUp(
  interaction: BirthdayCommandInteraction,
  content: string,
  ephemeral: boolean,
): Promise<void> {
  await interaction.followUp(createReplyOptions(truncate(content, MAX_RESPONSE_LENGTH), ephemeral));
}

function createReplyOptions(content: string, ephemeral: boolean): BirthdayReplyOptions {
  return {
    content,
    allowedMentions: { parse: [] },
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
}

function normalizeDiscordId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return DISCORD_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default birthdayRolePlugin;
